import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { joinGameByInvite } from "@/src/server/game-lifecycle-service";
import { routeError } from "@/src/server/http";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.inviteCode !== "string" || Object.keys(body).some((key) => key !== "inviteCode")) return NextResponse.json({ error: { code: "INVITE_UNAVAILABLE" } }, { status: 404 });
    return NextResponse.json({ game: await joinGameByInvite(await requireUserId(), body.inviteCode) });
  } catch (error) { return routeError(error); }
}
