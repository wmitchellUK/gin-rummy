import { describe, expect, it } from "vitest";
import { applyAction, createWaitingGame, standardDeck } from "@/src/game";
import type { GameState, PlayerId } from "@/src/game";
import { parseActionRequest } from "../game-input";
import { projectGameState } from "../game-projection";

const p1 = "11111111-1111-4111-8111-111111111111" as PlayerId;
const p2 = "22222222-2222-4222-8222-222222222222" as PlayerId;
const actionId = "33333333-3333-4333-8333-333333333333" as never;

function started(): GameState {
  const result = applyAction(createWaitingGame("game-id", p1), {
    type: "START_GAME", actorId: "SYSTEM", actionId, expectedVersion: 0, opponentId: p2,
    dealPlan: { deck: standardDeck(), dealerId: p1 },
  });
  if (!result.ok) throw new Error("fixture failed");
  return result.nextState;
}

describe("browser game projection", () => {
  it("includes the viewer hand but never the opponent hand or stock cards", () => {
    const state = started();
    const view = projectGameState(state, p1, [
      { userId: p1, seat: 0, displayName: "Ada" }, { userId: p2, seat: 1, displayName: "Bea" },
    ]);
    const payload = JSON.stringify(view);
    expect(view.you.hand).toEqual(state.players[0]!.hand);
    expect(view.opponent?.cardCount).toBe(10);
    for (const card of state.players[1]!.hand) expect(payload).not.toContain(card.id);
    for (const card of state.stock) expect(payload).not.toContain(card.id);
    expect(payload).not.toContain("canonical_state");
    expect(payload).not.toContain("PRIVATE_STOCK_CARD_RECEIVED");
  });

  it("does not reveal current hands in a cancelled hand result", () => {
    const state = started();
    const cancelled = {
      ...state, phase: "HAND_COMPLETE" as const,
      handResult: { kind: "CANCELLED" as const, handNumber: 1, dealerId: p1, reason: "STOCK_REDUCED_TO_TWO" as const, pointsAwarded: 0 as const, scoresAfter: { [p1]: 0, [p2]: 0 } },
      nextHandAcknowledgements: [] as PlayerId[],
    } as GameState;
    const view = projectGameState(cancelled, p1, [
      { userId: p1, seat: 0, displayName: "Ada" }, { userId: p2, seat: 1, displayName: "Bea" },
    ]);
    expect(JSON.stringify(view.handResult)).not.toContain("revealedHand");
  });
});

describe("action input boundary", () => {
  it("rejects forged canonical fields and accepts only an allowed intent", () => {
    expect(parseActionRequest({ expectedVersion: 1, action: { actionId, type: "DRAW_STOCK", actorId: p1 } })).toBeNull();
    expect(parseActionRequest({ expectedVersion: 1, state: started(), action: { actionId, type: "DRAW_STOCK" } })).toBeNull();
    expect(parseActionRequest({ expectedVersion: 1, action: { actionId, type: "DRAW_STOCK" } })).toEqual({ expectedVersion: 1, action: { actionId, type: "DRAW_STOCK" } });
  });

  it("identifies wrong-player, valid, and stale intentions without client-supplied state", () => {
    const state = started();
    const wrong = applyAction(state, { type: "PASS_INITIAL_UPCARD", actionId, expectedVersion: 1, actorId: p1 });
    expect(wrong).toMatchObject({ ok: false, error: { code: "WRONG_PLAYER" } });
    const valid = applyAction(state, { type: "PASS_INITIAL_UPCARD", actionId, expectedVersion: 1, actorId: p2 });
    expect(valid).toMatchObject({ ok: true, nextState: { version: 2 } });
    const stale = applyAction(state, { type: "PASS_INITIAL_UPCARD", actionId, expectedVersion: 0, actorId: p2 });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_VERSION", currentVersion: 1 } });
  });

  it("returns the same safe projection after a refresh/refetch", () => {
    const state = started();
    const players = [{ userId: p1, seat: 0 as const, displayName: "Ada" }, { userId: p2, seat: 1 as const, displayName: "Bea" }];
    expect(projectGameState(state, p1, players)).toEqual(projectGameState(state, p1, players));
  });
});
