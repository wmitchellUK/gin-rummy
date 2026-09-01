export type PlayerId = string & { readonly __brand: "PlayerId" };
export type ActionId = string & { readonly __brand: "ActionId" };
export type CardId = string & { readonly __brand: "CardId" };

export type Suit = "CLUBS" | "DIAMONDS" | "HEARTS" | "SPADES";
export type Rank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface Run {
  readonly kind: "RUN";
  readonly suit: Suit;
  readonly cards: readonly [Card, Card, Card, ...Card[]];
}

export interface Set {
  readonly kind: "SET";
  readonly rank: Rank;
  readonly cards: readonly [Card, Card, Card] | readonly [Card, Card, Card, Card];
}

export type Meld = Run | Set;

export interface GameRules {
  readonly knockThreshold: number;
  readonly ginBonus: number;
  readonly undercutBonus: number;
  readonly matchTarget: number;
}

export interface HandAnalysis {
  readonly melds: readonly Meld[];
  readonly deadwoodCards: readonly Card[];
  readonly deadwoodValue: number;
  readonly arrangementSignature: string;
}

export interface Layoff {
  readonly card: Card;
  readonly targetMeldSignatureBefore: string;
  readonly resultingMeld: Meld;
}

export interface PlayerHandResult {
  readonly playerId: PlayerId;
  readonly revealedHand: readonly Card[];
  readonly melds: readonly Meld[];
  readonly originalDeadwoodCards: readonly Card[];
  readonly originalDeadwoodValue: number;
  readonly layoffs: readonly Layoff[];
  readonly finalDeadwoodCards: readonly Card[];
  readonly finalDeadwoodValue: number;
}

export interface ScoredHandResult {
  readonly kind: "SCORED";
  readonly handNumber: number;
  readonly dealerId: PlayerId;
  readonly declaration: "KNOCK" | "GIN";
  readonly declarerId: PlayerId;
  readonly finalDiscard: Card;
  readonly players: readonly [PlayerHandResult, PlayerHandResult];
  readonly winnerId: PlayerId;
  readonly scoringReason: "GIN" | "KNOCK" | "UNDERCUT";
  readonly pointsAwarded: number;
  readonly scoresBefore: Readonly<Record<PlayerId, number>>;
  readonly scoresAfter: Readonly<Record<PlayerId, number>>;
}

export interface CancelledHandResult {
  readonly kind: "CANCELLED";
  readonly handNumber: number;
  readonly dealerId: PlayerId;
  readonly reason: "STOCK_REDUCED_TO_TWO";
  readonly pointsAwarded: 0;
  readonly scoresAfter: Readonly<Record<PlayerId, number>>;
}

export type HandResult = ScoredHandResult | CancelledHandResult;

export interface GameResult {
  readonly winnerId: PlayerId;
  readonly loserId: PlayerId;
  readonly finalScores: Readonly<Record<PlayerId, number>>;
  readonly matchTarget: number;
  readonly completedHands: readonly HandResult[];
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly hand: readonly Card[];
  readonly matchScore: number;
}

interface GameStateBase {
  readonly gameId: string;
  readonly version: number;
  readonly rules: GameRules;
  readonly players: readonly PlayerState[];
  readonly handNumber: number;
  readonly dealerId: PlayerId | null;
  readonly stock: readonly Card[];
  readonly discardPile: readonly Card[];
  readonly handHistory: readonly HandResult[];
}

export interface WaitingForPlayerState extends GameStateBase {
  readonly phase: "WAITING_FOR_PLAYER";
  readonly players: readonly [PlayerState];
  readonly handNumber: 0;
  readonly dealerId: null;
  readonly stock: readonly [];
  readonly discardPile: readonly [];
}

interface OpeningStateBase extends GameStateBase {
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly initialUpcard: Card;
}

export interface OpeningNonDealerState extends OpeningStateBase {
  readonly phase: "OPENING_NON_DEALER";
  readonly currentPlayerId: PlayerId;
}

export interface OpeningDealerState extends OpeningStateBase {
  readonly phase: "OPENING_DEALER";
  readonly currentPlayerId: PlayerId;
  readonly nonDealerPassed: true;
}

export interface AwaitingDrawState extends GameStateBase {
  readonly phase: "AWAITING_DRAW";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly currentPlayerId: PlayerId;
  readonly drawRestriction: "EITHER_PILE" | "STOCK_ONLY_AFTER_OPENING_PASSES";
}

export interface AwaitingDiscardState extends GameStateBase {
  readonly phase: "AWAITING_DISCARD";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly currentPlayerId: PlayerId;
  readonly drawSource: "STOCK" | "DISCARD" | "INITIAL_UPCARD";
  /** The card received for this discard decision. Optional for legacy persisted games. */
  readonly drawnCardId?: CardId;
  readonly forbiddenDiscardId: CardId | null;
}

export interface HandCompleteState extends GameStateBase {
  readonly phase: "HAND_COMPLETE";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly handResult: HandResult;
  readonly nextHandAcknowledgements: readonly PlayerId[];
}

export interface GameCompleteState extends GameStateBase {
  readonly phase: "GAME_COMPLETE";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly gameResult: GameResult;
}

export type GameState =
  | WaitingForPlayerState | OpeningNonDealerState | OpeningDealerState
  | AwaitingDrawState | AwaitingDiscardState | HandCompleteState | GameCompleteState;

export interface DealPlan { readonly deck: readonly Card[] }
export interface FirstDealPlan extends DealPlan { readonly dealerId: PlayerId }
export interface RandomSource { nextUint32(): number }

interface ActionBase { readonly actionId: ActionId; readonly expectedVersion: number }
interface PlayerActionBase extends ActionBase { readonly actorId: PlayerId }

export type GameAction =
  | (ActionBase & { readonly type: "START_GAME"; readonly actorId: "SYSTEM"; readonly opponentId: PlayerId; readonly dealPlan: FirstDealPlan })
  | (PlayerActionBase & { readonly type: "PASS_INITIAL_UPCARD" })
  | (PlayerActionBase & { readonly type: "TAKE_INITIAL_UPCARD" })
  | (PlayerActionBase & { readonly type: "DRAW_STOCK" })
  | (PlayerActionBase & { readonly type: "DRAW_DISCARD" })
  | (PlayerActionBase & { readonly type: "DISCARD"; readonly cardId: CardId })
  | (PlayerActionBase & { readonly type: "KNOCK"; readonly discardCardId: CardId })
  | (PlayerActionBase & { readonly type: "GIN"; readonly discardCardId: CardId })
  | (PlayerActionBase & { readonly type: "START_NEXT_HAND"; readonly dealPlan?: DealPlan });

export type EventVisibility =
  | { readonly kind: "PUBLIC" }
  | { readonly kind: "PLAYER"; readonly playerId: PlayerId }
  | { readonly kind: "SERVER_ONLY" };

type EventMeta = { readonly stateVersion: number; readonly visibility: EventVisibility };
export type GameEvent = EventMeta & (
  | { readonly type: "GAME_STARTED"; readonly dealerId: PlayerId }
  | { readonly type: "HAND_STARTED"; readonly handNumber: number; readonly dealerId: PlayerId }
  | { readonly type: "INITIAL_UPCARD_REVEALED"; readonly card: Card }
  | { readonly type: "INITIAL_UPCARD_PASSED"; readonly playerId: PlayerId }
  | { readonly type: "INITIAL_UPCARD_TAKEN"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "STOCK_DRAWN"; readonly playerId: PlayerId; readonly stockCount: number }
  | { readonly type: "PRIVATE_STOCK_CARD_RECEIVED"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "DISCARD_DRAWN"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "CARD_DISCARDED"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "HAND_COMPLETED"; readonly result: ScoredHandResult }
  | { readonly type: "HAND_CANCELLED"; readonly result: CancelledHandResult }
  | { readonly type: "NEXT_HAND_ACKNOWLEDGED"; readonly playerId: PlayerId }
  | { readonly type: "GAME_COMPLETED"; readonly result: GameResult }
);

export type GameErrorCode =
  | "INVALID_STATE" | "INVALID_RULES" | "INVALID_DEAL_PLAN" | "DUPLICATE_CARD"
  | "MALFORMED_CARD" | "STALE_VERSION" | "UNKNOWN_PLAYER" | "WRONG_PLAYER"
  | "ACTION_NOT_ALLOWED_IN_PHASE" | "STOCK_DRAW_REQUIRED" | "CARD_NOT_IN_HAND"
  | "ILLEGAL_REDISCARD" | "STOCK_UNAVAILABLE" | "KNOCK_DEADWOOD_TOO_HIGH"
  | "GIN_ACTION_REQUIRED" | "GIN_REQUIRES_ZERO_DEADWOOD"
  | "NEXT_HAND_ALREADY_ACKNOWLEDGED" | "NEXT_HAND_DEAL_PLAN_REQUIRED"
  | "UNEXPECTED_DEAL_PLAN" | "GAME_ALREADY_COMPLETE";

export interface GameError {
  readonly code: GameErrorCode;
  readonly message: string;
  readonly currentVersion: number;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export type ApplyActionResult =
  | { readonly ok: true; readonly nextState: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly error: GameError };

export interface LayoffResult {
  readonly opponentAnalysis: HandAnalysis;
  readonly layoffs: readonly Layoff[];
  readonly finalDeadwoodCards: readonly Card[];
  readonly finalDeadwoodValue: number;
}
