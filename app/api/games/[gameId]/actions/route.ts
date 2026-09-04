import { NextResponse, type NextRequest } from "next/server";
import { requireMembership, requireUserId } from "@/src/server/auth";
import { parseActionRequest } from "@/src/server/game-input";
import { applyPlayerAction } from "@/src/server/game-action-service";
import { routeError } from "@/src/server/http";

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const parsed = parseActionRequest(await request.json().catch(() => null));
    if (!parsed) return NextResponse.json({ error: { code: "INVALID_ACTION" } }, { status: 400 });
    const { gameId } = await context.params;
    const userId = await requireUserId();
    const membership = await requireMembership(gameId, userId);
    const result = await applyPlayerAction(gameId, membership.playerId, parsed);
    if (result.errorCode) return NextResponse.json({ error: { code: result.errorCode }, game: result.view }, { status: result.stale ? 409 : 400 });
    if (result.stale) return NextResponse.json({ error: { code: "STALE_VERSION" }, game: result.view }, { status: 409 });
    return NextResponse.json({ game: result.view });
  } catch (error) { return routeError(error); }
}
