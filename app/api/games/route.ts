import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { createNewGame } from "@/src/server/game-lifecycle-service";
import { routeError } from "@/src/server/http";

export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text) as unknown; }
      catch { return NextResponse.json({ error: { code: "INVALID_GAME_MODE" } }, { status: 400 }); }
    }
    if (body !== null && (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => key !== "mode")
      || !["MULTIPLAYER", "SINGLE_PLAYER"].includes((body as { mode?: string }).mode ?? ""))) {
      return NextResponse.json({ error: { code: "INVALID_GAME_MODE" } }, { status: 400 });
    }
    const mode = body === null ? "MULTIPLAYER" : (body as { mode: "MULTIPLAYER" | "SINGLE_PLAYER" }).mode;
    return NextResponse.json(await createNewGame(await requireUserId(), mode), { status: 201 });
  }
  catch (error) { return routeError(error); }
}
