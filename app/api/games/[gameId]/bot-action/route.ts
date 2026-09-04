import { NextResponse, type NextRequest } from "next/server";
import { requireMembership, requireUserId } from "@/src/server/auth";
import { applyPendingBotAction } from "@/src/server/bot-action-service";
import { routeError } from "@/src/server/http";

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const body = await request.json().catch(() => null) as { expectedVersion?: unknown } | null;
    if (!body || !Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 0
      || Object.keys(body).some((key) => key !== "expectedVersion")) {
      return NextResponse.json({ error: { code: "INVALID_BOT_ACTION" } }, { status: 400 });
    }
    const userId = await requireUserId();
    const { gameId } = await context.params;
    await requireMembership(gameId, userId);
    return NextResponse.json(await applyPendingBotAction(gameId, userId, body.expectedVersion as number));
  } catch (error) {
    return routeError(error);
  }
}
