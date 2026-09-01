import { describe, expect, it } from "vitest";
import { shuffledDeck, standardDeck } from "../index";
import type { RandomSource } from "../types";

class SequenceSource implements RandomSource {
  calls = 0;
  constructor(private readonly values: readonly number[]) {}
  nextUint32(): number {
    const value = this.values[this.calls % this.values.length]!;
    this.calls += 1;
    return value;
  }
}

describe("injected Fisher-Yates shuffle", () => {
  it("is deterministic for the same injected sequence", () => {
    const first = shuffledDeck(new SequenceSource([1, 42, 7, 99]));
    const second = shuffledDeck(new SequenceSource([1, 42, 7, 99]));
    expect(second).toEqual(first);
  });

  it("always returns an exact 52-card permutation", () => {
    const result = shuffledDeck(new SequenceSource([0]));
    expect(result).toHaveLength(52);
    expect(new Set(result.map((card) => card.id))).toEqual(new Set(standardDeck().map((card) => card.id)));
  });

  it("uses rejection sampling rather than direct modulo", () => {
    const source = new SequenceSource([0xffff_ffff, 0]);
    shuffledDeck(source);
    expect(source.calls).toBeGreaterThan(51);
  });
});
