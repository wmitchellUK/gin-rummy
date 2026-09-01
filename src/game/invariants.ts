import { isCanonicalCard, sortCards } from "./cards";
import type { Card, GameErrorCode, GameRules, GameState, PlayerId, ScoredHandResult } from "./types";

export interface ValidationSuccess { readonly ok: true }
export interface ValidationFailure { readonly ok: false; readonly code: Extract<GameErrorCode, "INVALID_STATE" | "INVALID_RULES" | "DUPLICATE_CARD" | "MALFORMED_CARD">; readonly message: string }
export type StateValidation = ValidationSuccess | ValidationFailure;

const integerAtLeast = (value: unknown, minimum: number) => Number.isInteger(value) && (value as number) >= minimum;

export function validateRules(rules: GameRules): StateValidation {
  if (!rules || !integerAtLeast(rules.knockThreshold, 0) || !integerAtLeast(rules.ginBonus, 0)
    || !integerAtLeast(rules.undercutBonus, 0) || !integerAtLeast(rules.matchTarget, 1)) {
    return { ok: false, code: "INVALID_RULES", message: "Game rules are invalid." };
  }
  return { ok: true };
}

function fail(message: string): ValidationFailure { return { ok: false, code: "INVALID_STATE", message }; }

function scoredResultAgrees(state: Exclude<GameState, { phase: "WAITING_FOR_PLAYER" }>, result: ScoredHandResult): boolean {
  if (result.finalDiscard.id !== state.discardPile[0]?.id || !state.players.some((player) => player.id === result.declarerId)
    || !state.players.some((player) => player.id === result.winnerId) || !integerAtLeast(result.pointsAwarded, 0)) return false;
  for (const player of state.players) {
    const recorded = result.players.find((item) => item.playerId === player.id);
    if (!recorded || sortCards(recorded.revealedHand).map((card) => card.id).join(",") !== sortCards(player.hand).map((card) => card.id).join(",")
      || result.scoresAfter[player.id] !== player.matchScore) return false;
  }
  return new globalThis.Set(result.players.map((player) => player.playerId)).size === 2;
}

export function validateGameState(state: GameState): StateValidation {
  if (!state || typeof state !== "object" || typeof state.gameId !== "string" || !integerAtLeast(state.version, 0)
    || !integerAtLeast(state.handNumber, 0) || !Array.isArray(state.players) || !Array.isArray(state.stock)
    || !Array.isArray(state.discardPile) || !Array.isArray(state.handHistory)) return fail("Game state structure is invalid.");
  const rules = validateRules(state.rules);
  if (!rules.ok) return rules;
  if (state.players.some((player) => typeof player.id !== "string" || player.id.length === 0 || !Array.isArray(player.hand) || !integerAtLeast(player.matchScore, 0))) return fail("Player state is invalid.");
  if (new globalThis.Set(state.players.map((player) => player.id)).size !== state.players.length) return fail("Player IDs must be unique.");

  if (state.phase === "WAITING_FOR_PLAYER") {
    if (state.players.length !== 1 || state.handNumber !== 0 || state.dealerId !== null || state.stock.length || state.discardPile.length
      || state.players[0].hand.length || state.players[0].matchScore !== 0 || state.handHistory.length) return fail("Waiting state is inconsistent.");
    return { ok: true };
  }
  if (state.players.length !== 2 || !state.dealerId || !state.players.some((player) => player.id === state.dealerId) || state.handNumber < 1) return fail("Active player state is inconsistent.");
  const handIsComplete = state.phase === "HAND_COMPLETE" || state.phase === "GAME_COMPLETE";
  if (state.handHistory.length !== state.handNumber - (handIsComplete ? 0 : 1)) return fail("Hand history length is inconsistent.");
  for (let index = 0; index < state.handHistory.length; index += 1) {
    const result = state.handHistory[index]!;
    if (result.handNumber !== index + 1 || (index > 0 && result.dealerId === state.handHistory[index - 1]!.dealerId)) return fail("Hand history order is invalid.");
  }
  if (state.handHistory.length > 0) {
    const latestScores = state.handHistory.at(-1)!.scoresAfter;
    if (state.players.some((player) => latestScores[player.id] !== player.matchScore)) return fail("Player scores do not agree with history.");
    const expectedDealer = handIsComplete ? state.handHistory.at(-1)!.dealerId
      : (state.handHistory.at(-1)!.dealerId === state.players[0].id ? state.players[1].id : state.players[0].id);
    if (state.dealerId !== expectedDealer) return fail("The dealer does not agree with hand history.");
  }
  const allCards = [...state.players.flatMap((player) => player.hand), ...state.stock, ...state.discardPile];
  if (allCards.some((card) => !isCanonicalCard(card))) return { ok: false, code: "MALFORMED_CARD", message: "A card is malformed." };
  if (new globalThis.Set(allCards.map((card) => `${card.rank}:${card.suit}`)).size !== allCards.length) return { ok: false, code: "DUPLICATE_CARD", message: "A card appears more than once." };
  if (allCards.length !== 52) return fail("The canonical deck is incomplete.");
  if (state.discardPile.length === 0
    && !(state.phase === "AWAITING_DISCARD" && state.drawSource === "INITIAL_UPCARD")) return fail("The discard pile is empty.");
  const handSizes = state.players.map((player) => player.hand.length).sort((a, b) => a - b).join(",");
  const active = !handIsComplete;
  if (active && state.stock.length < 3) return fail("An active hand has too few stock cards.");
  if (state.phase === "AWAITING_DISCARD") {
    const actor = state.players.find((player) => player.id === state.currentPlayerId);
    const opponent = state.players.find((player) => player.id !== state.currentPlayerId);
    if (!actor || !opponent || actor.hand.length !== 11 || opponent.hand.length !== 10) return fail("Discard phase hand sizes are invalid.");
    if (state.forbiddenDiscardId !== null && !actor.hand.some((card) => card.id === state.forbiddenDiscardId)) return fail("The forbidden discard is invalid.");
  } else if (active && handSizes !== "10,10") return fail("Active hand sizes are invalid.");
  if ("currentPlayerId" in state && !state.players.some((player) => player.id === state.currentPlayerId)) return fail("The current player is invalid.");
  if (state.phase === "OPENING_NON_DEALER" || state.phase === "OPENING_DEALER") {
    if (state.initialUpcard.id !== state.discardPile[0]?.id) return fail("The opening up-card is inconsistent.");
    const expected = state.phase === "OPENING_DEALER" ? state.dealerId : state.players.find((player) => player.id !== state.dealerId)!.id;
    if (state.currentPlayerId !== expected) return fail("The opening turn owner is invalid.");
    if (state.phase === "OPENING_DEALER" && state.nonDealerPassed !== true) return fail("The opening pass state is invalid.");
  }
  if (state.phase === "AWAITING_DRAW" && state.drawRestriction !== "EITHER_PILE" && state.drawRestriction !== "STOCK_ONLY_AFTER_OPENING_PASSES") return fail("The draw restriction is invalid.");
  if (state.phase === "AWAITING_DISCARD") {
    const needsRestriction = state.drawSource === "DISCARD" || state.drawSource === "INITIAL_UPCARD";
    if (!(["STOCK", "DISCARD", "INITIAL_UPCARD"] as const).includes(state.drawSource)
      || (needsRestriction && state.forbiddenDiscardId === null) || (!needsRestriction && state.forbiddenDiscardId !== null)) return fail("The draw source is invalid.");
  }
  if (state.phase === "HAND_COMPLETE") {
    const last = state.handHistory.at(-1);
    if (last !== state.handResult && JSON.stringify(last) !== JSON.stringify(state.handResult)) return fail("Hand history is inconsistent.");
    if (state.nextHandAcknowledgements.some((id) => !state.players.some((player) => player.id === id)) || new globalThis.Set(state.nextHandAcknowledgements).size !== state.nextHandAcknowledgements.length) return fail("Next-hand acknowledgements are invalid.");
    if (state.players.some((player) => player.matchScore >= state.rules.matchTarget)) return fail("A completed hand should have completed the game.");
    if (state.handResult.kind === "SCORED" && handSizes !== "10,10") return fail("Scored hand sizes are invalid.");
    if (state.handResult.kind === "CANCELLED" && handSizes !== "10,11") return fail("Cancelled hand sizes are invalid.");
    if (state.handResult.handNumber !== state.handNumber || state.handResult.dealerId !== state.dealerId) return fail("The completed-hand result is invalid.");
    if (state.handResult.kind === "SCORED" && !scoredResultAgrees(state, state.handResult)) return fail("The scored-hand result is invalid.");
  }
  if (state.phase === "GAME_COMPLETE") {
    const winner = state.players.find((player) => player.id === state.gameResult.winnerId);
    const loser = state.players.find((player) => player.id === state.gameResult.loserId);
    if (!winner || !loser || winner.id === loser.id || winner.matchScore < state.rules.matchTarget || state.handHistory.length === 0
      || state.gameResult.matchTarget !== state.rules.matchTarget || JSON.stringify(state.gameResult.completedHands) !== JSON.stringify(state.handHistory)
      || state.players.some((player) => state.gameResult.finalScores[player.id] !== player.matchScore) || handSizes !== "10,10"
      || state.handHistory.at(-1)!.kind !== "SCORED" || !scoredResultAgrees(state, state.handHistory.at(-1) as ScoredHandResult)) return fail("Game result is invalid.");
  }
  return { ok: true };
}

export function otherPlayer(players: readonly [{ readonly id: PlayerId }, { readonly id: PlayerId }], id: PlayerId): PlayerId {
  return players[0].id === id ? players[1].id : players[0].id;
}

export function allStateCards(state: GameState): readonly Card[] {
  return [...state.players.flatMap((player) => player.hand), ...state.stock, ...state.discardPile];
}
