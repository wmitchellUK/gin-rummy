import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "./supabase-admin";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (error || !userId) throw new HttpError(401, "UNAUTHENTICATED");
  return userId;
}

export async function requireMembership(gameId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("game_players").select("participant_id, seat, display_name").eq("game_id", gameId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Could not verify game membership.");
  if (!data) throw new HttpError(404, "GAME_NOT_FOUND");
  return { playerId: data.participant_id as string, seat: data.seat as 0 | 1, displayName: data.display_name as string };
}
