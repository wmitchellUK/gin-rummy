/** Browser-safe game DTO. This module intentionally has no server imports. */
export type PublicCard = { readonly id: string; readonly suit: string; readonly rank: string };

export type LegalControl =
  | "PASS_INITIAL_UPCARD" | "TAKE_INITIAL_UPCARD" | "DRAW_STOCK" | "DRAW_DISCARD"
  | "DISCARD" | "KNOCK" | "GIN" | "START_NEXT_HAND";

export interface TurnRestrictions {
  /** A public card picked up this turn which the active player cannot discard. */
  readonly cannotDiscardCardId: string;
}

export interface DiscardOutcomeView {
  readonly cardId: string;
  /** Minimum deadwood remaining after this card is discarded. */
  readonly deadwoodValue: number;
  readonly declaration: "KNOCK" | "GIN" | null;
}

export interface PublicMeld {
  readonly kind: "RUN" | "SET";
  readonly cards: readonly PublicCard[];
}

export interface PublicLayoff {
  readonly card: PublicCard;
  /** The engine-selected meld after this card was laid off. */
  readonly resultingMeld: PublicMeld;
}

export interface RevealedPlayerHandView {
  readonly playerId: string;
  readonly displayName: string;
  readonly revealedHand: readonly PublicCard[];
  readonly melds: readonly PublicMeld[];
  readonly originalDeadwoodCards: readonly PublicCard[];
  readonly originalDeadwoodValue: number;
  readonly layoffs: readonly PublicLayoff[];
  readonly finalDeadwoodCards: readonly PublicCard[];
  readonly finalDeadwoodValue: number;
}

export interface HandScoreView {
  readonly playerId: string;
  readonly displayName: string;
  readonly score: number;
}

export type CompletedHandSummaryView =
  | {
    readonly kind: "SCORED";
    readonly handNumber: number;
    readonly declaration: "KNOCK" | "GIN";
    readonly winnerId: string;
    readonly winnerName: string;
    readonly scoringReason: "GIN" | "KNOCK" | "UNDERCUT";
    readonly pointsAwarded: number;
  }
  | {
    readonly kind: "CANCELLED";
    readonly handNumber: number;
    readonly pointsAwarded: 0;
  };

export interface GameResultView {
  readonly winnerId: string;
  readonly winnerName: string;
  readonly finalScores: readonly [HandScoreView, HandScoreView];
  readonly matchTarget: number;
  readonly completedHands: readonly CompletedHandSummaryView[];
}

export interface ScoredHandResultView {
  readonly kind: "SCORED";
  readonly handNumber: number;
  readonly declaration: "KNOCK" | "GIN";
  readonly declarerId: string;
  readonly declarerName: string;
  readonly winnerId: string;
  readonly winnerName: string;
  readonly scoringReason: "GIN" | "KNOCK" | "UNDERCUT";
  readonly pointsAwarded: number;
  readonly players: readonly [RevealedPlayerHandView, RevealedPlayerHandView];
  readonly scoresAfter: readonly [HandScoreView, HandScoreView];
}

export interface CancelledHandResultView {
  readonly kind: "CANCELLED";
  readonly handNumber: number;
  readonly reason: "STOCK_REDUCED_TO_TWO";
  readonly pointsAwarded: 0;
  readonly scoresAfter: readonly [HandScoreView, HandScoreView];
}

/** Revealed cards are present only after an engine-scored hand. */
export type HandResultView = ScoredHandResultView | CancelledHandResultView;

export interface PlayerGameView {
  readonly gameId: string;
  readonly version: number;
  readonly status: "WAITING" | "PLAYING" | "HAND_COMPLETE" | "COMPLETE";
  readonly phase: string;
  readonly rules: { readonly knockThreshold: number; readonly ginBonus: number; readonly undercutBonus: number; readonly matchTarget: number };
  readonly you: {
    readonly seat: 0 | 1;
    readonly displayName: string;
    readonly score: number;
    readonly hand: readonly PublicCard[];
    /** Rule-valid groups derived only from the caller's own cards. */
    readonly meldCandidates?: readonly PublicMeld[];
  };
  readonly opponent?: { readonly seat: 0 | 1; readonly displayName: string; readonly score: number; readonly cardCount: number };
  readonly dealerId: string | null;
  readonly currentPlayerId?: string;
  readonly stockCount: number;
  readonly discardPile: readonly PublicCard[];
  readonly initialUpcard?: PublicCard;
  readonly legalControls: readonly LegalControl[];
  /** Player-safe, card-specific restrictions for the viewer's active turn. */
  readonly turnRestrictions?: TurnRestrictions;
  /** The stock card received on the viewer's current discard decision. */
  readonly drawnStockCardId?: string;
  /** Active-player-only, server-derived outcomes for each legal discard candidate. */
  readonly discardOutcomes?: readonly DiscardOutcomeView[];
  readonly handResult?: HandResultView;
  readonly nextHandReadiness?: { readonly you: boolean; readonly opponent: boolean };
  readonly gameResult?: GameResultView;
  /** Rematch state is participant-safe metadata, never canonical game state. */
  readonly rematch?: { readonly requestedBy: "YOU" | "OPPONENT" };
}

/**
 * Presentation availability for actions that use the selected card as a discard.
 * The server still evaluates every submitted action; this only reflects its safe
 * turn restriction in the browser.
 */
export function selectedDiscardActionAvailability(
  game: Pick<PlayerGameView, "legalControls" | "turnRestrictions" | "discardOutcomes">,
  selectedCardId?: string,
) {
  const hasControl = (control: LegalControl) => game.legalControls.includes(control);
  const isProhibitedDiscard = selectedCardId !== undefined
    && game.turnRestrictions?.cannotDiscardCardId === selectedCardId;
  const outcome = game.discardOutcomes?.find((item) => item.cardId === selectedCardId);
  const canUseSelectedDiscard = selectedCardId !== undefined && !isProhibitedDiscard && outcome !== undefined;

  return {
    isProhibitedDiscard,
    canDiscard: hasControl("DISCARD") && canUseSelectedDiscard,
    canKnock: hasControl("KNOCK") && canUseSelectedDiscard && outcome.declaration === "KNOCK",
    canGin: hasControl("GIN") && canUseSelectedDiscard && outcome.declaration === "GIN",
    deadwoodValue: outcome?.deadwoodValue,
  };
}

/** A completed hand is a result view, never an active game table. */
export function gameplayControlsAreAvailable(game: Pick<PlayerGameView, "status">): boolean {
  return game.status === "PLAYING";
}
