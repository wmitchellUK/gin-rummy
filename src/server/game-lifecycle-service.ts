import { randomBytes, randomUUID } from "node:crypto";
import { applyAction, DEFAULT_GAME_RULES, shuffledDeck } from "@/src/game";
import type { PlayerId } from "@/src/game";
import { createGame, joinAndStartGame, loadCanonicalGame, profileName } from "./game-repository";
import { projectGameState } from "./game-projection";
import { HttpError } from "./auth";
import { notifyGameChanged } from "./realtime";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function inviteCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
const secureSource = { nextUint32: () => randomBytes(4).readUInt32BE(0) };

export async function createNewGame(userId: string) {
  const displayName = await profileName(userId);
  // The unique index remains authoritative; retry its vanishingly unlikely collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = inviteCode();
    try {
      const gameId = await createGame(code, userId, displayName, DEFAULT_GAME_RULES);
      const loaded = await loadCanonicalGame(gameId);
      return { inviteCode: code, view: projectGameState(loaded.state, userId, loaded.snapshots) };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "INVITE_CODE_COLLISION" || attempt === 2) throw error;
    }
  }
  throw new Error("Could not allocate an invite code.");
}

export async function joinGameByInvite(userId: string, rawCode: string) {
  const invite = rawCode.trim().toUpperCase();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(invite)) throw new HttpError(404, "INVITE_UNAVAILABLE");
  const displayName = await profileName(userId);
  // This read only gives trusted server code enough state to create a secure deal;
  // browser callers never receive it and the RPC below rechecks the waiting row under lock.
  const admin = (await import("./supabase-admin")).createAdminClient();
  const { data: game, error } = await admin.from("games").select("id").eq("invite_code", invite).maybeSingle();
  if (error || !game) throw new HttpError(404, "INVITE_UNAVAILABLE");
  const loaded = await loadCanonicalGame(game.id as string);
  if (loaded.state.phase !== "WAITING_FOR_PLAYER" || loaded.state.players[0]?.id === userId) throw new HttpError(404, "INVITE_UNAVAILABLE");
  const started = applyAction(loaded.state, {
    type: "START_GAME", actionId: randomUUID() as never, expectedVersion: loaded.state.version, actorId: "SYSTEM",
    opponentId: userId as PlayerId, dealPlan: { deck: shuffledDeck(secureSource), dealerId: randomBytes(1)[0]! % 2 === 0 ? loaded.state.players[0].id : userId as PlayerId },
  });
  if (!started.ok) throw new Error("Could not create initial deal.");
  const committed = await joinAndStartGame(invite, userId, displayName, started.nextState, started.events);
  const fresh = await loadCanonicalGame(committed.gameId);
  void notifyGameChanged(committed.gameId, committed.version);
  return projectGameState(fresh.state, userId, fresh.snapshots);
}
