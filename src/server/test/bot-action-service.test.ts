import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState, PlayerId } from "@/src/game";
import { hand } from "@/src/game/test/card-fixtures";
import { drawState } from "@/src/game/test/state-fixtures";

const repository = vi.hoisted(() => ({
  commitGameAction: vi.fn(),
  loadCanonicalGame: vi.fn(),
  loadRecentPublicEvents: vi.fn(),
}));
vi.mock("../game-repository", () => repository);
vi.mock("../realtime", () => ({ notifyGameChanged: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../auth", () => ({
  HttpError: class extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
  },
}));

import { applyPendingBotAction } from "../bot-action-service";

const humanId = "11111111-1111-4111-8111-111111111111" as PlayerId;
const botId = "22222222-2222-4222-8222-222222222222" as PlayerId;
const gameId = "99999999-9999-4999-8999-999999999999";
const snapshots = [
  { playerId: humanId, userId: humanId, kind: "HUMAN" as const, seat: 0 as const, displayName: "Ada" },
  { playerId: botId, userId: null, kind: "BOT" as const, seat: 1 as const, displayName: "Nia" },
];

function botDrawState(): GameState {
  const base = drawState(
    hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"),
    hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♣ 5♦"),
  );
  return {
    ...base,
    gameId,
    dealerId: humanId,
    currentPlayerId: botId,
    drawRestriction: "STOCK_ONLY_AFTER_OPENING_PASSES",
    players: [{ ...base.players[0], id: humanId }, { ...base.players[1], id: botId }],
  };
}

describe("single-player bot action service", () => {
  let persisted: GameState;

  beforeEach(() => {
    persisted = botDrawState();
    repository.loadRecentPublicEvents.mockReset().mockResolvedValue([]);
    repository.loadCanonicalGame.mockReset().mockImplementation(async () => ({
      state: persisted,
      snapshots,
      status: "PLAYING",
      mode: "SINGLE_PLAYER",
      botProfile: "CASUAL_V1",
      rematchRequestedBy: null,
    }));
    repository.commitGameAction.mockReset().mockImplementation(async (input: { expectedVersion: number; nextState: GameState }) => {
      if (input.expectedVersion !== persisted.version) return { outcome: "STALE", version: persisted.version };
      persisted = input.nextState;
      return { outcome: "COMMITTED", version: persisted.version };
    });
  });

  it("advances exactly one legal bot phase through the authoritative commit path", async () => {
    const result = await applyPendingBotAction(gameId, humanId, persisted.version);

    expect(result).toMatchObject({ advanced: true, game: { mode: "SINGLE_PLAYER", phase: "AWAITING_DISCARD", botActionPending: true } });
    expect(repository.commitGameAction).toHaveBeenCalledWith(expect.objectContaining({
      actorId: botId,
      actionType: "DRAW_STOCK",
    }));
  });

  it("returns a safe human projection after Nia draws from stock", async () => {
    const result = await applyPendingBotAction(gameId, humanId, persisted.version);
    const payload = JSON.stringify(result.game);

    for (const card of persisted.players[1]!.hand) expect(payload).not.toContain(card.id);
    for (const card of persisted.stock) expect(payload).not.toContain(card.id);
    expect(result.game.opponent).toMatchObject({ displayName: "Nia", kind: "BOT", cardCount: 11 });
  });

  it("treats stale or premature wakeups as safe no-ops", async () => {
    const stale = await applyPendingBotAction(gameId, humanId, persisted.version - 1);
    expect(stale.advanced).toBe(false);
    expect(repository.commitGameAction).not.toHaveBeenCalled();

    if (persisted.phase !== "AWAITING_DRAW") throw new Error("fixture failed");
    persisted = { ...persisted, currentPlayerId: humanId };
    const premature = await applyPendingBotAction(gameId, humanId, persisted.version);
    expect(premature.advanced).toBe(false);
    expect(repository.commitGameAction).not.toHaveBeenCalled();
  });
});
