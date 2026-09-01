import { standardDeck } from "./cards";
import type { RandomSource, Card } from "./types";

function bounded(source: RandomSource, bound: number): number {
  const range = 0x1_0000_0000;
  const limit = range - (range % bound);
  let value: number;
  do value = source.nextUint32(); while (!Number.isInteger(value) || value < 0 || value >= range || value >= limit);
  return value % bound;
}

export function shuffledDeck(source: RandomSource): readonly Card[] {
  const deck = [...standardDeck()];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = bounded(source, index + 1);
    [deck[index], deck[other]] = [deck[other]!, deck[index]!];
  }
  return deck;
}
