/** Browser-safe game DTO. This module intentionally has no server imports. */
export type PublicCard = { readonly id: string; readonly suit: string; readonly rank: string };

export type LegalControl =
  | "PASS_INITIAL_UPCARD" | "TAKE_INITIAL_UPCARD" | "DRAW_STOCK" | "DRAW_DISCARD"
  | "DISCARD" | "KNOCK" | "GIN" | "START_NEXT_HAND";

export interface PlayerGameView {
  readonly gameId: string;
  readonly version: number;
  readonly status: "WAITING" | "PLAYING" | "HAND_COMPLETE" | "COMPLETE";
  readonly phase: string;
  readonly rules: { readonly knockThreshold: number; readonly ginBonus: number; readonly undercutBonus: number; readonly matchTarget: number };
  readonly you: { readonly seat: 0 | 1; readonly displayName: string; readonly score: number; readonly hand: readonly PublicCard[] };
  readonly opponent?: { readonly seat: 0 | 1; readonly displayName: string; readonly score: number; readonly cardCount: number };
  readonly dealerId: string | null;
  readonly currentPlayerId?: string;
  readonly stockCount: number;
  readonly discardPile: readonly PublicCard[];
  readonly initialUpcard?: PublicCard;
  readonly legalControls: readonly LegalControl[];
  readonly handResult?: unknown;
  readonly gameResult?: unknown;
}
