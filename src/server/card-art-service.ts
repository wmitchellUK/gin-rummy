import "server-only";

import { randomUUID } from "node:crypto";
import {
  isFaceCardSlot,
  type ActiveCardArtManifestResponse,
  type CardArtSetResponse,
  type CardArtSetsResponse,
  type FaceCardManifest,
  type FaceCardSlot,
} from "@/src/shared/card-art";
import { HttpError } from "./auth";
import { cardArtError } from "./card-art-errors";
import {
  MAX_CARD_ART_UPLOAD_BYTES,
  parseNormalizedCrop,
  processCardArtImage,
} from "./card-art-image";
import * as repository from "./card-art-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The single authorization seam for all Card Studio mutations. */
export async function requireCardArtEditor(): Promise<void> {
  // Prototype policy: every caller may edit. Replace this body when admin auth lands.
}

function validSetId(setId: string): string {
  if (!UUID.test(setId)) throw cardArtError("SET_NOT_FOUND");
  return setId;
}

export function parseCardArtSlot(slot: string): FaceCardSlot {
  if (!isFaceCardSlot(slot)) throw cardArtError("INVALID_SLOT");
  return slot;
}

export function parseCardArtSetName(value: unknown): string {
  if (typeof value !== "string") throw cardArtError("INVALID_SET_NAME");
  const name = value.trim();
  if (name.length < 1 || name.length > 80) throw cardArtError("INVALID_SET_NAME");
  return name;
}

function expectedVersion(value: unknown, conflict: "DRAFT_CONFLICT" | "ACTIVATION_CONFLICT"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw cardArtError(conflict);
  return value;
}

function expectedFormVersion(value: FormDataEntryValue | null): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw cardArtError("DRAFT_CONFLICT");
  return expectedVersion(Number(value), "DRAFT_CONFLICT");
}

function publicManifest(manifest: FaceCardManifest, revision?: number): FaceCardManifest {
  return Object.fromEntries(Object.entries(manifest).flatMap(([slot, objectPath]) => {
    if (!isFaceCardSlot(slot) || typeof objectPath !== "string" || objectPath.length === 0) return [];
    const url = repository.publicCardArtUrl(objectPath);
    return [[slot, revision === undefined ? url : `${url}?v=${revision}`]];
  })) as FaceCardManifest;
}

function publicSet(
  record: repository.CardArtSetRecord,
  settings: repository.CardArtSettingsRecord,
): CardArtSetResponse {
  return {
    id: record.id,
    name: record.name,
    draftManifest: publicManifest(record.draftManifest),
    draftVersion: record.draftVersion,
    publishedManifest: publicManifest(record.publishedManifest, record.publishedRevision),
    publishedRevision: record.publishedRevision,
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isActive: settings.activeSetId === record.id && settings.activeRevision === record.publishedRevision,
  };
}

async function responseForSet(record: repository.CardArtSetRecord): Promise<CardArtSetResponse> {
  return publicSet(record, await repository.getCardArtSettings());
}

export async function getActiveCardArtManifest(): Promise<ActiveCardArtManifestResponse> {
  const { settings, activeSet } = await repository.getActiveCardArtSnapshot();
  if (!settings.activeSetId) {
    return { source: "BUILT_IN", setId: null, setName: null, revision: 0, manifest: {} };
  }
  if (!activeSet || activeSet.archivedAt || activeSet.publishedRevision !== settings.activeRevision) {
    throw new Error("Active card-art settings are inconsistent.");
  }
  return {
    source: "CUSTOM",
    setId: activeSet.id,
    setName: activeSet.name,
    revision: settings.activeRevision,
    manifest: publicManifest(activeSet.publishedManifest, settings.activeRevision),
  };
}

export async function listCardArtSets(includeArchived: boolean): Promise<CardArtSetsResponse> {
  const [settings, records] = await Promise.all([
    repository.getCardArtSettings(),
    repository.listCardArtSetRecords(includeArchived),
  ]);
  return {
    activeSetId: settings.activeSetId,
    activeRevision: settings.activeRevision,
    sets: records.map((record) => publicSet(record, settings)),
  };
}

export async function createCardArtSet(input: unknown): Promise<CardArtSetResponse> {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return responseForSet(await repository.createCardArtSetRecord(parseCardArtSetName(body.name)));
}

export async function updateCardArtSet(setIdValue: string, input: unknown): Promise<CardArtSetResponse> {
  const setId = validSetId(setIdValue);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const hasName = Object.hasOwn(body, "name");
  const archive = body.archived === true || body.archive === true;
  if (!hasName && !archive) throw cardArtError("INVALID_SET_NAME");
  const name = hasName ? parseCardArtSetName(body.name) : undefined;
  return responseForSet(await repository.updateCardArtSetRecord(setId, { name, archive }));
}

async function assertMutableSet(setId: string, draftVersion: number): Promise<void> {
  const record = await repository.getCardArtSetRecord(setId);
  if (!record) throw cardArtError("SET_NOT_FOUND");
  if (record.archivedAt) throw cardArtError("SET_ARCHIVED");
  if (record.draftVersion !== draftVersion) throw cardArtError("DRAFT_CONFLICT");
}

export async function uploadCardArtSlot(
  setIdValue: string,
  slotValue: string,
  formData: FormData,
): Promise<CardArtSetResponse> {
  const setId = validSetId(setIdValue);
  const slot = parseCardArtSlot(slotValue);
  const draftVersion = expectedFormVersion(formData.get("expectedDraftVersion"));
  const image = formData.get("image");
  if (!(image instanceof Blob)) throw cardArtError("INVALID_IMAGE");
  if (image.size > MAX_CARD_ART_UPLOAD_BYTES) throw cardArtError("IMAGE_TOO_LARGE");
  const crop = parseNormalizedCrop(formData.get("crop"));
  await assertMutableSet(setId, draftVersion);

  const processed = await processCardArtImage(Buffer.from(await image.arrayBuffer()), crop);
  const objectPath = `sets/${setId}/${slot.replace(":", "-")}/${randomUUID()}.webp`;
  await repository.uploadCardArtObject(objectPath, processed);
  let record: repository.CardArtSetRecord;
  try {
    record = await repository.replaceDraftSlot({
      setId,
      slot,
      objectPath,
      expectedDraftVersion: draftVersion,
    });
  } catch (error) {
    const isConfirmedUnreferenced = error instanceof HttpError
      && ["DRAFT_CONFLICT", "SET_NOT_FOUND", "SET_ARCHIVED"].includes(error.code);
    if (isConfirmedUnreferenced) {
      try { await repository.deleteCardArtObject(objectPath); }
      catch (cleanupError) { console.error("Could not clean up unreferenced card-art asset", cleanupError); }
    }
    throw error;
  }
  return responseForSet(record);
}

export async function removeCardArtSlot(
  setIdValue: string,
  slotValue: string,
  input: unknown,
): Promise<CardArtSetResponse> {
  const setId = validSetId(setIdValue);
  const slot = parseCardArtSlot(slotValue);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const draftVersion = expectedVersion(body.expectedDraftVersion, "DRAFT_CONFLICT");
  return responseForSet(await repository.replaceDraftSlot({
    setId,
    slot,
    objectPath: null,
    expectedDraftVersion: draftVersion,
  }));
}

export async function activateCardArtSet(
  setIdValue: string,
  input: unknown,
): Promise<ActiveCardArtManifestResponse> {
  const setId = validSetId(setIdValue);
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const result = await repository.publishAndActivateCardArtSet({
    setId,
    expectedDraftVersion: expectedVersion(body.expectedDraftVersion, "ACTIVATION_CONFLICT"),
    expectedPublishedRevision: expectedVersion(body.expectedPublishedRevision, "ACTIVATION_CONFLICT"),
  });
  return {
    source: "CUSTOM",
    setId: result.activeSetId,
    setName: result.activeSetName,
    revision: result.activeRevision,
    manifest: publicManifest(result.activeManifest, result.activeRevision),
  };
}

export async function activateBuiltinCardArt(): Promise<ActiveCardArtManifestResponse> {
  await repository.resetCardArtToBuiltin();
  return { source: "BUILT_IN", setId: null, setName: null, revision: 0, manifest: {} };
}
