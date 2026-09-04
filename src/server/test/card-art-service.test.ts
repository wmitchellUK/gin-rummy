import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardArtSetRecord } from "../card-art-repository";

const repository = vi.hoisted(() => ({
  createCardArtSetRecord: vi.fn(),
  deleteCardArtObject: vi.fn(),
  getActiveCardArtSnapshot: vi.fn(),
  getCardArtSetRecord: vi.fn(),
  getCardArtSettings: vi.fn(),
  listCardArtSetRecords: vi.fn(),
  publicCardArtUrl: vi.fn((path: string) => `https://assets.example/card-art/${path}`),
  publishAndActivateCardArtSet: vi.fn(),
  replaceDraftSlot: vi.fn(),
  resetCardArtToBuiltin: vi.fn(),
  updateCardArtSetRecord: vi.fn(),
  uploadCardArtObject: vi.fn(),
}));
const imageProcessing = vi.hoisted(() => ({
  MAX_CARD_ART_UPLOAD_BYTES: 10 * 1024 * 1024,
  parseNormalizedCrop: vi.fn(() => ({ x: 0, y: 0, width: 1, height: 1 })),
  processCardArtImage: vi.fn(async () => Buffer.from("processed webp")),
}));

vi.mock("../card-art-repository", () => repository);
vi.mock("../card-art-image", () => imageProcessing);

import { cardArtError } from "../card-art-errors";
import {
  activateBuiltinCardArt,
  activateCardArtSet,
  createCardArtSet,
  getActiveCardArtManifest,
  parseCardArtSetName,
  parseCardArtSlot,
  removeCardArtSlot,
  uploadCardArtSlot,
} from "../card-art-service";

const setId = "10000000-0000-4000-8000-000000000001";

function artSet(overrides: Partial<CardArtSetRecord> = {}): CardArtSetRecord {
  return {
    id: setId,
    name: "Portraits",
    draftManifest: { "Q:HEARTS": "draft.webp" },
    draftVersion: 2,
    publishedManifest: { "J:CLUBS": "published.webp" },
    publishedRevision: 4,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("card-art service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.getCardArtSettings.mockResolvedValue({ activeSetId: setId, activeRevision: 4 });
    repository.getActiveCardArtSnapshot.mockResolvedValue({
      settings: { activeSetId: setId, activeRevision: 4 },
      activeSet: artSet(),
    });
  });

  it("validates canonical slots and bounded, trimmed set names", () => {
    expect(parseCardArtSlot("K:SPADES")).toBe("K:SPADES");
    expect(() => parseCardArtSlot("A:SPADES")).toThrowError(expect.objectContaining({ code: "INVALID_SLOT" }));
    expect(parseCardArtSetName("  Family  ")).toBe("Family");
    expect(() => parseCardArtSetName(" ")).toThrowError(expect.objectContaining({ code: "INVALID_SET_NAME" }));
    expect(() => parseCardArtSetName("x".repeat(81))).toThrowError(expect.objectContaining({ code: "INVALID_SET_NAME" }));
  });

  it("keeps draft changes isolated from the published manifest", async () => {
    const current = artSet();
    repository.getCardArtSetRecord.mockResolvedValue(current);
    repository.replaceDraftSlot.mockImplementation(async (input: { objectPath: string }) => artSet({
      draftManifest: { ...current.draftManifest, "K:SPADES": input.objectPath },
      draftVersion: 3,
    }));
    const formData = new FormData();
    formData.set("image", new Blob(["image"]), "portrait.png");
    formData.set("crop", JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }));
    formData.set("expectedDraftVersion", "2");

    const result = await uploadCardArtSlot(setId, "K:SPADES", formData);

    expect(result.draftVersion).toBe(3);
    expect(result.draftManifest["K:SPADES"]).toMatch(/^https:\/\/assets\.example/);
    expect(result.publishedManifest).toEqual({
      "J:CLUBS": "https://assets.example/card-art/published.webp?v=4",
    });
    expect(repository.replaceDraftSlot).toHaveBeenCalledWith(expect.objectContaining({ expectedDraftVersion: 2 }));
  });

  it("deletes a newly uploaded object when the optimistic draft write loses a race", async () => {
    repository.getCardArtSetRecord.mockResolvedValue(artSet());
    repository.replaceDraftSlot.mockRejectedValue(cardArtError("DRAFT_CONFLICT"));
    const formData = new FormData();
    formData.set("image", new Blob(["image"]), "portrait.png");
    formData.set("crop", "{}");
    formData.set("expectedDraftVersion", "2");

    await expect(uploadCardArtSlot(setId, "J:CLUBS", formData)).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
    expect(repository.uploadCardArtObject).toHaveBeenCalledTimes(1);
    expect(repository.deleteCardArtObject).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^sets/${setId}/J-CLUBS/.+\\.webp$`)),
    );
  });

  it("rejects a stale draft before processing or uploading", async () => {
    repository.getCardArtSetRecord.mockResolvedValue(artSet({ draftVersion: 3 }));
    const formData = new FormData();
    formData.set("image", new Blob(["image"]), "portrait.png");
    formData.set("crop", "{}");
    formData.set("expectedDraftVersion", "2");

    await expect(uploadCardArtSlot(setId, "J:CLUBS", formData)).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
    expect(imageProcessing.processCardArtImage).not.toHaveBeenCalled();
    expect(repository.uploadCardArtObject).not.toHaveBeenCalled();
  });

  it("never deletes older assets when removing a draft slot", async () => {
    repository.replaceDraftSlot.mockResolvedValue(artSet({ draftManifest: {}, draftVersion: 3 }));

    const result = await removeCardArtSlot(setId, "Q:HEARTS", { expectedDraftVersion: 2 });

    expect(result.draftManifest).toEqual({});
    expect(repository.replaceDraftSlot).toHaveBeenCalledWith({
      setId,
      slot: "Q:HEARTS",
      objectPath: null,
      expectedDraftVersion: 2,
    });
    expect(repository.deleteCardArtObject).not.toHaveBeenCalled();
  });

  it("publishes repository paths as public URLs with revision cache keys", async () => {
    repository.publishAndActivateCardArtSet.mockResolvedValue({
      activeSetId: setId,
      activeSetName: "Portraits",
      activeRevision: 5,
      activeManifest: { "J:DIAMONDS": "sets/private-object-name.webp" },
    });

    const result = await activateCardArtSet(setId, {
      expectedDraftVersion: 2,
      expectedPublishedRevision: 4,
    });

    expect(result).toEqual({
      source: "CUSTOM",
      setId,
      setName: "Portraits",
      revision: 5,
      manifest: {
        "J:DIAMONDS": "https://assets.example/card-art/sets/private-object-name.webp?v=5",
      },
    });
  });

  it("serves only the active published snapshot", async () => {
    await expect(getActiveCardArtManifest()).resolves.toEqual({
      source: "CUSTOM",
      setId,
      setName: "Portraits",
      revision: 4,
      manifest: { "J:CLUBS": "https://assets.example/card-art/published.webp?v=4" },
    });
  });

  it("returns the complete built-in manifest contract after reset", async () => {
    await expect(activateBuiltinCardArt()).resolves.toEqual({
      source: "BUILT_IN",
      setId: null,
      setName: null,
      revision: 0,
      manifest: {},
    });
    expect(repository.resetCardArtToBuiltin).toHaveBeenCalledOnce();
  });

  it("validates set names before creation", async () => {
    await expect(createCardArtSet({ name: "" })).rejects.toMatchObject({ code: "INVALID_SET_NAME" });
    expect(repository.createCardArtSetRecord).not.toHaveBeenCalled();
  });
});
