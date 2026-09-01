export * from "./types";
export { SUITS, RANKS, cardId, cardValue, compareCards, createCard, isCanonicalCard, rankNumber, sortCards, standardDeck, suitNumber } from "./cards";
export { shuffledDeck } from "./shuffle";
export { createMeld, generateCandidateMelds, isValidRun, isValidSet, meldSignature } from "./melds";
export { analyzeHand, enumerateMinimumDeadwoodArrangements } from "./hand-analysis";
export { optimizeLayoffs } from "./layoffs";
export { validateDealPlan } from "./deal";
export { validateGameState, validateRules } from "./invariants";
export { applyAction } from "./apply-action";

import type { GameRules, PlayerId, WaitingForPlayerState } from "./types";

export const DEFAULT_GAME_RULES: GameRules = Object.freeze({ knockThreshold: 10, ginBonus: 25, undercutBonus: 25, matchTarget: 100 });

export function createWaitingGame(gameId: string, creatorId: PlayerId, rules: GameRules = DEFAULT_GAME_RULES): WaitingForPlayerState {
  return {
    gameId, version: 0, rules: { ...rules }, players: [{ id: creatorId, hand: [], matchScore: 0 }], handNumber: 0,
    dealerId: null, stock: [], discardPile: [], handHistory: [], phase: "WAITING_FOR_PLAYER",
  };
}
