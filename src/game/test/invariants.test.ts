import { describe, expect, it } from "vitest";
import { applyAction, createWaitingGame, DEFAULT_GAME_RULES, standardDeck, validateGameState, validateRules } from "../index";
import type { ActionId, Card, GameAction, GameState } from "../types";
import { AID, P1, P2 } from "./card-fixtures";
import { drawState, startedState } from "./state-fixtures";

const action = (deck: readonly Card[]): GameAction => ({
  type: "START_GAME", actorId: "SYSTEM", actionId: AID, expectedVersion: 0, opponentId: P2, dealPlan: { deck, dealerId: P1 },
});
const code = (result: ReturnType<typeof applyAction>) => result.ok ? "OK" : result.error.code;

describe("state and deal integrity", () => {
  it("accepts default rules and rejects each invalid numeric field", () => {
    expect(validateRules(DEFAULT_GAME_RULES)).toEqual({ ok: true });
    for (const rules of [
      { ...DEFAULT_GAME_RULES, knockThreshold: -1 }, { ...DEFAULT_GAME_RULES, ginBonus: 1.5 },
      { ...DEFAULT_GAME_RULES, undercutBonus: -1 }, { ...DEFAULT_GAME_RULES, matchTarget: 0 },
    ]) expect(validateRules(rules)).toMatchObject({ ok: false, code: "INVALID_RULES" });
  });

  it("rejects invalid rules before a stale version", () => {
    const state = { ...createWaitingGame("game", P1), rules: { ...DEFAULT_GAME_RULES, matchTarget: 0 } } as GameState;
    expect(code(applyAction(state, { ...action(standardDeck()), expectedVersion: 99 }))).toBe("INVALID_RULES");
  });

  it("rejects incomplete deal plans", () => {
    expect(code(applyAction(createWaitingGame("game", P1), action(standardDeck().slice(0, 51))))).toBe("INVALID_DEAL_PLAN");
  });

  it("rejects duplicate rank/suit identities in a deal plan", () => {
    const deck = [...standardDeck()];
    deck[51] = deck[0]!;
    expect(code(applyAction(createWaitingGame("game", P1), action(deck)))).toBe("DUPLICATE_CARD");
  });

  it("rejects a mismatched card id in a deal plan", () => {
    const deck = [...standardDeck()];
    deck[0] = { ...deck[0]!, id: "wrong" as Card["id"] };
    expect(code(applyAction(createWaitingGame("game", P1), action(deck)))).toBe("MALFORMED_CARD");
  });

  it("rejects a missing canonical-state card", () => {
    const state = startedState();
    const corrupt = { ...state, stock: state.stock.slice(1) } as GameState;
    expect(validateGameState(corrupt)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("rejects duplicate and malformed canonical-state cards specifically", () => {
    const state = startedState();
    const duplicate = { ...state, stock: [state.stock[1]!, ...state.stock.slice(1)] } as GameState;
    expect(validateGameState(duplicate)).toMatchObject({ ok: false, code: "DUPLICATE_CARD" });
    const malformed = { ...state, stock: [{ ...state.stock[0]!, id: "bad" as Card["id"] }, ...state.stock.slice(1)] } as GameState;
    expect(validateGameState(malformed)).toMatchObject({ ok: false, code: "MALFORMED_CARD" });
  });

  it("rejects wrong hand sizes while preserving all 52 cards", () => {
    const state = startedState();
    const moved = state.players[0].hand[0]!;
    const corrupt = { ...state, players: [{ ...state.players[0], hand: state.players[0].hand.slice(1) }, state.players[1]], stock: [...state.stock, moved] } as GameState;
    expect(validateGameState(corrupt)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("rejects an invalid current player", () => {
    const state = startedState();
    const corrupt = { ...state, currentPlayerId: "stranger" } as unknown as GameState;
    expect(validateGameState(corrupt)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("rejects an unknown phase instead of throwing while applying an action", () => {
    const state = { ...startedState(), phase: "UNKNOWN_PHASE" } as unknown as GameState;
    expect(validateGameState(state)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(code(applyAction(state, { type: "PASS_INITIAL_UPCARD", actorId: P2, actionId: AID, expectedVersion: state.version }))).toBe("INVALID_STATE");
  });

  it("rejects score movement fabricated into a cancelled hand", () => {
    const drawingState = drawState(
      startedState().players[0].hand,
      startedState().players[1].hand,
      3,
    );
    const cancelled = applyAction(drawingState, { type: "DRAW_STOCK", actorId: P1, actionId: AID, expectedVersion: drawingState.version });
    if (!cancelled.ok || cancelled.nextState.phase !== "HAND_COMPLETE") throw new Error("Could not create cancelled hand");
    const alteredResult = {
      ...cancelled.nextState.handResult,
      scoresAfter: { [P1]: 1, [P2]: 0 },
    };
    const corrupt = {
      ...cancelled.nextState,
      players: [{ ...cancelled.nextState.players[0], matchScore: 1 }, cancelled.nextState.players[1]],
      handHistory: [alteredResult],
      handResult: alteredResult,
    } as GameState;
    expect(validateGameState(corrupt)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("rejects an active stock below three even with zone integrity", () => {
    const state = startedState();
    const corrupt = { ...state, stock: state.stock.slice(0, 2), discardPile: [...state.stock.slice(2), ...state.discardPile] } as GameState;
    expect(validateGameState(corrupt)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("rejects an opening state whose initial up-card disagrees", () => {
    const state = startedState();
    const corrupt = { ...state, initialUpcard: state.stock[0]! } as GameState;
    expect(validateGameState(corrupt)).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("returns phase errors before actor membership errors", () => {
    const state = createWaitingGame("game", P1);
    const result = applyAction(state, { type: "PASS_INITIAL_UPCARD", actorId: "stranger" as typeof P1, actionId: "x" as ActionId, expectedVersion: 0 });
    expect(code(result)).toBe("ACTION_NOT_ALLOWED_IN_PHASE");
  });

  it("returns UNKNOWN_PLAYER for a phase-valid action by a non-member", () => {
    const state = startedState();
    const result = applyAction(state, { type: "PASS_INITIAL_UPCARD", actorId: "stranger" as typeof P1, actionId: "x" as ActionId, expectedVersion: state.version });
    expect(code(result)).toBe("UNKNOWN_PLAYER");
  });

  it("keeps all nested inputs unchanged on invariant failure", () => {
    const state = startedState();
    const corrupt = { ...state, stock: state.stock.slice(1) } as GameState;
    const snapshot = structuredClone(corrupt);
    const result = applyAction(corrupt, { type: "PASS_INITIAL_UPCARD", actorId: P2, actionId: AID, expectedVersion: corrupt.version });
    expect(result.ok).toBe(false);
    expect(corrupt).toEqual(snapshot);
  });
});
