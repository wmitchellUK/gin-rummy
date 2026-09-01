import { NextResponse } from "next/server";

// Invite acceptance moved to /api/invites/[token]/join. Retaining this route
// as a privacy-preserving response prevents old short codes from claiming seats.
export async function POST() {
  return NextResponse.json({ error: { code: "INVITE_UNAVAILABLE" } }, { status: 404 });
}
