import { createHash, randomBytes } from "node:crypto";

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteTokenDigest(token: string): string | null {
  if (!INVITE_TOKEN_PATTERN.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}
