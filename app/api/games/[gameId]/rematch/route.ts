import { NextResponse, type NextRequest } from "next/server";
import { requireMembership, requireUserId } from "@/src/server/auth";
import { routeError } from "@/src/server/http";
import { rematchGame } from "@/src/server/game-lifecycle-service";

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !["REQUEST", "ACCEPT", "PLAY_AGAIN"].includes(body.response) || Object.keys(body).some((key) => key !== "response")) {
      return NextResponse.json({ error: { code: "INVALID_REMATCH_ACTION" } }, { status: 400 });
    }
    const { gameId } = await context.params;
    const userId = await requireUserId();
    await requireMembership(gameId, userId);
    return NextResponse.json(await rematchGame(gameId, userId, body.response));
  } catch (error) { return routeError(error); }
}
