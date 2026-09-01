import { isCanonicalCard, sortCards, standardDeck } from "./cards";
import type { Card, DealPlan, GameErrorCode, PlayerId, PlayerState } from "./types";

export interface DealValidation { readonly ok: true };
export interface DealValidationError { readonly ok: false; readonly code: Extract<GameErrorCode, "INVALID_DEAL_PLAN" | "DUPLICATE_CARD" | "MALFORMED_CARD"> }

export function validateDealPlan(plan: DealPlan | undefined): DealValidation | DealValidationError {
  if (!plan || !Array.isArray(plan.deck) || plan.deck.length !== 52) return { ok: false, code: "INVALID_DEAL_PLAN" };
  if (plan.deck.some((card) => !isCanonicalCard(card))) return { ok: false, code: "MALFORMED_CARD" };
  const identities = plan.deck.map((card) => `${card.rank}:${card.suit}`);
  if (new globalThis.Set(identities).size !== 52) return { ok: false, code: "DUPLICATE_CARD" };
  const expected = new globalThis.Set(standardDeck().map((card) => card.id));
  if (identities.some((identity) => !expected.has(identity as Card["id"]))) return { ok: false, code: "INVALID_DEAL_PLAN" };
  return { ok: true };
}

export interface DealtHand {
  readonly players: readonly [PlayerState, PlayerState];
  readonly stock: readonly Card[];
  readonly discardPile: readonly [Card];
  readonly initialUpcard: Card;
}

export function dealHand(
  plan: DealPlan,
  players: readonly [PlayerState, PlayerState],
  dealerId: PlayerId,
): DealtHand {
  const nonDealerId = players.find((player) => player.id !== dealerId)!.id;
  const hands = new Map<PlayerId, Card[]>(players.map((player) => [player.id, []]));
  for (let round = 0; round < 10; round += 1) {
    hands.get(nonDealerId)!.push(plan.deck[round * 2]!);
    hands.get(dealerId)!.push(plan.deck[round * 2 + 1]!);
  }
  const nextPlayers = players.map((player) => ({ ...player, hand: sortCards(hands.get(player.id)!) })) as unknown as readonly [PlayerState, PlayerState];
  return { players: nextPlayers, stock: plan.deck.slice(21), discardPile: [plan.deck[20]!], initialUpcard: plan.deck[20]! };
}
