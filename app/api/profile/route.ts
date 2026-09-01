import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { updateProfile } from "@/src/server/game-repository";
import { routeError } from "@/src/server/http";
import { normalizeDisplayName } from "@/src/server/profile";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const name = normalizeDisplayName(body?.displayName);
    if (!name) return NextResponse.json({ error: { code: "INVALID_DISPLAY_NAME" } }, { status: 400 });
    await updateProfile(await requireUserId(), name);
    return NextResponse.json({ displayName: name });
  } catch (error) { return routeError(error); }
}
