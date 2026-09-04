import "server-only";

import type { FaceCardManifest, FaceCardSlot } from "@/src/shared/card-art";
import { createAdminClient } from "./supabase-admin";
import { cardArtError } from "./card-art-errors";

const CARD_ART_BUCKET = "card-art";
const SET_COLUMNS = [
  "id",
  "name",
  "draft_manifest",
  "draft_version",
  "published_manifest",
  "published_revision",
  "archived_at",
  "created_at",
  "updated_at",
].join(", ");

interface CardArtSetRow {
  id: string;
  name: string;
  draft_manifest: FaceCardManifest;
  draft_version: number;
  published_manifest: FaceCardManifest;
  published_revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardArtSetRecord {
  readonly id: string;
  readonly name: string;
  readonly draftManifest: FaceCardManifest;
  readonly draftVersion: number;
  readonly publishedManifest: FaceCardManifest;
  readonly publishedRevision: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CardArtSettingsRecord {
  readonly activeSetId: string | null;
  readonly activeRevision: number;
}

export interface ActiveCardArtSnapshot {
  readonly settings: CardArtSettingsRecord;
  readonly activeSet: CardArtSetRecord | null;
}

function toSetRecord(row: CardArtSetRow): CardArtSetRecord {
  return {
    id: row.id,
    name: row.name,
    draftManifest: row.draft_manifest,
    draftVersion: row.draft_version,
    publishedManifest: row.published_manifest,
    publishedRevision: row.published_revision,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCardArtSettings(): Promise<CardArtSettingsRecord> {
  const { data, error } = await createAdminClient()
    .from("card_art_settings")
    .select("active_set_id, active_revision")
    .eq("singleton", true)
    .single();
  if (error || !data) throw new Error("Could not load card-art settings.");
  return {
    activeSetId: data.active_set_id as string | null,
    activeRevision: data.active_revision as number,
  };
}

export async function getActiveCardArtSnapshot(): Promise<ActiveCardArtSnapshot> {
  const { data, error } = await createAdminClient()
    .from("card_art_settings")
    .select(`
      active_set_id,
      active_revision,
      active_set:card_art_sets!card_art_settings_active_set_id_fkey (${SET_COLUMNS})
    `)
    .eq("singleton", true)
    .single();
  if (error || !data) throw new Error("Could not load active card-art manifest.");
  const row = data as unknown as {
    active_set_id: string | null;
    active_revision: number;
    active_set: CardArtSetRow | null;
  };
  return {
    settings: { activeSetId: row.active_set_id, activeRevision: row.active_revision },
    activeSet: row.active_set ? toSetRecord(row.active_set) : null,
  };
}

export async function listCardArtSetRecords(includeArchived: boolean): Promise<CardArtSetRecord[]> {
  let query = createAdminClient()
    .from("card_art_sets")
    .select(SET_COLUMNS)
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error || !data) throw new Error("Could not list card-art sets.");
  return (data as unknown as CardArtSetRow[]).map(toSetRecord);
}

export async function getCardArtSetRecord(setId: string): Promise<CardArtSetRecord | null> {
  const { data, error } = await createAdminClient()
    .from("card_art_sets")
    .select(SET_COLUMNS)
    .eq("id", setId)
    .maybeSingle();
  if (error) throw new Error("Could not load card-art set.");
  return data ? toSetRecord(data as unknown as CardArtSetRow) : null;
}

export async function createCardArtSetRecord(name: string): Promise<CardArtSetRecord> {
  const { data, error } = await createAdminClient()
    .from("card_art_sets")
    .insert({ name })
    .select(SET_COLUMNS)
    .single();
  if (error || !data) throw new Error("Could not create card-art set.");
  return toSetRecord(data as unknown as CardArtSetRow);
}

export async function updateCardArtSetRecord(
  setId: string,
  changes: { readonly name?: string; readonly archive?: boolean },
): Promise<CardArtSetRecord> {
  const current = await getCardArtSetRecord(setId);
  if (!current) throw cardArtError("SET_NOT_FOUND");
  if (current.archivedAt) throw cardArtError("SET_ARCHIVED");

  const values: { name?: string; archived_at?: string | null } = {};
  if (changes.name !== undefined) values.name = changes.name;
  if (changes.archive) values.archived_at = new Date().toISOString();

  const { data, error } = await createAdminClient()
    .from("card_art_sets")
    .update(values)
    .eq("id", setId)
    .is("archived_at", null)
    .select(SET_COLUMNS)
    .maybeSingle();
  if (error?.message.includes("CARD_ART_SET_ACTIVE")) throw cardArtError("ACTIVE_SET_ARCHIVE");
  if (error) throw new Error("Could not update card-art set.");
  if (!data) {
    const latest = await getCardArtSetRecord(setId);
    if (!latest) throw cardArtError("SET_NOT_FOUND");
    throw cardArtError("SET_ARCHIVED");
  }
  return toSetRecord(data as unknown as CardArtSetRow);
}

export async function replaceDraftSlot(input: {
  readonly setId: string;
  readonly slot: FaceCardSlot;
  readonly objectPath: string | null;
  readonly expectedDraftVersion: number;
}): Promise<CardArtSetRecord> {
  const current = await getCardArtSetRecord(input.setId);
  if (!current) throw cardArtError("SET_NOT_FOUND");
  if (current.archivedAt) throw cardArtError("SET_ARCHIVED");
  if (current.draftVersion !== input.expectedDraftVersion) throw cardArtError("DRAFT_CONFLICT");

  const nextManifest = { ...current.draftManifest };
  if (input.objectPath === null) delete nextManifest[input.slot];
  else nextManifest[input.slot] = input.objectPath;

  const { data, error } = await createAdminClient()
    .from("card_art_sets")
    .update({
      draft_manifest: nextManifest,
      draft_version: input.expectedDraftVersion + 1,
    })
    .eq("id", input.setId)
    .eq("draft_version", input.expectedDraftVersion)
    .is("archived_at", null)
    .select(SET_COLUMNS)
    .maybeSingle();
  if (error) throw new Error("Could not update card-art draft.");
  if (!data) {
    const latest = await getCardArtSetRecord(input.setId);
    if (!latest) throw cardArtError("SET_NOT_FOUND");
    if (latest.archivedAt) throw cardArtError("SET_ARCHIVED");
    throw cardArtError("DRAFT_CONFLICT");
  }
  return toSetRecord(data as unknown as CardArtSetRow);
}

export async function uploadCardArtObject(objectPath: string, contents: Buffer): Promise<void> {
  const { error } = await createAdminClient().storage.from(CARD_ART_BUCKET).upload(objectPath, contents, {
    cacheControl: "31536000",
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw new Error("Could not upload card-art asset.");
}

export async function deleteCardArtObject(objectPath: string): Promise<void> {
  const { error } = await createAdminClient().storage.from(CARD_ART_BUCKET).remove([objectPath]);
  if (error) throw new Error("Could not remove unreferenced card-art asset.");
}

export function publicCardArtUrl(objectPath: string): string {
  return createAdminClient().storage.from(CARD_ART_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

export async function publishAndActivateCardArtSet(input: {
  readonly setId: string;
  readonly expectedDraftVersion: number;
  readonly expectedPublishedRevision: number;
}): Promise<{
  activeSetId: string;
  activeSetName: string;
  activeRevision: number;
  activeManifest: FaceCardManifest;
}> {
  const { data, error } = await createAdminClient().rpc("publish_and_activate_card_art_set", {
    p_set_id: input.setId,
    p_expected_draft_version: input.expectedDraftVersion,
    p_expected_published_revision: input.expectedPublishedRevision,
  }).single();
  if (error?.message.includes("CARD_ART_SET_NOT_FOUND")) throw cardArtError("SET_NOT_FOUND");
  if (error?.message.includes("CARD_ART_SET_ARCHIVED")) throw cardArtError("SET_ARCHIVED");
  if (error?.message.includes("CARD_ART_ACTIVATION_CONFLICT")) throw cardArtError("ACTIVATION_CONFLICT");
  if (error || !data) throw new Error("Could not activate card-art set.");
  const row = data as unknown as {
    active_set_id: string;
    active_revision: number;
    active_manifest: FaceCardManifest;
  };
  const activeSet = await getCardArtSetRecord(row.active_set_id);
  if (!activeSet) throw new Error("Could not load the activated card-art set.");
  return {
    activeSetId: row.active_set_id,
    activeSetName: activeSet.name,
    activeRevision: row.active_revision,
    activeManifest: row.active_manifest,
  };
}

export async function resetCardArtToBuiltin(): Promise<void> {
  const { error } = await createAdminClient().rpc("reset_card_art_to_builtin");
  if (error) throw new Error("Could not restore built-in card art.");
}
