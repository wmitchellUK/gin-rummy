import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_RULES, type Card, type PlayerId } from "@/src/game";
import { hand } from "@/src/game/test/card-fixtures";
import { chooseBotIntent } from "./strategy";
import type { BotObservation } from "./types";

const botPlayerId = "22222222-2222-4222-8222-222222222222" as PlayerId;
const random = (value: number) => ({ nextFloat: () => value });
const base = (cards: readonly Card[], extra: Partial<BotObservation> = {}): BotObservation => ({
  botPlayerId,
  phase: "AWAITING_DISCARD",
  hand: cards,
  rules: DEFAULT_GAME_RULES,
  stockCount: 20,
  publicKnownCards: [],
  recentOpponentTakes: [],
  ...extra,
});

describe("Nia casual strategy", () => {
  it("always declares gin when its chosen discard leaves no deadwood", () => {
    const cards = hand("A♥ 2♥ 3♥ 4♥ 5♥ 6♥ 7♥ 8♥ 9♥ 10♥ K♣");
    expect(chooseBotIntent(base(cards), random(0))).toEqual({ type: "GIN", cardId: "K:CLUBS" });
  });

  it("never rediscard the face-up card it just took", () => {
    const cards = hand("A♥ 2♥ 4♥ 6♣ 7♣ 9♦ 10♦ J♠ Q♠ K♣ K♦");
    const result = chooseBotIntent(base(cards, { forbiddenDiscardId: "K:DIAMONDS" }), random(0));
    expect(result.type).toMatch(/DISCARD|KNOCK|GIN/);
    if ("cardId" in result) expect(result.cardId).not.toBe("K:DIAMONDS");
  });

  it("takes an up-card that completes a strong meld", () => {
    const cards = hand("A♥ 2♥ 6♣ 7♣ 9♦ 10♦ J♠ Q♠ K♣ K♦");
    const topDiscard = hand("3♥")[0]!;
    const result = chooseBotIntent(base(cards, {
      phase: "OPENING_NON_DEALER",
      topDiscard,
      publicKnownCards: [topDiscard],
    }), random(0));
    expect(result).toEqual({ type: "TAKE_INITIAL_UPCARD" });
  });

  it("draws stock after both opening passes regardless of hand quality", () => {
    expect(chooseBotIntent(base(hand("A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠"), {
      phase: "AWAITING_DRAW",
      drawRestriction: "STOCK_ONLY_AFTER_OPENING_PASSES",
    }), random(0))).toEqual({ type: "DRAW_STOCK" });
  });

  it("uses injected variation among plausible discards", () => {
    const cards = hand("A♥ 2♥ 4♥ 6♣ 7♣ 9♦ 10♦ J♠ Q♠ K♣ K♦");
    const best = chooseBotIntent(base(cards), random(0));
    const imperfect = chooseBotIntent(base(cards), random(0.99));
    expect(best).not.toEqual(imperfect);
  });
});
