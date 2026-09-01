import { describe, expect, it } from "vitest";
import { generateCandidateMelds, isValidRun, isValidSet, meldSignature } from "../melds";
import { c, hand } from "./card-fixtures";

describe("meld validation and generation", () => {
  it("accepts an ace-low run", () => expect(isValidRun(hand("A♣ 2♣ 3♣"))).toBe(true));
  it.each(["Q♣ K♣ A♣", "K♣ A♣ 2♣"])("rejects ace wrapping in %s", (cards) => expect(isValidRun(hand(cards))).toBe(false));
  it("rejects a run with mixed suits", () => expect(isValidRun(hand("2♣ 3♣ 4♦"))).toBe(false));
  it("rejects a run with a gap", () => expect(isValidRun(hand("2♣ 3♣ 5♣"))).toBe(false));
  it("accepts a three-card set with distinct suits", () => expect(isValidSet(hand("7♣ 7♦ 7♥"))).toBe(true));
  it("accepts all four suits as a set", () => expect(isValidSet(hand("7♣ 7♦ 7♥ 7♠"))).toBe(true));
  it("rejects mixed ranks and repeated identities", () => {
    expect(isValidSet(hand("7♣ 7♦ 8♥"))).toBe(false);
    expect(isValidSet([c("7♣"), c("7♦"), c("7♣")])).toBe(false);
  });
  it("emits all four three-card subsets and the four-card set", () => {
    const candidates = generateCandidateMelds(hand("7♣ 7♦ 7♥ 7♠"));
    expect(candidates).toHaveLength(5);
    expect(candidates.map(meldSignature)).toEqual([...candidates.map(meldSignature)].sort());
  });
  it("emits every contiguous subrun of a five-card run", () => {
    const signatures = generateCandidateMelds(hand("2♥ 3♥ 4♥ 5♥ 6♥")).map(meldSignature);
    expect(signatures).toEqual([
      "RUN:2:02:04", "RUN:2:02:05", "RUN:2:02:06", "RUN:2:03:05", "RUN:2:03:06", "RUN:2:04:06",
    ]);
  });
  it("deduplicates candidates when input order changes", () => {
    const cards = hand("6♥ 3♥ 5♥ 4♥ 7♣ 7♦ 7♥");
    expect(generateCandidateMelds(cards).map(meldSignature)).toEqual(generateCandidateMelds([...cards].reverse()).map(meldSignature));
  });
});
