import "server-only";

import { AccessToken } from "livekit-server-sdk";
import { HttpError } from "./auth";
import { loadCanonicalGame, type LoadedGame } from "./game-repository";
import { requireMembership } from "./auth";

const TOKEN_TTL_SECONDS = 5 * 60;

export type MediaTokenResponse = {
  readonly server_url: string;
  readonly participant_token: string;
};

type Membership = Awaited<ReturnType<typeof requireMembership>>;
type MediaTokenDependencies = {
  readonly requireMembership: (gameId: string, userId: string) => Promise<Membership>;
  readonly loadGame: (gameId: string) => Promise<LoadedGame>;
  readonly createToken: (input: {
    apiKey: string;
    apiSecret: string;
    roomName: string;
    participantId: string;
    displayName: string;
  }) => Promise<string>;
  readonly env: {
    readonly LIVEKIT_URL?: string;
    readonly LIVEKIT_API_KEY?: string;
    readonly LIVEKIT_API_SECRET?: string;
  };
};

const defaultDependencies: MediaTokenDependencies = {
  requireMembership,
  loadGame: loadCanonicalGame,
  env: {
    LIVEKIT_URL: process.env.LIVEKIT_URL,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  },
  createToken: signMediaParticipantToken,
};

export const mediaRoomName = (gameId: string) => `gin-rummy:${gameId}`;
export const mediaParticipantIdentity = (participantId: string) => `player:${participantId}`;

export async function signMediaParticipantToken(input: {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  participantId: string;
  displayName: string;
}): Promise<string> {
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: mediaParticipantIdentity(input.participantId),
    name: input.displayName,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return token.toJwt();
}

export async function createGameMediaToken(
  gameId: string,
  userId: string,
  dependencies: MediaTokenDependencies = defaultDependencies,
): Promise<MediaTokenResponse> {
  let membership: Membership;
  try {
    membership = await dependencies.requireMembership(gameId, userId);
  } catch (error) {
    if (error instanceof HttpError && error.code === "GAME_NOT_FOUND") {
      throw new HttpError(404, "MEDIA_MEMBERSHIP_REQUIRED");
    }
    throw error;
  }

  const game = await dependencies.loadGame(gameId);
  if (game.mode !== "MULTIPLAYER" || game.snapshots.some((player) => player.kind !== "HUMAN")) {
    throw new HttpError(409, "MEDIA_UNSUPPORTED_GAME");
  }
  if (game.status !== "PLAYING" && game.status !== "HAND_COMPLETE") {
    throw new HttpError(409, "MEDIA_UNSUPPORTED_STATE");
  }

  const serverUrl = configuredServerUrl(dependencies.env.LIVEKIT_URL);
  const apiKey = dependencies.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = dependencies.env.LIVEKIT_API_SECRET?.trim();
  if (!serverUrl || !apiKey || !apiSecret) throw new HttpError(503, "MEDIA_NOT_CONFIGURED");

  const participantToken = await dependencies.createToken({
    apiKey,
    apiSecret,
    roomName: mediaRoomName(gameId),
    participantId: membership.playerId,
    displayName: membership.displayName,
  });
  return { server_url: serverUrl, participant_token: participantToken };
}

function configuredServerUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "wss:" || url.protocol === "ws:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}
