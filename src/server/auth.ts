import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "./supabase-admin";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED");
  return data.user.id;
}

export async function requireMembership(gameId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("game_players").select("seat, display_name").eq("game_id", gameId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Could not verify game membership.");
  if (!data) throw new HttpError(404, "GAME_NOT_FOUND");
  return { seat: data.seat as 0 | 1, displayName: data.display_name as string };
}
