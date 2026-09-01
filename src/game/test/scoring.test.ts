import { describe, expect, it } from "vitest";
import { analyzeHand } from "../hand-analysis";
import { DEFAULT_GAME_RULES } from "../index";
import { scoreDeclaration } from "../scoring";
import type { PlayerState } from "../types";
import { c, hand, P1, P2 } from "./card-fixtures";

function players(first: string, second: string, firstScore = 0, secondScore = 0): readonly [PlayerState, PlayerState] {
  return [
    { id: P1, hand: hand(first), matchScore: firstScore },
    { id: P2, hand: hand(second), matchScore: secondScore },
  ];
}

describe("declaration scoring", () => {
  it("scores the worked ordinary knock as 8 points", () => {
    const dealt = players(
      "3♥ 4♥ 5♥ 7♣ 7♦ 7♠ A♠ 2♠ 3♠ 9♦",
      "10♣ 10♦ 10♥ 4♠ 5♠ 6♠ 8♣ 2♦ 3♣ 4♦",
    );
    const scored = scoreDeclaration({ handNumber: 1, dealerId: P1, declaration: "KNOCK", declarerId: P1, finalDiscard: c("K♥"), players: dealt, rules: DEFAULT_GAME_RULES });
    expect(scored.result.scoringReason).toBe("KNOCK");
    expect(scored.result.pointsAwarded).toBe(8);
    expect(scored.result.winnerId).toBe(P1);
    expect(scored.players[0].matchScore).toBe(8);
  });

  it("scores the chained-layoff knock regression as 2 points", () => {
    const dealt = players(
      "2♦ 3♥ 4♥ 5♥ 9♦ 9♥ 9♠ K♣ K♥ K♠",
      "A♥ A♠ 2♥ 3♣ 7♣ 7♥ 7♠ J♣ J♦ J♥",
      0, 46,
    );
    const scored = scoreDeclaration({ handNumber: 1, dealerId: P2, declaration: "KNOCK", declarerId: P1, finalDiscard: c("Q♦"), players: dealt, rules: DEFAULT_GAME_RULES });
    const knocker = scored.result.players.find((player) => player.playerId === P1)!;
    const opponent = scored.result.players.find((player) => player.playerId === P2)!;

    expect(knocker.originalDeadwoodValue).toBe(2);
    expect(opponent.originalDeadwoodValue).toBe(7);
    expect(opponent.layoffs.map((layoff) => layoff.card.id).sort()).toEqual(["2:HEARTS", "A:HEARTS"]);
    expect(opponent.finalDeadwoodCards.map((card) => card.id).sort()).toEqual(["3:CLUBS", "A:SPADES"]);
    expect(opponent.finalDeadwoodValue).toBe(4);
    expect(scored.result).toMatchObject({ declarerId: P1, winnerId: P1, scoringReason: "KNOCK", pointsAwarded: 2, scoresAfter: { [P1]: 2, [P2]: 46 } });
  });

  it("awards 28 for an 8-versus-5 undercut", () => {
    const dealt = players(
      "A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠",
      "A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 5♦",
    );
    const scored = scoreDeclaration({ handNumber: 1, dealerId: P2, declaration: "KNOCK", declarerId: P1, finalDiscard: c("K♣"), players: dealt, rules: DEFAULT_GAME_RULES });
    expect(scored.result.scoringReason).toBe("UNDERCUT");
    expect(scored.result.pointsAwarded).toBe(28);
    expect(scored.result.winnerId).toBe(P2);
  });

  it("treats equal deadwood as a 25-point undercut", () => {
    const dealt = players(
      "A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 9♦ 10♦ J♦ 8♠",
      "A♣ 2♣ 3♣ 7♥ 8♥ 9♥ Q♠ Q♥ Q♦ 8♣",
    );
    const scored = scoreDeclaration({ handNumber: 1, dealerId: P2, declaration: "KNOCK", declarerId: P1, finalDiscard: c("K♣"), players: dealt, rules: DEFAULT_GAME_RULES });
    expect(scored.result.scoringReason).toBe("UNDERCUT");
    expect(scored.result.pointsAwarded).toBe(25);
  });

  it("scores gin from the opponent's original deadwood and permits no layoffs", () => {
    const dealt = players(
      "A♥ 2♥ 3♥ 4♣ 5♣ 6♣ 10♦ J♦ Q♦ K♦",
      "4♥ 7♣ 7♦ 7♠ 8♣ 9♣ 10♣ 2♠ 5♠ K♠",
    );
    const opponentDeadwood = analyzeHand(dealt[1].hand).deadwoodValue;
    const scored = scoreDeclaration({ handNumber: 1, dealerId: P1, declaration: "GIN", declarerId: P1, finalDiscard: c("9♦"), players: dealt, rules: DEFAULT_GAME_RULES });
    expect(scored.result.pointsAwarded).toBe(opponentDeadwood + 25);
    expect(scored.result.players[1].layoffs).toEqual([]);
    expect(scored.result.players[1].finalDeadwoodValue).toBe(opponentDeadwood);
  });

  it("preserves player order and records before/after score maps", () => {
    const dealt = players(
      "3♥ 4♥ 5♥ 7♣ 7♦ 7♠ A♠ 2♠ 3♠ 9♦",
      "10♣ 10♦ 10♥ 4♠ 5♠ 6♠ 8♣ 2♦ 3♣ 4♦",
      11, 6,
    );
    const scored = scoreDeclaration({ handNumber: 4, dealerId: P2, declaration: "KNOCK", declarerId: P1, finalDiscard: c("K♥"), players: dealt, rules: DEFAULT_GAME_RULES });
    expect(scored.result.players.map((player) => player.playerId)).toEqual([P1, P2]);
    expect(scored.result.scoresBefore).toEqual({ [P1]: 11, [P2]: 6 });
    expect(scored.result.scoresAfter).toEqual({ [P1]: 19, [P2]: 6 });
  });
});
