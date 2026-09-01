import { NextResponse, type NextRequest } from "next/server";
import { requireUserId } from "@/src/server/auth";
import { updateProfile } from "@/src/server/game-repository";
import { routeError } from "@/src/server/http";

function displayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= 40 ? normalized : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const name = displayName(body?.displayName);
    if (!name) return NextResponse.json({ error: { code: "INVALID_DISPLAY_NAME" } }, { status: 400 });
    await updateProfile(await requireUserId(), name);
    return NextResponse.json({ displayName: name });
  } catch (error) { return routeError(error); }
}
