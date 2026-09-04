import { describe, expect, it } from "vitest";
import { applyAction, createWaitingGame, DEFAULT_GAME_RULES, standardDeck } from "@/src/game";
import type { GameState, PlayerId } from "@/src/game";
import { gameplayControlsAreAvailable, selectedDiscardActionAvailability } from "@/src/shared/game-view";
import { hand, P1, P2 } from "@/src/game/test/card-fixtures";
import { discardState, drawState } from "@/src/game/test/state-fixtures";
import { parseActionRequest } from "../game-input";
import { projectGameState } from "../game-projection";
import { scoreDeclaration } from "@/src/game/scoring";

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

  it("projects the scored chained-layoff result equally and safely to both participants", () => {
    const knockerHand = hand("2♦ 3♥ 4♥ 5♥ 9♦ 9♥ 9♠ K♣ K♥ K♠");
    const opponentHand = hand("A♥ A♠ 2♥ 3♣ 7♣ 7♥ 7♠ J♣ J♦ J♥");
    const scored = scoreDeclaration({
      handNumber: 1, dealerId: P2, declaration: "KNOCK", declarerId: P1,
      finalDiscard: hand("Q♦")[0]!, rules: DEFAULT_GAME_RULES,
      players: [{ id: P1, hand: knockerHand, matchScore: 0 }, { id: P2, hand: opponentHand, matchScore: 46 }],
    });
    const base = drawState(knockerHand, opponentHand);
    const completed = {
      ...base, phase: "HAND_COMPLETE" as const, players: scored.players, handHistory: [scored.result],
      handResult: scored.result, nextHandAcknowledgements: [] as PlayerId[],
    } as GameState;
    const players = [{ userId: P1, seat: 0 as const, displayName: "Ada" }, { userId: P2, seat: 1 as const, displayName: "Bea" }];
    const ada = projectGameState(completed, P1, players);
    const bea = projectGameState(completed, P2, players);

    expect(ada.status).toBe("HAND_COMPLETE");
    expect(ada.legalControls).toEqual(["START_NEXT_HAND"]);
    expect(bea.legalControls).toEqual(["START_NEXT_HAND"]);
    expect(gameplayControlsAreAvailable(ada)).toBe(false);
    expect(gameplayControlsAreAvailable(bea)).toBe(false);
    expect(ada.handResult).toEqual(bea.handResult);
    if (!ada.handResult || ada.handResult.kind !== "SCORED") throw new Error("Scored result was not projected");

    expect(ada.handResult).toMatchObject({
      declarerId: P1, declarerName: "Ada", winnerId: P1, winnerName: "Ada", declaration: "KNOCK",
      pointsAwarded: 2, scoresAfter: [{ playerId: P1, score: 2 }, { playerId: P2, score: 46 }],
    });
    expect(ada.handResult.players.map((player) => player.revealedHand.map((card) => card.id).sort())).toEqual([
      knockerHand.map((card) => card.id).sort(), opponentHand.map((card) => card.id).sort(),
    ]);
    const opponent = ada.handResult.players.find((player) => player.playerId === P2)!;
    expect(opponent).toMatchObject({ originalDeadwoodValue: 7, finalDeadwoodValue: 4 });
    expect(opponent.layoffs.map((layoff) => layoff.card.id).sort()).toEqual(["2:HEARTS", "A:HEARTS"]);
    expect(opponent.finalDeadwoodCards.map((card) => card.id).sort()).toEqual(["3:CLUBS", "A:SPADES"]);

    const publicResult = JSON.stringify(ada.handResult);
    for (const card of completed.stock) expect(publicResult).not.toContain(card.id);
    expect(publicResult).not.toContain("discardPile");
    expect(publicResult).not.toContain("stock");

    const acknowledged = { ...completed, nextHandAcknowledgements: [P1] } as GameState;
    expect(projectGameState(acknowledged, P1, players).nextHandReadiness).toEqual({ you: true, opponent: false });
    expect(projectGameState(acknowledged, P2, players).nextHandReadiness).toEqual({ you: false, opponent: true });

    const complete = {
      ...completed,
      phase: "GAME_COMPLETE" as const,
      gameResult: {
        winnerId: scored.result.winnerId,
        loserId: P2,
        finalScores: scored.result.scoresAfter,
        matchTarget: DEFAULT_GAME_RULES.matchTarget,
        completedHands: [scored.result],
      },
    } as GameState;
    expect(projectGameState(complete, P1, players).gameResult).toMatchObject({
      winnerName: "Ada",
      finalScores: [{ displayName: "Ada", score: 2 }, { displayName: "Bea", score: 46 }],
      completedHands: [{ kind: "SCORED", winnerName: "Ada", pointsAwarded: 2 }],
    });
  });

  it("projects a discard-pile draw restriction only to the active player", () => {
    const base = drawState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♣ 5♦"),
    );
    const kDiamond = [...base.stock, ...base.discardPile].find((card) => card.id === "K:DIAMONDS")!;
    const remaining = [...base.stock, ...base.discardPile].filter((card) => card.id !== kDiamond.id);
    const state = { ...base, stock: remaining.slice(0, 20), discardPile: [kDiamond, ...remaining.slice(20)] };
    const drawn = applyAction(state, { type: "DRAW_DISCARD", actorId: P1, actionId, expectedVersion: state.version });
    if (!drawn.ok || drawn.nextState.phase !== "AWAITING_DISCARD") throw new Error("fixture failed");
    const players = [{ userId: P1, seat: 0 as const, displayName: "Ada" }, { userId: P2, seat: 1 as const, displayName: "Bea" }];

    const view = projectGameState(drawn.nextState, P1, players);
    expect(view.turnRestrictions).toEqual({ cannotDiscardCardId: "K:DIAMONDS" });
    expect(view.discardOutcomes?.some((outcome) => outcome.cardId === "K:DIAMONDS")).toBe(false);
    expect(projectGameState(drawn.nextState, P2, players).turnRestrictions).toBeUndefined();
    expect(projectGameState(drawn.nextState, P2, players).discardOutcomes).toBeUndefined();
    // A re-fetch projects from canonical state again, rather than local draw memory.
    expect(projectGameState(drawn.nextState, P1, players).turnRestrictions).toEqual(view.turnRestrictions);
  });

  it("projects card-specific discard, knock, and gin outcomes only to the active player", () => {
    const state = discardState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 10♦ J♦ Q♦ K♦ 9♠"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♣ 5♦"),
    );
    const players = [{ userId: P1, seat: 0 as const, displayName: "Ada" }, { userId: P2, seat: 1 as const, displayName: "Bea" }];

    const active = projectGameState(state, P1, players);
    expect(active.discardOutcomes).toHaveLength(11);
    expect(active.discardOutcomes).toEqual(expect.arrayContaining([
      { cardId: "9:SPADES", deadwoodValue: 0, declaration: "GIN" },
      { cardId: "K:DIAMONDS", deadwoodValue: 9, declaration: "KNOCK" },
      { cardId: "A:HEARTS", deadwoodValue: 14, declaration: null },
    ]));
    expect(active.you.meldCandidates?.some((meld) => meld.kind === "RUN" && meld.cards.map((card) => card.id).join("|") === "A:HEARTS|2:HEARTS|3:HEARTS")).toBe(true);
    expect(JSON.stringify(active.you.meldCandidates)).not.toContain("Q:SPADES");
    expect(projectGameState(state, P2, players).discardOutcomes).toBeUndefined();
  });

  it("projects a stock-drawn card only for its owner's discard decision", () => {
    const state = drawState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♣ 5♦"),
    );
    const drawn = applyAction(state, { type: "DRAW_STOCK", actorId: P1, actionId, expectedVersion: state.version });
    if (!drawn.ok || drawn.nextState.phase !== "AWAITING_DISCARD") throw new Error("fixture failed");
    const drawnState = drawn.nextState;
    if (!drawnState.drawnCardId) throw new Error("fixture failed");
    const players = [{ userId: P1, seat: 0 as const, displayName: "Ada" }, { userId: P2, seat: 1 as const, displayName: "Bea" }];

    expect(projectGameState(drawnState, P1, players).drawnStockCardId).toBe(drawnState.drawnCardId);
    expect(projectGameState(drawnState, P2, players).drawnStockCardId).toBeUndefined();

    const discardedCard = drawnState.players[0].hand.find((card) => card.id !== drawnState.drawnCardId)!;
    const discarded = applyAction(drawnState, { type: "DISCARD", actorId: P1, actionId, expectedVersion: drawnState.version, cardId: discardedCard.id });
    if (!discarded.ok) throw new Error("fixture failed");
    expect(projectGameState(discarded.nextState, P1, players).drawnStockCardId).toBeUndefined();
  });

  it("disables every selected-discard action for the prohibited card only", () => {
    const game = {
      legalControls: ["DISCARD", "KNOCK", "GIN"] as const,
      turnRestrictions: { cannotDiscardCardId: "K:DIAMONDS" },
      discardOutcomes: [
        { cardId: "6:CLUBS", deadwoodValue: 7, declaration: "KNOCK" as const },
        { cardId: "7:CLUBS", deadwoodValue: 0, declaration: "GIN" as const },
        { cardId: "8:CLUBS", deadwoodValue: 18, declaration: null },
      ],
    };

    expect(selectedDiscardActionAvailability(game, "K:DIAMONDS")).toEqual({
      isProhibitedDiscard: true, canDiscard: false, canKnock: false, canGin: false, deadwoodValue: undefined,
    });
    expect(selectedDiscardActionAvailability(game, "6:CLUBS")).toEqual({
      isProhibitedDiscard: false, canDiscard: true, canKnock: true, canGin: false, deadwoodValue: 7,
    });
    expect(selectedDiscardActionAvailability(game, "7:CLUBS")).toEqual({
      isProhibitedDiscard: false, canDiscard: true, canKnock: false, canGin: true, deadwoodValue: 0,
    });
    expect(selectedDiscardActionAvailability(game, "8:CLUBS")).toEqual({
      isProhibitedDiscard: false, canDiscard: true, canKnock: false, canGin: false, deadwoodValue: 18,
    });
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
