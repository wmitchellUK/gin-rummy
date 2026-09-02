import { randomBytes } from "node:crypto";
import { applyAction, shuffledDeck, validateGameState } from "@/src/game";
import type { GameAction, GameState, PlayerId } from "@/src/game";
import { projectGameState } from "./game-projection";
import { commitGameAction, findActionReceipt, loadCanonicalGame } from "./game-repository";
import type { ParsedActionRequest } from "./game-input";
import { HttpError } from "./auth";
import { notifyGameChanged } from "./realtime";

const secureSource = { nextUint32: () => randomBytes(4).readUInt32BE(0) };
const asPlayerId = (value: string) => value as PlayerId;

function trustedAction(state: GameState, actorId: string, input: ParsedActionRequest): GameAction {
  const base = { actionId: input.action.actionId as GameAction["actionId"], expectedVersion: input.expectedVersion, actorId: asPlayerId(actorId) };
  switch (input.action.type) {
    case "PASS_INITIAL_UPCARD": return { ...base, type: "PASS_INITIAL_UPCARD" };
    case "TAKE_INITIAL_UPCARD": return { ...base, type: "TAKE_INITIAL_UPCARD" };
    case "DRAW_STOCK": return { ...base, type: "DRAW_STOCK" };
    case "DRAW_DISCARD": return { ...base, type: "DRAW_DISCARD" };
    case "DISCARD": return { ...base, type: "DISCARD", cardId: input.action.cardId as never };
    case "KNOCK": return { ...base, type: "KNOCK", discardCardId: input.action.cardId as never };
    case "GIN": return { ...base, type: "GIN", discardCardId: input.action.cardId as never };
    case "START_NEXT_HAND": {
      const requiresPlan = state.phase === "HAND_COMPLETE" && state.nextHandAcknowledgements.length === 1 && !state.nextHandAcknowledgements.includes(asPlayerId(actorId));
      return { ...base, type: "START_NEXT_HAND", ...(requiresPlan ? { dealPlan: { deck: shuffledDeck(secureSource) } } : {}) };
    }
  }
}

export type ActionServiceResult = { readonly view: ReturnType<typeof projectGameState>; readonly stale: boolean; readonly errorCode?: string };

export async function applyPlayerAction(gameId: string, actorId: string, input: ParsedActionRequest): Promise<ActionServiceResult> {
  const receipt = await findActionReceipt(input.action.actionId);
  if (receipt && (receipt.game_id !== gameId || receipt.actor_id !== actorId
    || receipt.expected_version !== input.expectedVersion || receipt.action_type !== input.action.type
    || (receipt.card_id !== null && receipt.card_id !== (input.action.cardId ?? null)))) throw new HttpError(409, "ACTION_ID_CONFLICT");
  const loaded = await loadCanonicalGame(gameId);
  if (!loaded.snapshots.some((item) => item.userId === actorId)) throw new HttpError(404, "GAME_NOT_FOUND");
  if (receipt) return { view: projectGameState(loaded.state, actorId, loaded.snapshots), stale: false };
  const invariant = validateGameState(loaded.state);
  if (!invariant.ok) throw new Error("Stored game state failed engine validation.");
  const result = applyAction(loaded.state, trustedAction(loaded.state, actorId, input));
  if (!result.ok) {
    const stale = result.error.code === "STALE_VERSION";
    return { view: projectGameState(loaded.state, actorId, loaded.snapshots), stale, errorCode: result.error.code };
  }
  const committed = await commitGameAction({
    actionId: input.action.actionId, gameId, actorId, expectedVersion: input.expectedVersion,
    actionType: input.action.type, nextState: result.nextState, events: result.events,
    ...(input.action.cardId ? { cardId: input.action.cardId } : {}),
    ...(result.nextState.phase === "GAME_COMPLETE" ? { result: result.nextState.gameResult } : {}),
  });
  const fresh = await loadCanonicalGame(gameId);
  const view = projectGameState(fresh.state, actorId, fresh.snapshots, fresh.rematchRequestedBy);
  if (committed.outcome === "COMMITTED") void notifyGameChanged(gameId, committed.version);
  return { view, stale: committed.outcome === "STALE" };
}
