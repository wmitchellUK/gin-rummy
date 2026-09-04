export const FACE_CARD_RANKS = ["J", "Q", "K"] as const;
export type FaceCardRank = (typeof FACE_CARD_RANKS)[number];

export const FACE_CARD_SUITS = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES"] as const;
export type FaceCardSuit = (typeof FACE_CARD_SUITS)[number];

export type FaceCardSlot = `${FaceCardRank}:${FaceCardSuit}`;

export const FACE_CARD_SLOTS: readonly FaceCardSlot[] = FACE_CARD_RANKS.flatMap(
  (rank) => FACE_CARD_SUITS.map((suit) => `${rank}:${suit}` as FaceCardSlot),
);

const FACE_CARD_SLOT_SET = new Set<string>(FACE_CARD_SLOTS);

export function isFaceCardSlot(value: unknown): value is FaceCardSlot {
  return typeof value === "string" && FACE_CARD_SLOT_SET.has(value);
}

/** Storage object paths keyed by any of the twelve customizable face-card slots. */
export type FaceCardManifest = Partial<Record<FaceCardSlot, string>>;
export type CardArtManifest = FaceCardManifest;

/** Drops unknown slots and non-string values from untrusted manifest payloads. */
export function sanitizeFaceCardManifest(value: unknown): FaceCardManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [FaceCardSlot, string] => isFaceCardSlot(entry[0])
        && typeof entry[1] === "string"
        && entry[1].length > 0,
    ),
  );
}

export interface ActiveCardArtManifest {
  readonly source: "BUILT_IN" | "CUSTOM";
  readonly setId: string | null;
  readonly setName: string | null;
  readonly revision: number;
  readonly manifest: FaceCardManifest;
}

export type ActiveCardArtManifestResponse = ActiveCardArtManifest;
export type ActiveCardArtResponse = ActiveCardArtManifestResponse;

export interface CardArtSetResponse {
  readonly id: string;
  readonly name: string;
  readonly draftManifest: FaceCardManifest;
  readonly draftVersion: number;
  readonly publishedManifest: FaceCardManifest;
  readonly publishedRevision: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isActive: boolean;
}

export interface CardArtSetsResponse {
  readonly activeSetId: string | null;
  readonly activeRevision: number;
  readonly sets: readonly CardArtSetResponse[];
}
