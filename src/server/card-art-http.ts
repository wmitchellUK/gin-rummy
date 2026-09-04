import "server-only";

import { NextResponse } from "next/server";
import { HttpError } from "./auth";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function cardArtJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

export function cardArtRouteError(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: { code: error.code } }, {
      status: error.status,
      headers: NO_STORE_HEADERS,
    });
  }
  console.error("Card-art API failure", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: { code: "INTERNAL_ERROR" } }, {
    status: 500,
    headers: NO_STORE_HEADERS,
  });
}
