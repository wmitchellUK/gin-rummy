import { applyAction, createWaitingGame, DEFAULT_GAME_RULES, standardDeck } from "../index";
import type { AwaitingDiscardState, AwaitingDrawState, Card, GameRules, GameState, HandResult, PlayerHandResult, PlayerState } from "../types";
import { AID, P1, P2 } from "./card-fixtures";

export function startedState(deck: readonly Card[] = standardDeck(), dealerId = P1): Extract<GameState, { phase: "OPENING_NON_DEALER" }> {
  const result = applyAction(createWaitingGame("game", P1), { type: "START_GAME", actorId: "SYSTEM", actionId: AID, expectedVersion: 0, opponentId: P2, dealPlan: { deck, dealerId } });
  if (!result.ok || result.nextState.phase !== "OPENING_NON_DEALER") throw new Error("Could not start fixture game");
  return result.nextState;
}

function remainingAfter(hands: readonly (readonly Card[])[]): readonly Card[] {
  const used = new Set(hands.flat().map((card) => card.id));
  if (used.size !== hands.flat().length) throw new Error("Fixture hands contain duplicates");
  return standardDeck().filter((card) => !used.has(card.id));
}

export function discardState(
  actorHand: readonly Card[], opponentHand: readonly Card[],
  options: { readonly rules?: GameRules; readonly p1Score?: number; readonly p2Score?: number; readonly forbidden?: Card["id"] | null } = {},
): AwaitingDiscardState {
  const remaining = remainingAfter([actorHand, opponentHand]);
  const players: readonly [PlayerState, PlayerState] = [
    { id: P1, hand: actorHand, matchScore: options.p1Score ?? 0 },
    { id: P2, hand: opponentHand, matchScore: options.p2Score ?? 0 },
  ];
  const priorPlayer = (player: PlayerState): PlayerHandResult => ({ playerId: player.id, revealedHand: [], melds: [], originalDeadwoodCards: [], originalDeadwoodValue: 0, layoffs: [], finalDeadwoodCards: [], finalDeadwoodValue: 0 });
  const hasPriorScore = players.some((player) => player.matchScore > 0);
  const priorHistory: readonly HandResult[] = hasPriorScore ? [{
    kind: "SCORED", handNumber: 1, dealerId: P2, declaration: "GIN", declarerId: options.p1Score ? P1 : P2,
    finalDiscard: remaining[0]!, players: [priorPlayer(players[0]), priorPlayer(players[1])],
    winnerId: options.p1Score ? P1 : P2, scoringReason: "GIN", pointsAwarded: options.p1Score ?? options.p2Score ?? 0,
    scoresBefore: { [P1]: 0, [P2]: 0 }, scoresAfter: { [P1]: options.p1Score ?? 0, [P2]: options.p2Score ?? 0 },
  }] : [];
  return {
    gameId: "game", version: 7, rules: options.rules ?? DEFAULT_GAME_RULES, players, handNumber: hasPriorScore ? 2 : 1, dealerId: P1,
    stock: remaining.slice(0, 20), discardPile: remaining.slice(20), handHistory: priorHistory, phase: "AWAITING_DISCARD",
    currentPlayerId: P1, drawSource: options.forbidden ? "DISCARD" : "STOCK", drawnCardId: options.forbidden ?? actorHand.at(-1)?.id, forbiddenDiscardId: options.forbidden ?? null,
  };
}

export function drawState(actorHand: readonly Card[], opponentHand: readonly Card[], stockSize = 20): AwaitingDrawState {
  const remaining = remainingAfter([actorHand, opponentHand]);
  return {
    gameId: "game", version: 4, rules: DEFAULT_GAME_RULES,
    players: [{ id: P1, hand: actorHand, matchScore: 0 }, { id: P2, hand: opponentHand, matchScore: 0 }],
    handNumber: 1, dealerId: P1, stock: remaining.slice(0, stockSize), discardPile: remaining.slice(stockSize), handHistory: [],
    phase: "AWAITING_DRAW", currentPlayerId: P1, drawRestriction: "EITHER_PILE",
  };
}
