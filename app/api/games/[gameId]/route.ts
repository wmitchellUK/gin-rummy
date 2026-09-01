import { NextResponse } from "next/server";
import { requireMembership, requireUserId } from "@/src/server/auth";
import { loadCanonicalGame } from "@/src/server/game-repository";
import { projectGameState } from "@/src/server/game-projection";
import { routeError } from "@/src/server/http";

export async function GET(_: Request, context: { params: Promise<{ gameId: string }> }) {
  try {
    const userId = await requireUserId();
    const { gameId } = await context.params;
    await requireMembership(gameId, userId);
    const loaded = await loadCanonicalGame(gameId);
    return NextResponse.json({ game: projectGameState(loaded.state, userId, loaded.snapshots) });
  } catch (error) { return routeError(error); }
}
