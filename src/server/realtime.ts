import { createAdminClient } from "./supabase-admin";

/** A broadcast is merely a fetch hint; it never carries any game state. */
export async function notifyGameChanged(gameId: string, version: number) {
  const channel = createAdminClient().channel(`game:${gameId}`, { config: { private: true } });
  try {
    await channel.send({ type: "broadcast", event: "GAME_CHANGED", payload: { type: "GAME_CHANGED", gameId, version } });
  } finally {
    await createAdminClient().removeChannel(channel);
  }
}
