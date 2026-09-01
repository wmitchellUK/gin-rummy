import type { GameEvent, GameResult, GameState } from "@/src/game";
import { createAdminClient } from "./supabase-admin";
import { HttpError } from "./auth";
import type { PlayerSnapshot } from "./game-projection";

export type LoadedGame = { readonly state: GameState; readonly snapshots: readonly PlayerSnapshot[]; readonly status: string; readonly rematchRequestedBy: string | null };

export async function loadCanonicalGame(gameId: string): Promise<LoadedGame> {
  const admin = createAdminClient();
  const [{ data: checkpoint, error: checkpointError }, { data: players, error: playersError }, { data: game, error: gameError }] = await Promise.all([
    admin.from("game_state").select("canonical_state").eq("game_id", gameId).maybeSingle(),
    admin.from("game_players").select("user_id, seat, display_name").eq("game_id", gameId).order("seat"),
    admin.from("games").select("status, rematch_requested_by").eq("id", gameId).maybeSingle(),
  ]);
  if (checkpointError || playersError || gameError) throw new Error("Could not load game.");
  if (!checkpoint || !game || !players) throw new HttpError(404, "GAME_NOT_FOUND");
  return {
    state: checkpoint.canonical_state as GameState,
    snapshots: players.map((row) => ({ userId: row.user_id, seat: row.seat as 0 | 1, displayName: row.display_name })),
    status: game.status,
    rematchRequestedBy: game.rematch_requested_by as string | null,
  };
}

export async function findActionReceipt(actionId: string) {
  const { data, error } = await createAdminClient().from("game_actions").select("game_id, actor_id, accepted_version").eq("action_id", actionId).maybeSingle();
  if (error) throw new Error("Could not read action receipt.");
  return data;
}

function gameStatus(state: GameState): "WAITING" | "PLAYING" | "HAND_COMPLETE" | "COMPLETE" {
  if (state.phase === "WAITING_FOR_PLAYER") return "WAITING";
  if (state.phase === "HAND_COMPLETE") return "HAND_COMPLETE";
  if (state.phase === "GAME_COMPLETE") return "COMPLETE";
  return "PLAYING";
}

export async function commitGameAction(input: {
  actionId: string; gameId: string; actorId: string; expectedVersion: number; actionType: string;
  nextState: GameState; events: readonly GameEvent[]; result?: GameResult;
}): Promise<{ outcome: "COMMITTED" | "IDEMPOTENT" | "STALE"; version: number }> {
  const { data, error } = await createAdminClient().rpc("commit_game_action", {
    p_action_id: input.actionId, p_game_id: input.gameId, p_actor_id: input.actorId,
    p_expected_version: input.expectedVersion, p_action_type: input.actionType,
    p_next_state: input.nextState, p_status: gameStatus(input.nextState), p_events: input.events,
    p_result: input.result ?? null,
  }).single();
  if (error) {
    if (error.message.includes("ACTION_ID_CONFLICT")) throw new HttpError(409, "ACTION_ID_CONFLICT");
    throw new Error("Could not commit game action.");
  }
  const row = data as { outcome: "COMMITTED" | "IDEMPOTENT" | "STALE"; accepted_version: number };
  return { outcome: row.outcome, version: row.accepted_version };
}

export async function updateProfile(userId: string, displayName: string) {
  const { error } = await createAdminClient().from("profiles").update({ display_name: displayName }).eq("id", userId);
  if (error) throw new Error("Could not update profile.");
}

export async function playerProfile(userId: string): Promise<{ displayName: string | null }> {
  const { data, error } = await createAdminClient().from("profiles").select("display_name").eq("id", userId).maybeSingle();
  if (error) throw new Error("Could not load profile.");
  if (!data) throw new HttpError(400, "PROFILE_NOT_READY");
  return { displayName: typeof data.display_name === "string" ? data.display_name : null };
}

export async function profileName(userId: string): Promise<string> {
  const { displayName } = await playerProfile(userId);
  if (!displayName) throw new HttpError(409, "PROFILE_NAME_REQUIRED");
  return displayName;
}

export async function createGame(inviteCode: string, inviteTokenDigest: string, creatorId: string, displayName: string, rules: object): Promise<string> {
  const { data, error } = await createAdminClient().rpc("create_waiting_game", {
    p_invite_code: inviteCode, p_invite_token_digest: inviteTokenDigest,
    p_creator_id: creatorId, p_display_name: displayName, p_rules: rules,
  });
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "INVITE_CODE_COLLISION");
    throw new Error("Could not create game.");
  }
  return data as string;
}

export async function findInvite(tokenDigest: string): Promise<{ id: string; status: string } | null> {
  const { data, error } = await createAdminClient().from("games").select("id, status").eq("invite_token_digest", tokenDigest).maybeSingle();
  if (error) throw new Error("Could not resolve invite.");
  return data ? { id: data.id as string, status: data.status as string } : null;
}

export async function joinAndStartWithInviteToken(tokenDigest: string, userId: string, displayName: string, nextState: GameState, events: readonly GameEvent[]) {
  const { data, error } = await createAdminClient().rpc("join_game_and_start_with_invite_token", {
    p_invite_token_digest: tokenDigest, p_user_id: userId, p_display_name: displayName,
    p_next_state: nextState, p_events: events,
  }).single();
  if (error) {
    if (error.message.includes("INVITE_UNAVAILABLE")) throw new HttpError(404, "INVITE_UNAVAILABLE");
    throw new Error("Could not join game.");
  }
  return data as { outcome: "JOINED" | "ALREADY_A_PLAYER" | "FULL"; game_id: string | null; version: number | null };
}

export async function joinAndStartGame(inviteCode: string, userId: string, displayName: string, nextState: GameState, events: readonly GameEvent[]) {
  const { data, error } = await createAdminClient().rpc("join_game_and_start", {
    p_invite_code: inviteCode, p_user_id: userId, p_display_name: displayName, p_next_state: nextState, p_events: events,
  }).single();
  if (error) {
    if (error.message.includes("INVITE_UNAVAILABLE")) throw new HttpError(404, "INVITE_UNAVAILABLE");
    throw new Error("Could not join game.");
  }
  const row = data as { game_id: string; version: number };
  return { gameId: row.game_id, version: row.version };
}

export async function requestRematch(gameId: string, userId: string) {
  const { error } = await createAdminClient().rpc("request_rematch", { p_game_id: gameId, p_user_id: userId });
  if (error) {
    if (error.message.includes("REMATCH_UNAVAILABLE")) throw new HttpError(400, "REMATCH_UNAVAILABLE");
    throw new Error("Could not request rematch.");
  }
}

export async function acceptRematch(input: {
  gameId: string; userId: string; newGameId: string; inviteCode: string; nextState: GameState; events: readonly GameEvent[];
}) {
  const { data, error } = await createAdminClient().rpc("accept_rematch", {
    p_game_id: input.gameId, p_user_id: input.userId, p_new_game_id: input.newGameId,
    p_invite_code: input.inviteCode, p_next_state: input.nextState, p_events: input.events,
  }).single();
  if (error) {
    if (error.message.includes("REMATCH_UNAVAILABLE")) throw new HttpError(400, "REMATCH_UNAVAILABLE");
    throw new Error("Could not accept rematch.");
  }
  return data as { game_id: string; version: number };
}
