import { describe, expect, it } from "vitest";
import {
  FACE_CARD_SLOTS,
  isFaceCardSlot,
  sanitizeFaceCardManifest,
} from "../card-art";

describe("card-art slots and manifests", () => {
  it("defines exactly the J, Q, and K slots for all four canonical suits", () => {
    expect(FACE_CARD_SLOTS).toHaveLength(12);
    expect(new Set(FACE_CARD_SLOTS).size).toBe(12);
    expect(FACE_CARD_SLOTS).toEqual([
      "J:CLUBS", "J:DIAMONDS", "J:HEARTS", "J:SPADES",
      "Q:CLUBS", "Q:DIAMONDS", "Q:HEARTS", "Q:SPADES",
      "K:CLUBS", "K:DIAMONDS", "K:HEARTS", "K:SPADES",
    ]);
  });

  it.each([
    ["K:SPADES", true],
    ["A:SPADES", false],
    ["J:clubs", false],
    ["JOKER:HEARTS", false],
    [null, false],
  ])("validates slot %j", (value, expected) => {
    expect(isFaceCardSlot(value)).toBe(expected);
  });

  it("sanitizes partial untrusted manifests without inventing missing slots", () => {
    expect(sanitizeFaceCardManifest({
      "J:CLUBS": "sets/j-clubs.webp",
      "Q:HEARTS": "sets/q-hearts.webp",
      "A:SPADES": "sets/ace.webp",
      "K:SPADES": 42,
      "K:HEARTS": "",
    })).toEqual({
      "J:CLUBS": "sets/j-clubs.webp",
      "Q:HEARTS": "sets/q-hearts.webp",
    });
    expect(sanitizeFaceCardManifest([])).toEqual({});
    expect(sanitizeFaceCardManifest(null)).toEqual({});
  });
});
