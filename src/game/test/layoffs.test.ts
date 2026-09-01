import { describe, expect, it } from "vitest";
import { createMeld, meldSignature } from "../melds";
import { optimizeLayoffs } from "../layoffs";
import { hand } from "./card-fixtures";

describe("exhaustive layoffs", () => {
  it("finds chained run extensions and a set layoff", () => {
    const targets = [createMeld(hand("4♥ 5♥ 6♥"))!, createMeld(hand("9♣ 9♦ 9♠"))!];
    const opponent = hand("A♣ 2♣ 3♣ Q♣ Q♦ Q♠ 2♥ 3♥ 7♥ 9♥");
    const result = optimizeLayoffs(opponent, targets);
    expect(result.finalDeadwoodValue).toBe(0);
    expect(result.layoffs.map((layoff) => layoff.card.id).sort()).toEqual(["2:HEARTS", "3:HEARTS", "7:HEARTS", "9:HEARTS"]);
    expect(result.layoffs.some((layoff) => meldSignature(layoff.resultingMeld) === "RUN:2:02:07")).toBe(true);
    expect(result.layoffs.some((layoff) => meldSignature(layoff.resultingMeld) === "SET:09:0123")).toBe(true);
  });

  it("chooses a deterministic target when one card fits two runs", () => {
    const targets = [createMeld(hand("3♥ 4♥ 5♥"))!, createMeld(hand("7♥ 8♥ 9♥"))!];
    const opponent = hand("A♣ 2♣ 3♣ Q♣ Q♦ Q♠ 2♦ 3♦ 4♦ 6♥");
    const result = optimizeLayoffs(opponent, targets);
    expect(result.finalDeadwoodValue).toBe(0);
    expect(result.layoffs).toHaveLength(1);
    expect(result.layoffs[0]!.targetMeldSignatureBefore).toBe("RUN:2:03:05");
  });

  it("lays a fourth suit onto a three-card set", () => {
    const result = optimizeLayoffs(
      hand("A♣ 2♣ 3♣ 4♦ 5♦ 6♦ 7♠ 8♠ 9♠ 9♥"),
      [createMeld(hand("9♣ 9♦ 9♠"))!],
    );
    expect(result.finalDeadwoodValue).toBe(0);
    expect(meldSignature(result.layoffs[0]!.resultingMeld)).toBe("SET:09:0123");
  });

  it("does not consume cards already used in an opponent meld", () => {
    const opponent = hand("3♥ 4♥ 5♥ A♣ 2♣ 3♣ Q♣ Q♦ Q♠ K♦");
    const result = optimizeLayoffs(opponent, [createMeld(hand("2♥ 3♥ 4♥"))!]);
    expect(result.layoffs.map((layoff) => layoff.card.id)).not.toContain("5:HEARTS");
    expect(result.finalDeadwoodCards.map((card) => card.id)).toEqual(["K:DIAMONDS"]);
  });

  it("is independent of opponent card ordering", () => {
    const opponent = hand("A♣ 2♣ 3♣ Q♣ Q♦ Q♠ 2♥ 3♥ 7♥ 9♥");
    const targets = [createMeld(hand("4♥ 5♥ 6♥"))!, createMeld(hand("9♣ 9♦ 9♠"))!];
    const first = optimizeLayoffs(opponent, targets);
    const second = optimizeLayoffs([...opponent].reverse(), [...targets].reverse());
    expect(second.finalDeadwoodValue).toBe(first.finalDeadwoodValue);
    expect(second.layoffs.map((layoff) => layoff.card.id).sort()).toEqual(first.layoffs.map((layoff) => layoff.card.id).sort());
  });
});
