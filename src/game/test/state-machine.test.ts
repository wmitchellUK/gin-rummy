import { describe, expect, it } from "vitest";
import { applyAction, createWaitingGame, standardDeck, validateGameState } from "../index";
import type { ActionId, GameAction, GameState } from "../types";
import { AID, hand, id, P1, P2 } from "./card-fixtures";
import { discardState, drawState, startedState } from "./state-fixtures";

let actionCounter = 0;
const aid = () => `action-${++actionCounter}` as ActionId;
const expectOk = (result: ReturnType<typeof applyAction>): Extract<typeof result, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(validateGameState(result.nextState)).toEqual({ ok: true });
  return result;
};
const expectError = (result: ReturnType<typeof applyAction>, code: string) => {
  expect(result).toMatchObject({ ok: false, error: { code } });
};

function bothOpeningPasses(): Extract<GameState, { phase: "AWAITING_DRAW" }> {
  const initial = startedState();
  const first = expectOk(applyAction(initial, { type: "PASS_INITIAL_UPCARD", actorId: P2, actionId: aid(), expectedVersion: initial.version })).nextState;
  const second = expectOk(applyAction(first, { type: "PASS_INITIAL_UPCARD", actorId: P1, actionId: aid(), expectedVersion: first.version })).nextState;
  if (second.phase !== "AWAITING_DRAW") throw new Error("Unexpected fixture phase");
  return second;
}

describe("explicit state machine", () => {
  it("starts with the trusted dealer and exact round-robin deal", () => {
    const waiting = createWaitingGame("game", P1);
    const result = expectOk(applyAction(waiting, { type: "START_GAME", actorId: "SYSTEM", actionId: AID, expectedVersion: 0, opponentId: P2, dealPlan: { deck: standardDeck(), dealerId: P1 } }));
    expect(result.nextState).toMatchObject({ phase: "OPENING_NON_DEALER", version: 1, dealerId: P1, currentPlayerId: P2, handNumber: 1 });
    expect(result.nextState.players.find((player) => player.id === P1)!.hand.map((card) => card.id)).toContain("A:DIAMONDS");
    expect(result.nextState.players.find((player) => player.id === P2)!.hand.map((card) => card.id)).toContain("A:CLUBS");
    expect(result.events.map((event) => event.type)).toEqual(["GAME_STARTED", "HAND_STARTED", "INITIAL_UPCARD_REVEALED"]);
    expect(result.events.every((event) => event.stateVersion === 1)).toBe(true);
  });

  it("lets the non-dealer take the opening up-card and forbids rediscard", () => {
    const state = startedState();
    const upcard = state.initialUpcard;
    const result = expectOk(applyAction(state, { type: "TAKE_INITIAL_UPCARD", actorId: P2, actionId: aid(), expectedVersion: state.version }));
    expect(result.nextState).toMatchObject({ phase: "AWAITING_DISCARD", currentPlayerId: P2, forbiddenDiscardId: upcard.id });
    expect(result.nextState.players.find((player) => player.id === P2)!.hand).toHaveLength(11);
    expectError(applyAction(result.nextState, { type: "DISCARD", actorId: P2, actionId: aid(), expectedVersion: result.nextState.version, cardId: upcard.id }), "ILLEGAL_REDISCARD");
    if (result.nextState.phase !== "AWAITING_DISCARD") throw new Error("Unexpected phase");
    const otherCard = result.nextState.players.find((player) => player.id === P2)!.hand.find((card) => card.id !== upcard.id)!;
    const discarded = expectOk(applyAction(result.nextState, { type: "DISCARD", actorId: P2, actionId: aid(), expectedVersion: result.nextState.version, cardId: otherCard.id })).nextState;
    expect(discarded).toMatchObject({ phase: "AWAITING_DRAW", currentPlayerId: P1, discardPile: [otherCard] });
  });

  it("lets the dealer take after the non-dealer passes", () => {
    const state = startedState();
    const passed = expectOk(applyAction(state, { type: "PASS_INITIAL_UPCARD", actorId: P2, actionId: aid(), expectedVersion: state.version })).nextState;
    expect(passed).toMatchObject({ phase: "OPENING_DEALER", currentPlayerId: P1, nonDealerPassed: true });
    const taken = expectOk(applyAction(passed, { type: "TAKE_INITIAL_UPCARD", actorId: P1, actionId: aid(), expectedVersion: passed.version })).nextState;
    expect(taken).toMatchObject({ phase: "AWAITING_DISCARD", currentPlayerId: P1 });
    expect(taken.players[0].hand).toHaveLength(11);
    if (taken.phase !== "AWAITING_DISCARD") throw new Error("Unexpected phase");
    const otherCard = taken.players[0].hand.find((card) => card.id !== taken.forbiddenDiscardId)!;
    const discarded = expectOk(applyAction(taken, { type: "DISCARD", actorId: P1, actionId: aid(), expectedVersion: taken.version, cardId: otherCard.id })).nextState;
    expect(discarded).toMatchObject({ phase: "AWAITING_DRAW", currentPlayerId: P2, discardPile: [otherCard] });
  });

  it("requires a stock draw after both opening passes", () => {
    const state = bothOpeningPasses();
    expect(state).toMatchObject({ currentPlayerId: P2, drawRestriction: "STOCK_ONLY_AFTER_OPENING_PASSES" });
    expectError(applyAction(state, { type: "DRAW_DISCARD", actorId: P2, actionId: aid(), expectedVersion: state.version }), "STOCK_DRAW_REQUIRED");
  });

  it("draws only the stock top and separates public and private events", () => {
    const state = bothOpeningPasses();
    const top = state.stock[0]!;
    const future = state.stock[1]!;
    const result = expectOk(applyAction(state, { type: "DRAW_STOCK", actorId: P2, actionId: aid(), expectedVersion: state.version }));
    expect(result.nextState.stock[0]).toEqual(future);
    expect(result.nextState.players.find((player) => player.id === P2)!.hand).toContainEqual(top);
    expect(result.events).toMatchObject([
      { type: "STOCK_DRAWN", visibility: { kind: "PUBLIC" }, stockCount: state.stock.length - 1 },
      { type: "PRIVATE_STOCK_CARD_RECEIVED", visibility: { kind: "PLAYER", playerId: P2 }, card: top },
    ]);
    expect(JSON.stringify(result.events[0])).not.toContain(future.id);
  });

  it("ordinary discard changes turn and enables either pile", () => {
    const draw = expectOk(applyAction(bothOpeningPasses(), { type: "DRAW_STOCK", actorId: P2, actionId: aid(), expectedVersion: 3 })).nextState;
    if (draw.phase !== "AWAITING_DISCARD") throw new Error("Unexpected phase");
    const discarded = expectOk(applyAction(draw, { type: "DISCARD", actorId: P2, actionId: aid(), expectedVersion: draw.version, cardId: draw.players[1].hand[0]!.id })).nextState;
    expect(discarded).toMatchObject({ phase: "AWAITING_DRAW", currentPlayerId: P1, drawRestriction: "EITHER_PILE" });
  });

  it("discard draw preserves deeper discard order and sets a restriction", () => {
    const state = drawState(hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"), hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 5♦"));
    const before = state.discardPile;
    const result = expectOk(applyAction(state, { type: "DRAW_DISCARD", actorId: P1, actionId: aid(), expectedVersion: state.version })).nextState;
    expect(result.phase).toBe("AWAITING_DISCARD");
    if (result.phase !== "AWAITING_DISCARD") return;
    expect(result.forbiddenDiscardId).toBe(before[0]!.id);
    expect(result.discardPile).toEqual(before.slice(1));
  });

  it.each(["DISCARD", "KNOCK", "GIN"] as const)("rejects illegal rediscard for %s", (type) => {
    const actor = hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 10♦ J♦ Q♦ K♦ 9♠");
    const opponent = hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♣ 5♦");
    const state = discardState(actor, opponent, { forbidden: id("9♠") });
    const common = { type, actorId: P1, actionId: aid(), expectedVersion: state.version };
    const action = type === "DISCARD" ? { ...common, cardId: id("9♠") } : { ...common, discardCardId: id("9♠") };
    expectError(applyAction(state, action as GameAction), "ILLEGAL_REDISCARD");
  });

  it("accepts a knock exactly at ten", () => {
    const state = discardState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ K♠ Q♣"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 5♦"),
    );
    const result = expectOk(applyAction(state, { type: "KNOCK", actorId: P1, actionId: aid(), expectedVersion: state.version, discardCardId: id("Q♣") }));
    expect(result.nextState.phase).toMatch(/HAND_COMPLETE|GAME_COMPLETE/);
  });

  it("rejects knock over ten without changing state", () => {
    const state = discardState(
      hand("A♥ 2♥ 3♥ 4♥ 5♥ 7♣ 7♦ 7♠ A♣ K♠ Q♣"),
      hand("2♣ 3♣ 4♣ 8♥ 9♥ 10♥ Q♠ Q♥ Q♦ 5♦"),
    );
    const snapshot = structuredClone(state);
    const result = applyAction(state, { type: "KNOCK", actorId: P1, actionId: aid(), expectedVersion: state.version, discardCardId: id("Q♣") });
    expectError(result, "KNOCK_DEADWOOD_TOO_HIGH");
    expect(state).toEqual(snapshot);
  });

  it("requires GIN for zero and zero for GIN", () => {
    const ginState = discardState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 10♦ J♦ Q♦ K♦ 9♠"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♣ 5♦"),
    );
    expectError(applyAction(ginState, { type: "KNOCK", actorId: P1, actionId: aid(), expectedVersion: ginState.version, discardCardId: id("9♠") }), "GIN_ACTION_REQUIRED");
    const nonGin = discardState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ K♠ Q♣"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 5♦"),
    );
    expectError(applyAction(nonGin, { type: "GIN", actorId: P1, actionId: aid(), expectedVersion: nonGin.version, discardCardId: id("Q♣") }), "GIN_REQUIRES_ZERO_DEADWOOD");
  });

  it("rejects wrong-player and stale actions in the specified order", () => {
    const state = startedState();
    expectError(applyAction(state, { type: "PASS_INITIAL_UPCARD", actorId: P1, actionId: aid(), expectedVersion: state.version }), "WRONG_PLAYER");
    expectError(applyAction(state, { type: "TAKE_INITIAL_UPCARD", actorId: P1, actionId: aid(), expectedVersion: state.version - 1 }), "STALE_VERSION");
  });

  it("cancels immediately when a stock draw leaves two cards", () => {
    const state = drawState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 5♦"),
      3,
    );
    const result = expectOk(applyAction(state, { type: "DRAW_STOCK", actorId: P1, actionId: aid(), expectedVersion: state.version }));
    expect(result.nextState).toMatchObject({ phase: "HAND_COMPLETE", stock: { length: 2 }, handResult: { kind: "CANCELLED", pointsAwarded: 0 } });
    expect(result.events.at(-1)).toMatchObject({ type: "HAND_CANCELLED", result: { kind: "CANCELLED" } });
    expect(JSON.stringify(result.events.at(-1))).not.toContain("revealedHand");
    expectError(applyAction(result.nextState, { type: "DISCARD", actorId: P1, actionId: aid(), expectedVersion: result.nextState.version, cardId: result.nextState.players[0].hand[0]!.id }), "ACTION_NOT_ALLOWED_IN_PHASE");
  });

  it("acknowledges once, requires the second deal, and alternates dealer", () => {
    const cancelled = expectOk(applyAction(drawState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 5♦"), 3,
    ), { type: "DRAW_STOCK", actorId: P1, actionId: aid(), expectedVersion: 4 })).nextState;
    const first = expectOk(applyAction(cancelled, { type: "START_NEXT_HAND", actorId: P1, actionId: aid(), expectedVersion: cancelled.version })).nextState;
    expect(first).toMatchObject({ phase: "HAND_COMPLETE", nextHandAcknowledgements: [P1], version: cancelled.version + 1 });
    expectError(applyAction(first, { type: "START_NEXT_HAND", actorId: P1, actionId: aid(), expectedVersion: first.version }), "NEXT_HAND_ALREADY_ACKNOWLEDGED");
    expectError(applyAction(first, { type: "START_NEXT_HAND", actorId: P2, actionId: aid(), expectedVersion: first.version }), "NEXT_HAND_DEAL_PLAN_REQUIRED");
    const second = expectOk(applyAction(first, { type: "START_NEXT_HAND", actorId: P2, actionId: aid(), expectedVersion: first.version, dealPlan: { deck: standardDeck() } })).nextState;
    expect(second).toMatchObject({ phase: "OPENING_NON_DEALER", handNumber: 2, dealerId: P2, currentPlayerId: P1 });
  });

  it("rejects a premature deal plan on the first acknowledgement", () => {
    const cancelled = expectOk(applyAction(drawState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"), hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 5♦"), 3,
    ), { type: "DRAW_STOCK", actorId: P1, actionId: aid(), expectedVersion: 4 })).nextState;
    expectError(applyAction(cancelled, { type: "START_NEXT_HAND", actorId: P1, actionId: aid(), expectedVersion: cancelled.version, dealPlan: { deck: standardDeck() } }), "UNEXPECTED_DEAL_PLAN");
  });

  it("completes the match immediately on reaching the target", () => {
    const state = discardState(
      hand("3♥ 4♥ 5♥ 7♣ 7♦ 7♠ A♠ 2♠ 3♠ 9♦ K♥"),
      hand("10♣ 10♦ 10♥ 4♠ 5♠ 6♠ 8♣ 2♦ 3♣ 4♦"),
      { p1Score: 95 },
    );
    const result = expectOk(applyAction(state, { type: "KNOCK", actorId: P1, actionId: aid(), expectedVersion: state.version, discardCardId: id("K♥") }));
    expect(result.nextState).toMatchObject({ phase: "GAME_COMPLETE", gameResult: { winnerId: P1, matchTarget: 100 } });
    expect(result.events.at(-1)?.type).toBe("GAME_COMPLETED");
    expectError(applyAction(result.nextState, { type: "START_NEXT_HAND", actorId: P1, actionId: aid(), expectedVersion: result.nextState.version }), "GAME_ALREADY_COMPLETE");
  });

  it("increments once for accepted actions and never mutates inputs", () => {
    const state = startedState();
    const action = { type: "PASS_INITIAL_UPCARD", actorId: P2, actionId: aid(), expectedVersion: state.version } as const;
    const stateSnapshot = structuredClone(state);
    const actionSnapshot = structuredClone(action);
    const result = expectOk(applyAction(state, action));
    expect(result.nextState.version).toBe(state.version + 1);
    expect(result.events.every((event) => event.stateVersion === result.nextState.version)).toBe(true);
    expect(state).toEqual(stateSnapshot);
    expect(action).toEqual(actionSnapshot);
  });
});
