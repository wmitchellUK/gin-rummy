import { analyzeHand, rankNumber, standardDeck, type Card } from "@/src/game";
import type { BotIntent, BotObservation, BotRandomSource } from "./types";

type DiscardChoice = { readonly card: Card; readonly quality: number; readonly deadwood: number };

function pairPotential(cards: readonly Card[]): number {
  let value = 0;
  const ranks = new Map<string, number>();
  for (const card of cards) ranks.set(card.rank, (ranks.get(card.rank) ?? 0) + 1);
  for (const count of ranks.values()) if (count === 2) value += 3;
  for (let left = 0; left < cards.length; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      const a = cards[left]!, b = cards[right]!;
      if (a.suit !== b.suit) continue;
      const distance = Math.abs(rankNumber(a.rank) - rankNumber(b.rank));
      if (distance === 1) value += 4;
      else if (distance === 2) value += 2;
    }
  }
  return value;
}

function handQuality(cards: readonly Card[]): { quality: number; deadwood: number } {
  const analysis = analyzeHand(cards);
  return { quality: -2 * analysis.deadwoodValue + pairPotential(analysis.deadwoodCards), deadwood: analysis.deadwoodValue };
}

function defensivePenalty(card: Card, recentTakes: readonly Card[]): number {
  return recentTakes.reduce((penalty, taken, index) => {
    const recency = Math.max(1, 4 - index);
    if (card.rank === taken.rank) return penalty + 2 * recency;
    if (card.suit === taken.suit && Math.abs(rankNumber(card.rank) - rankNumber(taken.rank)) === 1) return penalty + 1.5 * recency;
    return penalty;
  }, 0);
}

function rankedDiscards(hand: readonly Card[], forbiddenId: string | null | undefined, recentTakes: readonly Card[]): readonly DiscardChoice[] {
  return hand
    .filter((card) => card.id !== forbiddenId)
    .map((card) => {
      const result = handQuality(hand.filter((item) => item.id !== card.id));
      return { card, deadwood: result.deadwood, quality: result.quality - defensivePenalty(card, recentTakes) };
    })
    .sort((left, right) => right.quality - left.quality || left.card.id.localeCompare(right.card.id));
}

function choosePlausible(options: readonly DiscardChoice[], random: BotRandomSource): DiscardChoice {
  const best = options[0];
  if (!best) throw new Error("Nia has no legal discard.");
  const eligible = options.filter((option) => best.quality - option.quality <= 6).slice(0, 3);
  const roll = random.nextFloat();
  const index = roll < 0.78 ? 0 : roll < 0.95 ? 1 : 2;
  return eligible[Math.min(index, eligible.length - 1)]!;
}

function outcomeAfterKnownDraw(observation: BotObservation, card: Card): number {
  return rankedDiscards([...observation.hand, card], card.id, observation.recentOpponentTakes)[0]?.quality ?? Number.NEGATIVE_INFINITY;
}

function expectedStockQuality(observation: BotObservation): number {
  const known = new Set([...observation.hand, ...observation.publicKnownCards].map((card) => card.id));
  const unseen = standardDeck().filter((card) => !known.has(card.id));
  if (!unseen.length) return handQuality(observation.hand).quality;
  const total = unseen.reduce((sum, card) => {
    const best = rankedDiscards([...observation.hand, card], null, observation.recentOpponentTakes)[0];
    return sum + (best?.quality ?? handQuality(observation.hand).quality);
  }, 0);
  return total / unseen.length;
}

function shouldTakeDiscard(observation: BotObservation, random: BotRandomSource): boolean {
  if (!observation.topDiscard) return false;
  const advantage = outcomeAfterKnownDraw(observation, observation.topDiscard) - expectedStockQuality(observation);
  if (advantage >= 2) return true;
  if (advantage <= -2) return false;
  return random.nextFloat() < (advantage >= 0 ? 0.7 : 0.3);
}

function knockChance(deadwood: number, stockCount: number, recentOpponentTakes: readonly Card[]): number {
  const base = deadwood <= 4 ? 0.9 : deadwood <= 7 ? 0.7 : 0.45;
  const lateStockBonus = stockCount < 15 ? 0.15 : 0;
  const undercutRisk = recentOpponentTakes.length > 0 ? 0.15 : 0;
  return Math.max(0.2, Math.min(0.95, base + lateStockBonus - undercutRisk));
}

/** Pure casual strategy. It can only use the player-safe observation supplied by trusted server code. */
export function chooseBotIntent(observation: BotObservation, random: BotRandomSource): BotIntent {
  if (observation.phase === "HAND_COMPLETE") return { type: "START_NEXT_HAND" };
  if (observation.phase === "OPENING_NON_DEALER" || observation.phase === "OPENING_DEALER") {
    return shouldTakeDiscard(observation, random) ? { type: "TAKE_INITIAL_UPCARD" } : { type: "PASS_INITIAL_UPCARD" };
  }
  if (observation.phase === "AWAITING_DRAW") {
    if (observation.drawRestriction === "STOCK_ONLY_AFTER_OPENING_PASSES") return { type: "DRAW_STOCK" };
    return shouldTakeDiscard(observation, random) ? { type: "DRAW_DISCARD" } : { type: "DRAW_STOCK" };
  }

  const choice = choosePlausible(
    rankedDiscards(observation.hand, observation.forbiddenDiscardId, observation.recentOpponentTakes),
    random,
  );
  if (choice.deadwood === 0) return { type: "GIN", cardId: choice.card.id };
  if (choice.deadwood <= observation.rules.knockThreshold
    && random.nextFloat() < knockChance(choice.deadwood, observation.stockCount, observation.recentOpponentTakes)) {
    return { type: "KNOCK", cardId: choice.card.id };
  }
  return { type: "DISCARD", cardId: choice.card.id };
}
