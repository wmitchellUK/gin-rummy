import { randomBytes, randomUUID } from "node:crypto";
import { chooseBotIntent, type BotObservation } from "@/src/bot";
import { applyAction, isCanonicalCard, shuffledDeck, type GameAction, type GameState, type PlayerId } from "@/src/game";
import { HttpError } from "./auth";
import { projectGameState } from "./game-projection";
import { commitGameAction, loadCanonicalGame, loadRecentPublicEvents } from "./game-repository";
import { notifyGameChanged } from "./realtime";

const secureSource = { nextUint32: () => randomBytes(4).readUInt32BE(0) };
const botRandom = { nextFloat: () => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000 };

function observationFor(state: GameState, botPlayerId: PlayerId, events: readonly Record<string, unknown>[]): BotObservation | null {
  const bot = state.players.find((player) => player.id === botPlayerId);
  if (!bot || state.phase === "WAITING_FOR_PLAYER" || state.phase === "GAME_COMPLETE") return null;
  if (state.phase !== "HAND_COMPLETE" && state.currentPlayerId !== botPlayerId) return null;
  if (state.phase === "HAND_COMPLETE" && state.nextHandAcknowledgements.includes(botPlayerId)) return null;

  const currentHandEvents: readonly Record<string, unknown>[] = (() => {
    const boundary = events.findIndex((event) => event.type === "HAND_STARTED");
    return boundary === -1 ? events : events.slice(0, boundary + 1);
  })();
  const eventCards = currentHandEvents.flatMap((event) => isCanonicalCard(event.card) ? [event.card] : []);
  const recentOpponentTakes = currentHandEvents.flatMap((event) => {
    return event.type === "DISCARD_DRAWN" && event.playerId !== botPlayerId && isCanonicalCard(event.card) ? [event.card] : [];
  }).slice(0, 4);
  const topDiscard = state.discardPile[0];
  return {
    botPlayerId,
    phase: state.phase,
    hand: bot.hand,
    rules: state.rules,
    stockCount: state.stock.length,
    ...(topDiscard ? { topDiscard } : {}),
    ...(state.phase === "AWAITING_DRAW" ? { drawRestriction: state.drawRestriction } : {}),
    ...(state.phase === "AWAITING_DISCARD" ? { forbiddenDiscardId: state.forbiddenDiscardId } : {}),
    publicKnownCards: [...state.discardPile, ...eventCards],
    recentOpponentTakes,
  };
}

function trustedBotAction(state: GameState, botPlayerId: PlayerId, observation: BotObservation): GameAction {
  const intent = chooseBotIntent(observation, botRandom);
  const base = { actionId: randomUUID() as GameAction["actionId"], expectedVersion: state.version, actorId: botPlayerId };
  switch (intent.type) {
    case "PASS_INITIAL_UPCARD": return { ...base, type: intent.type };
    case "TAKE_INITIAL_UPCARD": return { ...base, type: intent.type };
    case "DRAW_STOCK": return { ...base, type: intent.type };
    case "DRAW_DISCARD": return { ...base, type: intent.type };
    case "DISCARD": return { ...base, type: intent.type, cardId: intent.cardId as never };
    case "KNOCK": return { ...base, type: intent.type, discardCardId: intent.cardId as never };
    case "GIN": return { ...base, type: intent.type, discardCardId: intent.cardId as never };
    case "START_NEXT_HAND": {
      const requiresPlan = state.phase === "HAND_COMPLETE" && state.nextHandAcknowledgements.length === 1;
      return { ...base, type: intent.type, ...(requiresPlan ? { dealPlan: { deck: shuffledDeck(secureSource) } } : {}) };
    }
  }
}

export async function applyPendingBotAction(gameId: string, userId: string, expectedVersion: number) {
  const loaded = await loadCanonicalGame(gameId);
  const human = loaded.snapshots.find((player) => player.userId === userId && player.kind === "HUMAN");
  const bot = loaded.snapshots.find((player) => player.kind === "BOT");
  if (!human || !bot) throw new HttpError(404, "GAME_NOT_FOUND");
  if (loaded.mode !== "SINGLE_PLAYER" || loaded.botProfile !== "CASUAL_V1") throw new HttpError(400, "BOT_ACTION_UNAVAILABLE");

  if (loaded.state.version !== expectedVersion) {
    return { advanced: false, game: projectGameState(loaded.state, userId, loaded.snapshots, loaded.mode, loaded.rematchRequestedBy) };
  }
  const events = await loadRecentPublicEvents(gameId);
  const observation = observationFor(loaded.state, bot.playerId as PlayerId, events);
  if (!observation) {
    return { advanced: false, game: projectGameState(loaded.state, userId, loaded.snapshots, loaded.mode, loaded.rematchRequestedBy) };
  }
  const action = trustedBotAction(loaded.state, bot.playerId as PlayerId, observation);
  const result = applyAction(loaded.state, action);
  if (!result.ok) throw new Error(`Bot selected an illegal action: ${result.error.code}`);
  const cardId = action.type === "DISCARD" ? action.cardId : action.type === "KNOCK" || action.type === "GIN" ? action.discardCardId : undefined;
  const committed = await commitGameAction({
    actionId: action.actionId,
    gameId,
    actorId: bot.playerId,
    expectedVersion: loaded.state.version,
    actionType: action.type,
    nextState: result.nextState,
    events: result.events,
    ...(cardId ? { cardId } : {}),
    ...(result.nextState.phase === "GAME_COMPLETE" ? { result: result.nextState.gameResult } : {}),
  });
  const fresh = await loadCanonicalGame(gameId);
  if (committed.outcome === "COMMITTED") void notifyGameChanged(gameId, committed.version);
  return {
    advanced: committed.outcome === "COMMITTED",
    game: projectGameState(fresh.state, userId, fresh.snapshots, fresh.mode, fresh.rematchRequestedBy),
  };
}
