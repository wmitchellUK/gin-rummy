import { describe, expect, it } from "vitest";
import { CARD_ART_ERROR_STATUS, cardArtError, type CardArtErrorCode } from "../card-art-errors";
import { cardArtRouteError } from "../card-art-http";

describe("card-art HTTP errors", () => {
  it.each(Object.entries(CARD_ART_ERROR_STATUS))("maps %s to status %i", async (code, status) => {
    const response = cardArtRouteError(cardArtError(code as CardArtErrorCode));
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });
});
