import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerGameView, PublicCard, RevealedPlayerHandView } from "@/src/shared/game-view";
import { actionMessage, GameResult, HandCompleteResult, newestGameView } from "./game-screen";

const card = (id: string, rank: string, suit: string): PublicCard => ({ id, rank, suit });
const runCards = [card("A:HEARTS", "A", "HEARTS"), card("2:HEARTS", "2", "HEARTS"), card("3:HEARTS", "3", "HEARTS")];
const deadwood = card("9:CLUBS", "9", "CLUBS");

const player = (playerId: string, displayName: string, finalDeadwoodValue: number): RevealedPlayerHandView => ({
  playerId,
  displayName,
  revealedHand: [...runCards, deadwood],
  melds: [{ kind: "RUN", cards: runCards }],
  originalDeadwoodCards: [deadwood],
  originalDeadwoodValue: 9,
  layoffs: finalDeadwoodValue === 0 ? [{ card: deadwood, resultingMeld: { kind: "SET", cards: [deadwood, card("9:DIAMONDS", "9", "DIAMONDS"), card("9:HEARTS", "9", "HEARTS")] } }] : [],
  finalDeadwoodCards: finalDeadwoodValue ? [deadwood] : [],
  finalDeadwoodValue,
});

function baseGame(): PlayerGameView {
  return {
    gameId: "game-1",
    version: 10,
    mode: "MULTIPLAYER",
    status: "HAND_COMPLETE",
    phase: "HAND_COMPLETE",
    rules: { knockThreshold: 10, ginBonus: 25, undercutBonus: 25, matchTarget: 100 },
    you: { seat: 0, displayName: "Will", score: 31, hand: [] },
    opponent: { seat: 1, displayName: "Kim", kind: "HUMAN", score: 18, cardCount: 10 },
    dealerId: "p2",
    stockCount: 20,
    discardPile: [],
    legalControls: ["START_NEXT_HAND"],
    botActionPending: false,
  };
}

afterEach(cleanup);

describe("game result surfaces", () => {
  it("shows the complete scored-hand breakdown and traps focus in the sheet", async () => {
    const game: PlayerGameView = {
      ...baseGame(),
      nextHandReadiness: { you: false, opponent: true },
      handResult: {
        kind: "SCORED",
        handNumber: 2,
        declaration: "KNOCK",
        declarerId: "p1",
        declarerName: "Will",
        winnerId: "p1",
        winnerName: "Will",
        scoringReason: "KNOCK",
        pointsAwarded: 9,
        players: [player("p1", "Will", 9), player("p2", "Kim", 0)],
        scoresAfter: [{ playerId: "p1", displayName: "Will", score: 31 }, { playerId: "p2", displayName: "Kim", score: 18 }],
      },
    };
    const onStart = vi.fn();
    render(<><button>Background action</button><HandCompleteResult game={game} onStartNextHand={onStart} canStartNextHand /></>);
    expect(screen.getAllByText("Original deadwood")).toHaveLength(2);
    expect(screen.getAllByText("Final deadwood")).toHaveLength(2);
    expect(screen.getByText("Layoffs")).toBeInTheDocument();
    expect(screen.getByText("Kim ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ready for next hand" })).toBeEnabled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Hand over" })));
    expect(screen.getByText("Background action")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a typed match winner and completed-hand history", () => {
    const game: PlayerGameView = {
      ...baseGame(),
      status: "COMPLETE",
      phase: "GAME_COMPLETE",
      legalControls: [],
      gameResult: {
        winnerId: "p1",
        winnerName: "Will",
        finalScores: [{ playerId: "p1", displayName: "Will", score: 105 }, { playerId: "p2", displayName: "Kim", score: 81 }],
        matchTarget: 100,
        completedHands: [
          { kind: "SCORED", handNumber: 1, declaration: "GIN", winnerId: "p1", winnerName: "Will", scoringReason: "GIN", pointsAwarded: 34 },
          { kind: "CANCELLED", handNumber: 2, pointsAwarded: 0 },
        ],
      },
    };
    render(<GameResult game={game} busy={false} onRematch={vi.fn()} />);
    expect(screen.getByText("Will", { selector: ".match-winner strong" })).toBeInTheDocument();
    expect(screen.getByText("Will +34")).toBeInTheDocument();
    expect(screen.getByText("Stock exhausted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request rematch" })).toBeEnabled();
  });

  it("offers an immediate replay against Nia instead of multiplayer negotiation", () => {
    const onRematch = vi.fn();
    const game: PlayerGameView = {
      ...baseGame(),
      mode: "SINGLE_PLAYER",
      status: "COMPLETE",
      phase: "GAME_COMPLETE",
      opponent: { seat: 1, displayName: "Nia", kind: "BOT", score: 18, cardCount: 10 },
      legalControls: [],
      gameResult: {
        winnerId: "p1",
        winnerName: "Will",
        finalScores: [{ playerId: "p1", displayName: "Will", score: 100 }, { playerId: "p2", displayName: "Nia", score: 18 }],
        matchTarget: 100,
        completedHands: [],
      },
    };
    render(<GameResult game={game} busy={false} onRematch={onRematch} />);
    screen.getByRole("button", { name: "Play Nia again" }).click();
    expect(onRematch).toHaveBeenCalledWith("PLAY_AGAIN");
    expect(screen.queryByRole("button", { name: "Request rematch" })).not.toBeInTheDocument();
  });
});

describe("game action feedback", () => {
  it("never replaces a newer game view with an older action or polling response", () => {
    const current = { ...baseGame(), status: "PLAYING" as const, phase: "AWAITING_DISCARD", version: 7 };
    const stale = { ...current, phase: "OPENING_DEALER", version: 6 };
    const next = { ...current, phase: "AWAITING_DRAW", version: 8 };
    expect(newestGameView(current, stale)).toBe(current);
    expect(newestGameView(current, next)).toBe(next);
    expect(newestGameView(current, { ...stale, gameId: "game-2" })).toMatchObject({ gameId: "game-2" });
  });

  it("explains an illegal initial-up-card rediscard without masking it as a generic failure", () => {
    expect(actionMessage(new Error("ILLEGAL_REDISCARD"))).toBe("You can’t discard the face-up card you just picked up. Choose another card.");
    expect(actionMessage(new Error("CARD_NOT_IN_HAND"))).toBe("That card is no longer in your hand. The latest game has been loaded.");
    expect(actionMessage(new Error("ACTION_NOT_ALLOWED_IN_PHASE"))).toBe("That move is no longer available. The latest game has been loaded.");
  });
});
