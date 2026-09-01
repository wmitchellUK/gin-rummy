import { NextResponse } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { joinGameByInviteToken } from "@/src/server/game-lifecycle-service";
import { routeError } from "@/src/server/http";

export async function POST(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const result = await joinGameByInviteToken(await requireUserId(), token);
    if (result.outcome === "JOINED") return NextResponse.json({ state: result.outcome, game: result.game });
    if (result.outcome === "ALREADY_A_PLAYER") return NextResponse.json({ state: result.outcome, gameId: result.gameId });
    return NextResponse.json({ state: "FULL" });
  } catch (error) {
    return routeError(error);
  }
}
