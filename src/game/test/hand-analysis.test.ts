import { describe, expect, it } from "vitest";
import { analyzeHand, enumerateMinimumDeadwoodArrangements } from "../hand-analysis";
import { meldSignature } from "../melds";
import { hand } from "./card-fixtures";

describe("exhaustive hand analysis", () => {
  it("chooses the non-greedy overlap with deadwood 17", () => {
    const analysis = analyzeHand(hand("3♣ 3♦ 3♥ 4♥ 5♥ 7♠ 8♠ 9♠ A♦ K♦"));
    expect(analysis.deadwoodValue).toBe(17);
    expect(analysis.deadwoodCards.map((card) => card.id)).toEqual(["A:DIAMONDS", "3:CLUBS", "3:DIAMONDS", "K:DIAMONDS"]);
    expect(analysis.melds.flatMap((meld) => meld.cards).filter((card) => card.id === "3:HEARTS")).toHaveLength(1);
  });
  it("uses the exact tie tuple repeatably for equal 21 arrangements", () => {
    const cards = hand("4♥ 5♥ 6♥ 5♣ 5♦ 9♠ 10♠ J♠ A♣ K♦");
    const first = analyzeHand(cards);
    expect(first.deadwoodValue).toBe(21);
    for (const permutation of [cards, [...cards].reverse(), [...cards.slice(3), ...cards.slice(0, 3)]]) {
      expect(analyzeHand(permutation).arrangementSignature).toBe(first.arrangementSignature);
      expect(analyzeHand(permutation).deadwoodCards.map((card) => card.id)).toEqual(first.deadwoodCards.map((card) => card.id));
    }
  });
  it("selects a long run and a four-card set together", () => {
    const analysis = analyzeHand(hand("2♥ 3♥ 4♥ 5♥ 6♥ 9♣ 9♦ 9♥ 9♠ K♣"));
    expect(analysis.deadwoodValue).toBe(10);
    expect(analysis.melds.map(meldSignature)).toEqual(["RUN:2:02:06", "SET:09:0123"]);
  });
  it("returns zero for a gin hand", () => expect(analyzeHand(hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 10♦ J♦ Q♦ K♦")).deadwoodValue).toBe(0));
  it("returns all cards as deadwood when there are no melds", () => {
    const cards = hand("A♣ 3♦ 5♥ 7♠ 9♣ J♦");
    const analysis = analyzeHand(cards);
    expect(analysis.deadwoodCards).toHaveLength(cards.length);
    expect(analysis.melds).toEqual([]);
  });
  it("enumerates every minimum-value opponent arrangement", () => {
    const results = enumerateMinimumDeadwoodArrangements(hand("4♥ 5♥ 6♥ 5♣ 5♦ 9♠ 10♠ J♠ A♣ K♦"));
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(new Set(results.map((result) => result.deadwoodValue))).toEqual(new Set([21]));
  });
  it("does not mutate the input hand", () => {
    const cards = hand("3♣ 3♦ 3♥ 4♥ 5♥ 7♠ 8♠ 9♠ A♦ K♦");
    const snapshot = structuredClone(cards);
    analyzeHand(cards);
    expect(cards).toEqual(snapshot);
  });
});
