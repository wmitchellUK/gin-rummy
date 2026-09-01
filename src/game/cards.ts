import type { Card, CardId, Rank, Suit } from "./types";

export const SUITS: readonly Suit[] = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES"];
export const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const rankNumber = (rank: Rank): number => RANKS.indexOf(rank) + 1;
export const suitNumber = (suit: Suit): number => SUITS.indexOf(suit);
export const cardId = (rank: Rank, suit: Suit): CardId => `${rank}:${suit}` as CardId;
export const createCard = (rank: Rank, suit: Suit): Card => ({ id: cardId(rank, suit), rank, suit });
export const cardValue = (card: Card): number => Math.min(rankNumber(card.rank), 10);

export function compareCards(a: Card, b: Card): number {
  return rankNumber(a.rank) - rankNumber(b.rank) || suitNumber(a.suit) - suitNumber(b.suit);
}

export function sortCards(cards: readonly Card[]): readonly Card[] {
  return [...cards].sort(compareCards);
}

export function standardDeck(): readonly Card[] {
  return RANKS.flatMap((rank) => SUITS.map((suit) => createCard(rank, suit)));
}

export function isCanonicalCard(card: unknown): card is Card {
  if (!card || typeof card !== "object") return false;
  const value = card as Partial<Card>;
  return typeof value.id === "string" && RANKS.includes(value.rank as Rank)
    && SUITS.includes(value.suit as Suit) && value.id === cardId(value.rank as Rank, value.suit as Suit);
}
