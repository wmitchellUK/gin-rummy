import { NextResponse } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { resolveInvite } from "@/src/server/game-lifecycle-service";
import { routeError } from "@/src/server/http";

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const resolution = await resolveInvite(await requireUserId(), token);
    return NextResponse.json(resolution);
  } catch (error) {
    return routeError(error);
  }
}
