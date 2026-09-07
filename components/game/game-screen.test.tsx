import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerGameView, PublicCard, RevealedPlayerHandView, ScoredHandResultView } from "@/src/shared/game-view";
import { actionMessage, GameResult, HandCompleteResult, newestGameView } from "./game-screen";

const card = (id: string, rank: string, suit: string): PublicCard => ({ id, rank, suit });
const runCards = [card("A:HEARTS", "A", "HEARTS"), card("2:HEARTS", "2", "HEARTS"), card("3:HEARTS", "3", "HEARTS")];
const deadwood = card("9:CLUBS", "9", "CLUBS");

const player = (playerId: string, displayName: string, finalDeadwoodValue: number, seat: 0 | 1 = playerId === "p1" ? 0 : 1): RevealedPlayerHandView => ({
  playerId,
  displayName,
  seat,
  revealedHand: [...runCards, deadwood],
  melds: [{ kind: "RUN", cards: runCards }],
  originalDeadwoodCards: [deadwood],
  originalDeadwoodValue: 9,
  layoffs: finalDeadwoodValue === 0 ? [{ card: deadwood, targetMeldIndex: 0, remainingDeadwoodValue: 0, resultingMeld: { kind: "SET", cards: [deadwood, card("9:DIAMONDS", "9", "DIAMONDS"), card("9:HEARTS", "9", "HEARTS")] } }] : [],
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

function finalHand(opponentName = "Kim", handNumber = 3): ScoredHandResultView {
  return {
    kind: "SCORED",
    handNumber,
    declaration: "KNOCK",
    declarerId: "p1",
    declarerName: "Will",
    winnerId: "p1",
    winnerName: "Will",
    scoringReason: "KNOCK",
    pointsAwarded: 9,
    players: [player("p1", "Will", 9), player("p2", opponentName, 18)],
    scoresAfter: [{ playerId: "p1", displayName: "Will", score: 105 }, { playerId: "p2", displayName: opponentName, score: 81 }],
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("game result surfaces", () => {
  it("shows the resolved tabletop, readiness, and traps focus in the sheet", async () => {
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
        players: [player("p1", "Will", 9), { ...player("p2", "Kim", 18), originalDeadwoodValue: 18 }],
        scoresAfter: [{ playerId: "p1", displayName: "Will", score: 31 }, { playerId: "p2", displayName: "Kim", score: 18 }],
      },
    };
    const onStart = vi.fn();
    render(<><button>Background action</button><HandCompleteResult game={game} onStartNextHand={onStart} canStartNextHand /></>);
    expect(screen.getByText("Will knocked with 9 deadwood.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(screen.getByRole("heading", { name: "Knock wins" })).toBeInTheDocument();
    expect(screen.getByText("18 − 9 = 9")).toBeInTheDocument();
    expect(screen.getByText("Kim ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ready for next hand" })).toBeEnabled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Hand 2 resolution" })));
    expect(screen.getByText("Background action")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the celebration, complete final hand, and completed-hand history together", () => {
    vi.useFakeTimers();
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
          { kind: "SCORED", handNumber: 3, declaration: "KNOCK", winnerId: "p1", winnerName: "Will", scoringReason: "KNOCK", pointsAwarded: 9 },
        ],
        finalHand: finalHand(),
      },
    };
    const { container } = render(<GameResult game={game} busy={false} onRematch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(screen.getByRole("heading", { name: "Knock wins" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByText("Will", { selector: ".match-winner strong" })).toBeInTheDocument();
    expect(screen.getByText("Will +34")).toBeInTheDocument();
    expect(screen.getByText("Stock exhausted")).toBeInTheDocument();
    expect(container.querySelector(".victory-crest")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Replay deciding hand" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Request rematch" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Replay deciding hand" }));
    expect(screen.getByRole("heading", { name: "Deciding hand" })).toBeInTheDocument();
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "declaration");
  });

  it("keeps gin and undercut score formulas in the shared final-hand breakdown", () => {
    const ginHand: ScoredHandResultView = { ...finalHand(), declaration: "GIN", scoringReason: "GIN", pointsAwarded: 34 };
    const gameFor = (hand: ScoredHandResultView): PlayerGameView => ({
      ...baseGame(),
      status: "COMPLETE",
      phase: "GAME_COMPLETE",
      legalControls: [],
      gameResult: {
        winnerId: hand.winnerId,
        winnerName: hand.winnerName,
        finalScores: hand.scoresAfter,
        matchTarget: 100,
        completedHands: [{
          kind: "SCORED",
          handNumber: hand.handNumber,
          declaration: hand.declaration,
          winnerId: hand.winnerId,
          winnerName: hand.winnerName,
          scoringReason: hand.scoringReason,
          pointsAwarded: hand.pointsAwarded,
        }],
        finalHand: hand,
      },
    });
    const { rerender } = render(<GameResult game={gameFor(ginHand)} busy={false} onRematch={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(screen.getByText("9 + 25 = 34")).toBeInTheDocument();
    expect(screen.getByText("Layoffs are not allowed against gin.")).toBeInTheDocument();

    const undercutHand: ScoredHandResultView = {
      ...finalHand(),
      winnerId: "p2",
      winnerName: "Kim",
      scoringReason: "UNDERCUT",
      pointsAwarded: 34,
      players: [player("p1", "Will", 9), player("p2", "Kim", 0)],
    };
    rerender(<GameResult game={gameFor(undercutHand)} busy={false} onRematch={vi.fn()} />);
    expect(screen.getByText("9 − 0 + 25 = 34")).toBeInTheDocument();
  });

  it("offers an immediate replay against Naia instead of multiplayer negotiation", () => {
    vi.useFakeTimers();
    const onRematch = vi.fn();
    const game: PlayerGameView = {
      ...baseGame(),
      mode: "SINGLE_PLAYER",
      status: "COMPLETE",
      phase: "GAME_COMPLETE",
      opponent: { seat: 1, displayName: "Naia", kind: "BOT", score: 18, cardCount: 10 },
      legalControls: [],
      gameResult: {
        winnerId: "p1",
        winnerName: "Will",
        finalScores: [{ playerId: "p1", displayName: "Will", score: 100 }, { playerId: "p2", displayName: "Naia", score: 18 }],
        matchTarget: 100,
        completedHands: [{ kind: "SCORED", handNumber: 1, declaration: "KNOCK", winnerId: "p1", winnerName: "Will", scoringReason: "KNOCK", pointsAwarded: 9 }],
        finalHand: finalHand("Naia", 1),
      },
    };
    render(<GameResult game={game} busy={false} onRematch={onRematch} />);
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    act(() => vi.advanceTimersByTime(900));
    screen.getByRole("button", { name: "Play Naia again" }).click();
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
