import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction, createWaitingGame, standardDeck } from "@/src/game";
import type { GameState, PlayerId } from "@/src/game";
import { hand } from "@/src/game/test/card-fixtures";
import { drawState } from "@/src/game/test/state-fixtures";
import { parseActionRequest, type ParsedActionRequest } from "../game-input";

const repository = vi.hoisted(() => ({
  commitGameAction: vi.fn(),
  findActionReceipt: vi.fn(),
  loadCanonicalGame: vi.fn(),
}));

vi.mock("../game-repository", () => repository);
vi.mock("../realtime", () => ({ notifyGameChanged: vi.fn().mockResolvedValue(undefined) }));
// The action service needs only HttpError here; avoid loading the Supabase client.
vi.mock("../auth", () => ({ HttpError: class extends Error {} }));

import { applyPlayerAction } from "../game-action-service";

const p1 = "11111111-1111-4111-8111-111111111111" as PlayerId;
const p2 = "22222222-2222-4222-8222-222222222222" as PlayerId;
const gameId = "99999999-9999-4999-8999-999999999999";
const snapshots = [
  { userId: p1, seat: 0 as const, displayName: "Ada" },
  { userId: p2, seat: 1 as const, displayName: "Bea" },
];

function action(actionId: string, expectedVersion = 1): ParsedActionRequest {
  return { expectedVersion, action: { actionId, type: "PASS_INITIAL_UPCARD" } };
}

function openingState(): GameState {
  const result = applyAction(createWaitingGame(gameId, p1), {
    type: "START_GAME",
    actorId: "SYSTEM",
    actionId: "33333333-3333-4333-8333-333333333333" as never,
    expectedVersion: 0,
    opponentId: p2,
    dealPlan: { deck: standardDeck(), dealerId: p1 },
  });
  if (!result.ok) throw new Error("fixture failed");
  return result.nextState;
}

describe("authoritative game action service", () => {
  let persisted: GameState;

  beforeEach(() => {
    persisted = openingState();
    repository.findActionReceipt.mockReset().mockResolvedValue(null);
    repository.loadCanonicalGame.mockReset().mockImplementation(async () => ({ state: persisted, snapshots, status: "PLAYING" }));
    repository.commitGameAction.mockReset().mockImplementation(async (input: { expectedVersion: number; nextState: GameState }) => {
      if (persisted.version !== input.expectedVersion) return { outcome: "STALE", version: persisted.version };
      persisted = input.nextState;
      return { outcome: "COMMITTED", version: persisted.version };
    });
  });

  it("rejects an action from the member whose turn it is not", async () => {
    const result = await applyPlayerAction(gameId, p1, action("44444444-4444-4444-8444-444444444444"));

    expect(result).toMatchObject({ stale: false, errorCode: "WRONG_PLAYER" });
    expect(repository.commitGameAction).not.toHaveBeenCalled();
  });

  it("commits a valid intent and returns only the actor projection", async () => {
    const result = await applyPlayerAction(gameId, p2, action("55555555-5555-4555-8555-555555555555"));

    expect(result).toMatchObject({ stale: false, view: { version: 2, phase: "OPENING_DEALER" } });
    expect(repository.commitGameAction).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(result.view);
    for (const card of persisted.players[0]!.hand) expect(payload).not.toContain(card.id);
    for (const card of persisted.stock) expect(payload).not.toContain(card.id);
  });

  it("returns the current projection on a stale version without persisting", async () => {
    const result = await applyPlayerAction(gameId, p2, action("66666666-6666-4666-8666-666666666666", 0));

    expect(result).toMatchObject({ stale: true, errorCode: "STALE_VERSION", view: { version: 1 } });
    expect(repository.commitGameAction).not.toHaveBeenCalled();
  });

  it("allows exactly one concurrent same-version action to commit", async () => {
    const [first, second] = await Promise.all([
      applyPlayerAction(gameId, p2, action("77777777-7777-4777-8777-777777777777")),
      applyPlayerAction(gameId, p2, action("88888888-8888-4888-8888-888888888888")),
    ]);

    expect([first, second].filter((result) => !result.stale)).toHaveLength(1);
    expect([first, second].filter((result) => result.stale)).toHaveLength(1);
    expect(persisted.version).toBe(2);
    expect(repository.commitGameAction).toHaveBeenCalledTimes(2);
  });

  it("refetches a safe projection for a completed idempotent retry", async () => {
    const acceptedVersion = 2;
    const next = applyAction(persisted, {
      type: "PASS_INITIAL_UPCARD",
      actorId: p2,
      actionId: "99999999-9999-4999-8999-999999999999" as never,
      expectedVersion: 1,
    });
    if (!next.ok) throw new Error("fixture failed");
    persisted = next.nextState;
    repository.findActionReceipt.mockResolvedValue({ game_id: gameId, actor_id: p2, accepted_version: acceptedVersion });

    const result = await applyPlayerAction(gameId, p2, action("99999999-9999-4999-8999-999999999999"));

    expect(result).toMatchObject({ stale: false, view: { version: acceptedVersion } });
    expect(repository.commitGameAction).not.toHaveBeenCalled();
  });

  it("still rejects a direct API action attempting to rediscard a discard-pile draw", async () => {
    const base = drawState(
      hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"),
      hand("A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♣ 5♦"),
    );
    const kDiamond = [...base.stock, ...base.discardPile].find((card) => card.id === "K:DIAMONDS")!;
    const remaining = [...base.stock, ...base.discardPile].filter((card) => card.id !== kDiamond.id);
    persisted = {
      ...base,
      players: [{ ...base.players[0]!, id: p1 }, { ...base.players[1]!, id: p2 }],
      currentPlayerId: p1,
      dealerId: p1,
      stock: remaining.slice(0, 20),
      discardPile: [kDiamond, ...remaining.slice(20)],
    };

    const draw = await applyPlayerAction(gameId, p1, {
      expectedVersion: persisted.version,
      action: { actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "DRAW_DISCARD" },
    });
    expect(draw.view.turnRestrictions).toEqual({ cannotDiscardCardId: "K:DIAMONDS" });
    expect(persisted.phase).toBe("AWAITING_DISCARD");

    const maliciousRequest = parseActionRequest({
      expectedVersion: persisted.version,
      action: { actionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", type: "DISCARD", cardId: kDiamond.id },
    });
    if (!maliciousRequest) throw new Error("fixture failed");
    const rejected = await applyPlayerAction(gameId, p1, maliciousRequest);

    expect(rejected).toMatchObject({ stale: false, errorCode: "ILLEGAL_REDISCARD" });
    expect(repository.commitGameAction).toHaveBeenCalledTimes(1);
    expect(persisted.version).toBe(draw.view.version);
  });
});
