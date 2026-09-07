import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  createGameMediaToken: vi.fn(),
}));

vi.mock("@/src/server/auth", () => ({ requireUserId: mocks.requireUserId }));
vi.mock("@/src/server/media-token-service", () => ({ createGameMediaToken: mocks.createGameMediaToken }));

import { POST } from "@/app/api/games/[gameId]/media-token/route";

describe("POST media-token", () => {
  beforeEach(() => {
    mocks.requireUserId.mockReset().mockResolvedValue("user-a");
    mocks.createGameMediaToken.mockReset().mockResolvedValue({
      server_url: "wss://example.livekit.cloud",
      participant_token: "participant-jwt",
    });
  });

  it("returns only the public connection contract and prevents caching", async () => {
    const response = await POST(new Request("http://localhost/api/games/game-123/media-token", { method: "POST" }), {
      params: Promise.resolve({ gameId: "game-123" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      server_url: "wss://example.livekit.cloud",
      participant_token: "participant-jwt",
    });
    expect(mocks.createGameMediaToken).toHaveBeenCalledWith("game-123", "user-a");
  });
});
