import { connection, NextResponse } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { playerProfile } from "@/src/server/game-repository";
import { routeError } from "@/src/server/http";

export async function GET() {
  // Keep this outside the error mapper: during prerender it throws a Next.js
  // control-flow signal that must be allowed to mark the route dynamic.
  await connection();
  try {
    const profile = await playerProfile(await requireUserId());
    return NextResponse.json({ player: profile });
  } catch (error) {
    return routeError(error);
  }
}
