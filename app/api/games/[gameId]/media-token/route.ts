import { NextResponse } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { routeError } from "@/src/server/http";
import { createGameMediaToken } from "@/src/server/media-token-service";

export async function POST(_: Request, context: { params: Promise<{ gameId: string }> }) {
  try {
    const userId = await requireUserId();
    const { gameId } = await context.params;
    const media = await createGameMediaToken(gameId, userId);
    return NextResponse.json(media, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = routeError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
