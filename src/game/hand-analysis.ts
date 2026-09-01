import { cardValue, sortCards } from "./cards";
import { generateCandidateMelds, meldSignature } from "./melds";
import type { Card, HandAnalysis, Meld } from "./types";

function tuple(analysis: HandAnalysis): readonly [number, number, string, string] {
  return [analysis.deadwoodValue, analysis.deadwoodCards.length, analysis.deadwoodCards.map((card) => card.id).join(","), analysis.arrangementSignature];
}

function compareTuple(a: HandAnalysis, b: HandAnalysis): number {
  const left = tuple(a), right = tuple(b);
  return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]) || left[3].localeCompare(right[3]);
}

export function enumerateMinimumDeadwoodArrangements(hand: readonly Card[]): readonly HandAnalysis[] {
  const cards = sortCards(hand);
  const indexById = new Map(cards.map((card, index) => [card.id, index]));
  const candidates = generateCandidateMelds(cards).map((meld) => ({
    meld,
    mask: meld.cards.reduce((mask, card) => mask | (1 << indexById.get(card.id)!), 0),
  }));
  const results: HandAnalysis[] = [];
  const visit = (index: number, usedMask: number, melds: readonly Meld[]) => {
    if (index === candidates.length) {
      const deadwoodCards = cards.filter((_, cardIndex) => (usedMask & (1 << cardIndex)) === 0);
      const sortedMelds = [...melds].sort((a, b) => meldSignature(a).localeCompare(meldSignature(b)));
      results.push({ melds: sortedMelds, deadwoodCards, deadwoodValue: deadwoodCards.reduce((sum, card) => sum + cardValue(card), 0), arrangementSignature: sortedMelds.map(meldSignature).join(",") });
      return;
    }
    visit(index + 1, usedMask, melds);
    const candidate = candidates[index]!;
    if ((usedMask & candidate.mask) === 0) visit(index + 1, usedMask | candidate.mask, [...melds, candidate.meld]);
  };
  visit(0, 0, []);
  const minimum = Math.min(...results.map((result) => result.deadwoodValue));
  const unique = new Map<string, HandAnalysis>();
  for (const result of results.filter((item) => item.deadwoodValue === minimum)) unique.set(`${result.deadwoodCards.map((c) => c.id).join(",")}|${result.arrangementSignature}`, result);
  return [...unique.values()].sort(compareTuple);
}

export function analyzeHand(hand: readonly Card[]): HandAnalysis {
  return enumerateMinimumDeadwoodArrangements(hand)[0]!;
}
