import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "../profile";

describe("normalizeDisplayName", () => {
  it("trims and collapses player names", () => {
    expect(normalizeDisplayName("  Ada\n  Lovelace  ")).toBe("Ada Lovelace");
  });

  it("rejects missing, blank, and overlong names", () => {
    expect(normalizeDisplayName(undefined)).toBeNull();
    expect(normalizeDisplayName(" \t ")).toBeNull();
    expect(normalizeDisplayName("a".repeat(41))).toBeNull();
  });
});
