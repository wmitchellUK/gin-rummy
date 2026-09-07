import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../auth";
import {
  createGameMediaToken,
  mediaParticipantIdentity,
  mediaRoomName,
  signMediaParticipantToken,
} from "../media-token-service";
import type { LoadedGame } from "../game-repository";

const multiplayerGame = (status = "PLAYING", mode: LoadedGame["mode"] = "MULTIPLAYER"): LoadedGame => ({
  state: {} as LoadedGame["state"],
  snapshots: [
    { playerId: "participant-a", userId: "user-a", kind: "HUMAN", seat: 0, displayName: "Ada" },
    { playerId: "participant-b", userId: "user-b", kind: mode === "SINGLE_PLAYER" ? "BOT" : "HUMAN", seat: 1, displayName: "Grace" },
  ],
  status,
  mode,
  botProfile: mode === "SINGLE_PLAYER" ? "CASUAL_V1" : null,
  rematchRequestedBy: null,
});
function dependencies(game = multiplayerGame()) {
  return {
    requireMembership: vi.fn(async () => ({ playerId: "participant-a", seat: 0 as const, displayName: "Ada" })),
    loadGame: vi.fn(async () => game),
    createToken: vi.fn(async () => "signed-token"),
    env: {
      LIVEKIT_URL: "wss://example.livekit.cloud/",
      LIVEKIT_API_KEY: "api-key",
      LIVEKIT_API_SECRET: "api-secret",
    },
  };
}

describe("game media tokens", () => {
  it("derives the room, identity inputs, and display name on the server", async () => {
    const deps = dependencies();
    await expect(createGameMediaToken("game-123", "user-a", deps)).resolves.toEqual({
      server_url: "wss://example.livekit.cloud",
      participant_token: "signed-token",
    });
    expect(deps.requireMembership).toHaveBeenCalledWith("game-123", "user-a");
    expect(deps.createToken).toHaveBeenCalledWith({
      apiKey: "api-key",
      apiSecret: "api-secret",
      roomName: mediaRoomName("game-123"),
      participantId: "participant-a",
      displayName: "Ada",
    });
  });

  it.each(["PLAYING", "HAND_COMPLETE"])("allows human multiplayer games in %s", async (status) => {
    await expect(createGameMediaToken("game-123", "user-a", dependencies(multiplayerGame(status)))).resolves.toBeTruthy();
  });

  it.each(["WAITING", "COMPLETE"])("rejects the unsupported %s state", async (status) => {
    await expect(createGameMediaToken("game-123", "user-a", dependencies(multiplayerGame(status))))
      .rejects.toMatchObject({ status: 409, code: "MEDIA_UNSUPPORTED_STATE" });
  });

  it("rejects Naia games", async () => {
    await expect(createGameMediaToken("game-123", "user-a", dependencies(multiplayerGame("PLAYING", "SINGLE_PLAYER"))))
      .rejects.toMatchObject({ status: 409, code: "MEDIA_UNSUPPORTED_GAME" });
  });

  it("uses a safe membership error and does not continue", async () => {
    const deps = dependencies();
    deps.requireMembership.mockRejectedValue(new HttpError(404, "GAME_NOT_FOUND"));
    await expect(createGameMediaToken("game-123", "intruder", deps))
      .rejects.toMatchObject({ status: 404, code: "MEDIA_MEMBERSHIP_REQUIRED" });
    expect(deps.loadGame).not.toHaveBeenCalled();
    expect(deps.createToken).not.toHaveBeenCalled();
  });

  it.each([
    { LIVEKIT_URL: "", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" },
    { LIVEKIT_URL: "https://wrong-scheme.test", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "secret" },
    { LIVEKIT_URL: "wss://example.test", LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "secret" },
    { LIVEKIT_URL: "wss://example.test", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "" },
  ])("rejects unavailable or invalid configuration", async (env) => {
    const deps = { ...dependencies(), env };
    await expect(createGameMediaToken("game-123", "user-a", deps))
      .rejects.toMatchObject({ status: 503, code: "MEDIA_NOT_CONFIGURED" });
    expect(deps.createToken).not.toHaveBeenCalled();
  });

  it("signs a short-lived, room-scoped publish/subscribe token without embedding secrets", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signMediaParticipantToken({
      apiKey: "test-key",
      apiSecret: "test-secret-with-unique-value",
      roomName: "gin-rummy:game-123",
      participantId: "participant-a",
      displayName: "Ada",
    });
    const grants = await new TokenVerifier("test-key", "test-secret-with-unique-value").verify(token);
    expect(grants.sub).toBe(mediaParticipantIdentity("participant-a"));
    expect(grants.name).toBe("Ada");
    expect(grants.video).toMatchObject({
      room: "gin-rummy:game-123",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    expect(Number(grants.exp) - Number(grants.nbf)).toBe(300);
    expect(Number(grants.exp)).toBeGreaterThanOrEqual(before + 299);
    expect(token).not.toContain("test-secret-with-unique-value");
  });
});
