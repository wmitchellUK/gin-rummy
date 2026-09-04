import type { Card, GameRules, PlayerId } from "@/src/game";

export type BotProfile = "CASUAL_V1";

export interface BotRandomSource {
  nextFloat(): number;
}

export interface BotObservation {
  readonly botPlayerId: PlayerId;
  readonly phase:
    | "OPENING_NON_DEALER"
    | "OPENING_DEALER"
    | "AWAITING_DRAW"
    | "AWAITING_DISCARD"
    | "HAND_COMPLETE";
  readonly hand: readonly Card[];
  readonly rules: GameRules;
  readonly stockCount: number;
  readonly topDiscard?: Card;
  readonly drawRestriction?: "EITHER_PILE" | "STOCK_ONLY_AFTER_OPENING_PASSES";
  readonly forbiddenDiscardId?: string | null;
  readonly publicKnownCards: readonly Card[];
  readonly recentOpponentTakes: readonly Card[];
}

export type BotIntent =
  | { readonly type: "PASS_INITIAL_UPCARD" }
  | { readonly type: "TAKE_INITIAL_UPCARD" }
  | { readonly type: "DRAW_STOCK" }
  | { readonly type: "DRAW_DISCARD" }
  | { readonly type: "DISCARD"; readonly cardId: string }
  | { readonly type: "KNOCK"; readonly cardId: string }
  | { readonly type: "GIN"; readonly cardId: string }
  | { readonly type: "START_NEXT_HAND" };
