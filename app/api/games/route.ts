import { NextResponse } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { createNewGame } from "@/src/server/game-lifecycle-service";
import { routeError } from "@/src/server/http";

export async function POST() {
  try { return NextResponse.json(await createNewGame(await requireUserId()), { status: 201 }); }
  catch (error) { return routeError(error); }
}
