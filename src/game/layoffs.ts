import { cardValue, sortCards } from "./cards";
import { enumerateMinimumDeadwoodArrangements } from "./hand-analysis";
import { createMeld, meldSignature } from "./melds";
import type { Card, Layoff, LayoffResult, Meld } from "./types";

interface SearchResult {
  readonly remaining: readonly Card[];
  readonly layoffs: readonly Layoff[];
  readonly targets: readonly Meld[];
}

const remainingValue = (result: SearchResult) => result.remaining.reduce((sum, card) => sum + cardValue(card), 0);
const layoffSignature = (layoffs: readonly Layoff[]) => layoffs.map((layoff) => `${layoff.card.id}>${layoff.targetMeldSignatureBefore}>${meldSignature(layoff.resultingMeld)}`).join(",");

function compareSearch(a: SearchResult, b: SearchResult): number {
  return remainingValue(a) - remainingValue(b)
    || a.remaining.length - b.remaining.length
    || a.remaining.map((card) => card.id).join(",").localeCompare(b.remaining.map((card) => card.id).join(","))
    || layoffSignature(a.layoffs).localeCompare(layoffSignature(b.layoffs));
}

function searchLayoffs(deadwood: readonly Card[], initialTargets: readonly Meld[]): SearchResult {
  const memo = new Map<string, SearchResult>();
  const visit = (remaining: readonly Card[], targets: readonly Meld[]): SearchResult => {
    const sortedRemaining = sortCards(remaining);
    const key = `${sortedRemaining.map((card) => card.id).join(",")}|${targets.map(meldSignature).join(",")}`;
    const cached = memo.get(key);
    if (cached) return cached;
    let best: SearchResult = { remaining: sortedRemaining, layoffs: [], targets };
    for (let cardIndex = 0; cardIndex < sortedRemaining.length; cardIndex += 1) {
      const card = sortedRemaining[cardIndex]!;
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex]!;
        const extended = createMeld([...target.cards, card]);
        if (!extended || extended.kind !== target.kind) continue;
        const nextTargets = targets.map((meld, index) => index === targetIndex ? extended : meld);
        const child = visit(sortedRemaining.filter((_, index) => index !== cardIndex), nextTargets);
        const candidate: SearchResult = {
          remaining: child.remaining,
          targets: child.targets,
          layoffs: [{ card, targetMeldSignatureBefore: meldSignature(target), resultingMeld: extended }, ...child.layoffs],
        };
        if (compareSearch(candidate, best) < 0) best = candidate;
      }
    }
    memo.set(key, best);
    return best;
  };
  return visit(deadwood, initialTargets);
}

export function optimizeLayoffs(opponentHand: readonly Card[], knockerMelds: readonly Meld[]): LayoffResult {
  const arrangements = enumerateMinimumDeadwoodArrangements(opponentHand);
  let best: (LayoffResult & { arrangementKey: string; layoffKey: string }) | undefined;
  for (const opponentAnalysis of arrangements) {
    const searched = searchLayoffs(opponentAnalysis.deadwoodCards, knockerMelds);
    const candidate = {
      opponentAnalysis,
      layoffs: searched.layoffs,
      finalDeadwoodCards: searched.remaining,
      finalDeadwoodValue: remainingValue(searched),
      arrangementKey: opponentAnalysis.arrangementSignature,
      layoffKey: layoffSignature(searched.layoffs),
    };
    if (!best || candidate.finalDeadwoodValue < best.finalDeadwoodValue
      || (candidate.finalDeadwoodValue === best.finalDeadwoodValue && candidate.finalDeadwoodCards.length < best.finalDeadwoodCards.length)
      || (candidate.finalDeadwoodValue === best.finalDeadwoodValue && candidate.finalDeadwoodCards.length === best.finalDeadwoodCards.length
        && candidate.finalDeadwoodCards.map((card) => card.id).join(",").localeCompare(best.finalDeadwoodCards.map((card) => card.id).join(",")) < 0)
      || (candidate.finalDeadwoodValue === best.finalDeadwoodValue && candidate.finalDeadwoodCards.length === best.finalDeadwoodCards.length
        && candidate.finalDeadwoodCards.map((card) => card.id).join(",") === best.finalDeadwoodCards.map((card) => card.id).join(",")
        && `${candidate.arrangementKey}|${candidate.layoffKey}`.localeCompare(`${best.arrangementKey}|${best.layoffKey}`) < 0)) best = candidate;
  }
  return {
    opponentAnalysis: best!.opponentAnalysis,
    layoffs: best!.layoffs,
    finalDeadwoodCards: best!.finalDeadwoodCards,
    finalDeadwoodValue: best!.finalDeadwoodValue,
  };
}
