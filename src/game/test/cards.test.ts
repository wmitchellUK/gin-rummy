import { describe, expect, it } from "vitest";
import { cardValue, compareCards, createCard, isCanonicalCard, sortCards, standardDeck } from "../cards";
import { c, hand } from "./card-fixtures";

describe("canonical cards", () => {
  it.each([
    ["A♣", 1], ["2♦", 2], ["10♥", 10], ["J♠", 10], ["Q♣", 10], ["K♦", 10],
  ] as const)("values %s as %d", (notation, value) => expect(cardValue(c(notation))).toBe(value));

  it("constructs rank/suit-derived IDs", () => expect(createCard("10", "HEARTS")).toEqual({ id: "10:HEARTS", rank: "10", suit: "HEARTS" }));

  it("sorts rank first and suit second", () => {
    expect(sortCards(hand("K♠ A♠ A♣ 10♦ 2♥")).map((card) => card.id)).toEqual([
      "A:CLUBS", "A:SPADES", "2:HEARTS", "10:DIAMONDS", "K:SPADES",
    ]);
    expect(compareCards(c("A♣"), c("A♦"))).toBeLessThan(0);
  });

  it("builds exactly one card for every rank/suit pair", () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => `${card.rank}:${card.suit}`)).size).toBe(52);
  });

  it("rejects an ID that disagrees with rank and suit", () => {
    expect(isCanonicalCard({ ...c("A♣"), id: "A:SPADES" })).toBe(false);
    expect(isCanonicalCard(c("A♣"))).toBe(true);
  });
});
