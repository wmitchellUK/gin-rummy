import { createCard, standardDeck } from "../cards";
import type { ActionId, Card, CardId, PlayerId, Rank, Suit } from "../types";

export const P1 = "player-1" as PlayerId;
export const P2 = "player-2" as PlayerId;
export const AID = "action-1" as ActionId;

const suitBySymbol: Record<string, Suit> = { "♣": "CLUBS", "♦": "DIAMONDS", "♥": "HEARTS", "♠": "SPADES", C: "CLUBS", D: "DIAMONDS", H: "HEARTS", S: "SPADES" };

export function c(notation: string): Card {
  const symbol = notation.at(-1)!;
  const suit = suitBySymbol[symbol];
  if (!suit) throw new Error(`Unknown suit in ${notation}`);
  return createCard(notation.slice(0, -1) as Rank, suit);
}

export const hand = (notation: string): readonly Card[] => notation.trim().split(/\s+/).filter(Boolean).map(c);
export const id = (notation: string): CardId => c(notation).id;

export function deckStartingWith(cards: readonly Card[]): readonly Card[] {
  const used = new Set(cards.map((card) => card.id));
  return [...cards, ...standardDeck().filter((card) => !used.has(card.id))];
}
