import { randomBytes, randomUUID } from "node:crypto";
import { applyAction, createWaitingGame, DEFAULT_GAME_RULES, shuffledDeck } from "@/src/game";
import type { PlayerId } from "@/src/game";
import { acceptRematch, createBotGame, createGame, findInvite, joinAndStartWithInviteToken, loadCanonicalGame, profileName, requestRematch } from "./game-repository";
import { projectGameState } from "./game-projection";
import { HttpError } from "./auth";
import { notifyGameChanged } from "./realtime";
import { createInviteToken, inviteTokenDigest } from "./invites";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function inviteCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
const secureSource = { nextUint32: () => randomBytes(4).readUInt32BE(0) };

export async function createNewGame(userId: string, mode: "MULTIPLAYER" | "SINGLE_PLAYER" = "MULTIPLAYER") {
  const displayName = await profileName(userId);
  if (mode === "SINGLE_PLAYER") return createNewBotGame(userId, displayName);
  // The unique index remains authoritative; retry its vanishingly unlikely collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = inviteCode();
    const token = createInviteToken();
    const digest = inviteTokenDigest(token);
    if (!digest) throw new Error("Could not create invite token.");
    try {
      const gameId = await createGame(code, digest, userId, displayName, DEFAULT_GAME_RULES);
      const loaded = await loadCanonicalGame(gameId);
      return { inviteToken: token, view: projectGameState(loaded.state, userId, loaded.snapshots, loaded.mode, loaded.rematchRequestedBy) };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "INVITE_CODE_COLLISION" || attempt === 2) throw error;
    }
  }
  throw new Error("Could not allocate an invite code.");
}

async function createNewBotGame(userId: string, displayName: string, sourceGameId?: string) {
  const gameId = randomUUID();
  const botPlayerId = randomUUID() as PlayerId;
  const waiting = createWaitingGame(gameId, userId as PlayerId, DEFAULT_GAME_RULES);
  const started = applyAction(waiting, {
    type: "START_GAME",
    actionId: randomUUID() as never,
    expectedVersion: 0,
    actorId: "SYSTEM",
    opponentId: botPlayerId,
    dealPlan: {
      deck: shuffledDeck(secureSource),
      dealerId: randomBytes(1)[0]! % 2 === 0 ? userId as PlayerId : botPlayerId,
    },
  });
  if (!started.ok) throw new Error("Could not create initial bot deal.");
  const persistedId = await createBotGame({
    gameId,
    botPlayerId,
    creatorId: userId,
    displayName,
    nextState: started.nextState,
    events: started.events,
    ...(sourceGameId ? { sourceGameId } : {}),
  });
  const loaded = await loadCanonicalGame(persistedId);
  return { view: projectGameState(loaded.state, userId, loaded.snapshots, loaded.mode, loaded.rematchRequestedBy) };
}

export type InviteResolution =
  | { state: "OPEN" }
  | { state: "ALREADY_A_PLAYER"; gameId: string }
  | { state: "FULL" }
  | { state: "UNAVAILABLE" };

export async function resolveInvite(userId: string, rawToken: string): Promise<InviteResolution> {
  const digest = inviteTokenDigest(rawToken);
  if (!digest) return { state: "UNAVAILABLE" };
  const invite = await findInvite(digest);
  if (!invite) return { state: "UNAVAILABLE" };
  const loaded = await loadCanonicalGame(invite.id);
  if (loaded.snapshots.some((player) => player.userId === userId)) return { state: "ALREADY_A_PLAYER", gameId: invite.id };
  return invite.status === "WAITING" && loaded.state.phase === "WAITING_FOR_PLAYER" ? { state: "OPEN" } : { state: "FULL" };
}

export async function joinGameByInviteToken(userId: string, rawToken: string) {
  const digest = inviteTokenDigest(rawToken);
  if (!digest) throw new HttpError(404, "INVITE_UNAVAILABLE");
  const displayName = await profileName(userId);
  const invite = await findInvite(digest);
  if (!invite) throw new HttpError(404, "INVITE_UNAVAILABLE");
  const loaded = await loadCanonicalGame(invite.id);
  if (loaded.snapshots.some((player) => player.userId === userId)) return { outcome: "ALREADY_A_PLAYER" as const, gameId: invite.id };
  if (loaded.state.phase !== "WAITING_FOR_PLAYER") return { outcome: "FULL" as const };
  const started = applyAction(loaded.state, {
    type: "START_GAME", actionId: randomUUID() as never, expectedVersion: loaded.state.version, actorId: "SYSTEM",
    opponentId: userId as PlayerId, dealPlan: { deck: shuffledDeck(secureSource), dealerId: randomBytes(1)[0]! % 2 === 0 ? loaded.state.players[0].id : userId as PlayerId },
  });
  if (!started.ok) throw new Error("Could not create initial deal.");
  const committed = await joinAndStartWithInviteToken(digest, userId, displayName, started.nextState, started.events);
  if (committed.outcome === "ALREADY_A_PLAYER") return { outcome: committed.outcome, gameId: committed.game_id! };
  if (committed.outcome === "FULL") return { outcome: committed.outcome };
  const fresh = await loadCanonicalGame(committed.game_id!);
  void notifyGameChanged(committed.game_id!, committed.version!);
  return { outcome: "JOINED" as const, game: projectGameState(fresh.state, userId, fresh.snapshots, fresh.mode, fresh.rematchRequestedBy) };
}

export async function rematchGame(gameId: string, userId: string, response: "REQUEST" | "ACCEPT" | "PLAY_AGAIN") {
  const loaded = await loadCanonicalGame(gameId);
  if (loaded.state.phase !== "GAME_COMPLETE" || !loaded.snapshots.some((player) => player.userId === userId)) throw new HttpError(400, "REMATCH_UNAVAILABLE");

  if (loaded.mode === "SINGLE_PLAYER") {
    if (response !== "PLAY_AGAIN") throw new HttpError(400, "REMATCH_UNAVAILABLE");
    const displayName = loaded.snapshots.find((player) => player.userId === userId)!.displayName;
    const created = await createNewBotGame(userId, displayName, gameId);
    return { game: created.view, rematchGameId: created.view.gameId };
  }
  if (response === "PLAY_AGAIN") throw new HttpError(400, "REMATCH_UNAVAILABLE");

  if (response === "REQUEST") {
    await requestRematch(gameId, userId);
    const fresh = await loadCanonicalGame(gameId);
    void notifyGameChanged(gameId, fresh.state.version);
    return { game: projectGameState(fresh.state, userId, fresh.snapshots, fresh.mode, fresh.rematchRequestedBy) };
  }

  if (!loaded.rematchRequestedBy || loaded.rematchRequestedBy === userId) throw new HttpError(400, "REMATCH_UNAVAILABLE");
  const newGameId = randomUUID();
  const players = [...loaded.snapshots].sort((a, b) => a.seat - b.seat);
  const waiting = createWaitingGame(newGameId, players[0]!.playerId as PlayerId, loaded.state.rules);
  const started = applyAction(waiting, {
    type: "START_GAME", actionId: randomUUID() as never, expectedVersion: 0, actorId: "SYSTEM",
    opponentId: players[1]!.playerId as PlayerId,
    dealPlan: { deck: shuffledDeck(secureSource), dealerId: randomBytes(1)[0]! % 2 === 0 ? players[0]!.playerId as PlayerId : players[1]!.playerId as PlayerId },
  });
  if (!started.ok) throw new Error("Could not create rematch deal.");
  const committed = await acceptRematch({ gameId, userId, newGameId, inviteCode: inviteCode(), nextState: started.nextState, events: started.events });
  const fresh = await loadCanonicalGame(committed.game_id);
  void notifyGameChanged(gameId, loaded.state.version);
  void notifyGameChanged(committed.game_id, committed.version);
  return { game: projectGameState(fresh.state, userId, fresh.snapshots, fresh.mode, fresh.rematchRequestedBy), rematchGameId: committed.game_id };
}
