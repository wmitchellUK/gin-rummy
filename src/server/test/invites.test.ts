import { describe, expect, it } from "vitest";
import { createInviteToken, inviteTokenDigest } from "../invites";

describe("invite tokens", () => {
  it("creates URL-safe 256-bit tokens and only digests valid tokens", () => {
    const token = createInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inviteTokenDigest(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(inviteTokenDigest("short-code")).toBeNull();
  });
});
