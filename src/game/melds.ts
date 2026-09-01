import { compareCards, rankNumber, sortCards, suitNumber } from "./cards";
import type { Card, Meld, Run, Set } from "./types";

export function isValidSet(cards: readonly Card[]): boolean {
  return (cards.length === 3 || cards.length === 4)
    && new globalThis.Set(cards.map((card) => card.id)).size === cards.length
    && new globalThis.Set(cards.map((card) => card.suit)).size === cards.length
    && cards.every((card) => card.rank === cards[0]!.rank);
}

export function isValidRun(cards: readonly Card[]): boolean {
  if (cards.length < 3 || new globalThis.Set(cards.map((card) => card.id)).size !== cards.length) return false;
  const sorted = [...cards].sort(compareCards);
  return sorted.every((card) => card.suit === sorted[0]!.suit)
    && sorted.slice(1).every((card, index) => rankNumber(card.rank) === rankNumber(sorted[index]!.rank) + 1);
}

export function meldSignature(meld: Meld): string {
  if (meld.kind === "RUN") {
    const cards = sortCards(meld.cards);
    return `RUN:${suitNumber(meld.suit)}:${String(rankNumber(cards[0]!.rank)).padStart(2, "0")}:${String(rankNumber(cards.at(-1)!.rank)).padStart(2, "0")}`;
  }
  return `SET:${String(rankNumber(meld.rank)).padStart(2, "0")}:${[...meld.cards].sort(compareCards).map((card) => suitNumber(card.suit)).join("")}`;
}

export function createMeld(cards: readonly Card[]): Meld | null {
  const sorted = sortCards(cards);
  if (isValidSet(sorted)) return { kind: "SET", rank: sorted[0]!.rank, cards: sorted as Set["cards"] };
  if (isValidRun(sorted)) return { kind: "RUN", suit: sorted[0]!.suit, cards: sorted as Run["cards"] };
  return null;
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === size) { output.push(chosen); return; }
    for (let index = start; index <= items.length - (size - chosen.length); index += 1) visit(index + 1, [...chosen, items[index]!]);
  };
  visit(0, []);
  return output;
}

export function generateCandidateMelds(hand: readonly Card[]): readonly Meld[] {
  const found = new Map<string, Meld>();
  for (const rank of new globalThis.Set(hand.map((card) => card.rank))) {
    const group = sortCards(hand.filter((card) => card.rank === rank));
    for (const size of [3, 4]) for (const cards of combinations(group, size)) {
      const meld = createMeld(cards);
      if (meld) found.set(meldSignature(meld), meld);
    }
  }
  for (const suit of new globalThis.Set(hand.map((card) => card.suit))) {
    const cards = [...hand.filter((card) => card.suit === suit)].sort(compareCards);
    let start = 0;
    for (let index = 1; index <= cards.length; index += 1) {
      if (index < cards.length && rankNumber(cards[index]!.rank) === rankNumber(cards[index - 1]!.rank) + 1) continue;
      const sequence = cards.slice(start, index);
      for (let from = 0; from < sequence.length; from += 1) for (let to = from + 3; to <= sequence.length; to += 1) {
        const meld = createMeld(sequence.slice(from, to));
        if (meld) found.set(meldSignature(meld), meld);
      }
      start = index;
    }
  }
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, meld]) => meld);
}
