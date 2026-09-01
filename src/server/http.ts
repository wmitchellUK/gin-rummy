import { NextResponse } from "next/server";
import { HttpError } from "./auth";

export function routeError(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: { code: error.code } }, { status: error.status });
  console.error("Game API failure", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 });
}
