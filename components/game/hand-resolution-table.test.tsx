import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicCard, RevealedPlayerHandView, ScoredHandResultView } from "@/src/shared/game-view";
import { HandResolutionTable, HAND_RESOLUTION_TIMINGS, handResolutionStorageKey } from "./hand-resolution-table";

const rules = { knockThreshold: 10, ginBonus: 25, undercutBonus: 25, matchTarget: 100 } as const;
const card = (rank: string, suit: string): PublicCard => ({ id: `${rank}:${suit}`, rank, suit });
const run = [card("7", "HEARTS"), card("8", "HEARTS"), card("9", "HEARTS")];
const ownDeadwood = card("5", "CLUBS");
const six = card("6", "HEARTS");
const ten = card("10", "HEARTS");

function declarer(deadwoodValue = 5): RevealedPlayerHandView {
  return {
    playerId: "p1", displayName: "Ada", seat: 0, revealedHand: [...run, ownDeadwood],
    melds: [{ kind: "RUN", cards: run }], originalDeadwoodCards: [ownDeadwood], originalDeadwoodValue: deadwoodValue,
    layoffs: [], finalDeadwoodCards: [ownDeadwood], finalDeadwoodValue: deadwoodValue,
  };
}

function defender(layoffCount: 0 | 1 | 2, finalDeadwoodValue: number): RevealedPlayerHandView {
  const ownRun = [card("2", "SPADES"), card("3", "SPADES"), card("4", "SPADES")];
  const layoffs = [
    { card: six, targetMeldIndex: 0, remainingDeadwoodValue: 10, resultingMeld: { kind: "RUN" as const, cards: [six, ...run] } },
    { card: ten, targetMeldIndex: 0, remainingDeadwoodValue: 0, resultingMeld: { kind: "RUN" as const, cards: [six, ...run, ten] } },
  ].slice(0, layoffCount);
  return {
    playerId: "p2", displayName: "Bea", seat: 1, revealedHand: [...ownRun, six, ten],
    melds: [{ kind: "RUN", cards: ownRun }], originalDeadwoodCards: [six, ten], originalDeadwoodValue: 16,
    layoffs, finalDeadwoodCards: layoffCount === 2 ? [] : layoffCount === 1 ? [ten] : [six, ten], finalDeadwoodValue,
  };
}

function result(overrides: Partial<ScoredHandResultView> = {}, opponent = defender(0, 16)): ScoredHandResultView {
  return {
    kind: "SCORED", handNumber: 4, declaration: "KNOCK", declarerId: "p1", declarerName: "Ada",
    winnerId: "p1", winnerName: "Ada", scoringReason: "KNOCK", pointsAwarded: 11,
    players: [declarer(), opponent],
    scoresAfter: [{ playerId: "p1", displayName: "Ada", score: 40 }, { playerId: "p2", displayName: "Bea", score: 12 }],
    ...overrides,
  };
}

function renderResolution(hand = result()) {
  return render(<HandResolutionTable gameId="game-a" result={hand} viewerSeat={0} rules={rules} finalDiscard={card("Q", "DIAMONDS")} />);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("animated hand resolution", () => {
  it("reveals, applies deterministic chained layoffs one at a time, and explains a zero-deadwood undercut", () => {
    vi.useFakeTimers();
    const hand = result({ winnerId: "p2", winnerName: "Bea", scoringReason: "UNDERCUT", pointsAwarded: 30 }, defender(2, 0));
    const { container } = renderResolution(hand);

    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "declaration");
    expect(screen.getByText("Ada knocked with 5 deadwood.")).toBeInTheDocument();
    expect(screen.getByText("Final discard")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.declaration));
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "reveal");
    expect(screen.getAllByRole("img", { name: "6 of hearts" }).length).toBeGreaterThan(0);

    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.reveal));
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "layoffs");

    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.layoff));
    expect(screen.getByText("6 of hearts laid off. 10 deadwood remaining.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deadwood 10" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.layoff));
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole("heading", { name: "Undercut" })).toBeInTheDocument();
    expect(screen.getByText("5 − 0 + 25 = 30")).toBeInTheDocument();
    expect(screen.getByText("0 deadwood after layoffs. This is an undercut—not gin.")).toBeInTheDocument();
  });

  it("handles equal-deadwood undercuts and ordinary knock wins", () => {
    const equal = result({ winnerId: "p2", winnerName: "Bea", scoringReason: "UNDERCUT", pointsAwarded: 25 }, {
      ...defender(1, 5), layoffs: [{ ...defender(1, 5).layoffs[0]!, remainingDeadwoodValue: 5 }],
    });
    const { rerender } = renderResolution(equal);
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(screen.getByRole("heading", { name: "Undercut" })).toBeInTheDocument();
    expect(screen.getByText("5 − 5 + 25 = 25")).toBeInTheDocument();

    const knock = result();
    rerender(<HandResolutionTable gameId="game-b" result={knock} viewerSeat={0} rules={rules} />);
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(screen.getByRole("heading", { name: "Knock wins" })).toBeInTheDocument();
    expect(screen.getByText("16 − 5 = 11")).toBeInTheDocument();
  });

  it("briefly announces that an ordinary knock has no layoffs", () => {
    vi.useFakeTimers();
    const { container } = renderResolution();
    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.declaration));
    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.reveal));
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "layoffs");
    expect(screen.getByText("No layoffs available.")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.noLayoff));
    expect(screen.getByRole("heading", { name: "Knock wins" })).toBeInTheDocument();
  });

  it("goes from reveal to gin without layoffs and explains the gin rule", () => {
    vi.useFakeTimers();
    const gin = result({ declaration: "GIN", scoringReason: "GIN", pointsAwarded: 41 }, defender(0, 16));
    renderResolution(gin);
    expect(screen.getByText("Ada went gin.")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.declaration));
    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.reveal));
    expect(screen.getByRole("heading", { name: "Gin" })).toBeInTheDocument();
    expect(screen.getByText("16 + 25 = 41")).toBeInTheDocument();
    expect(screen.getByText("Layoffs are not allowed against gin.")).toBeInTheDocument();
  });

  it("supports skip, replay, remembered outcomes, and polling updates without restarting", () => {
    vi.useFakeTimers();
    const hand = result({}, defender(1, 10));
    const { container, rerender, unmount } = renderResolution(hand);
    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.declaration));
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "reveal");

    rerender(<HandResolutionTable gameId="game-a" result={{ ...hand, players: [...hand.players] as [RevealedPlayerHandView, RevealedPlayerHandView] }} viewerSeat={0} rules={rules} />);
    act(() => vi.advanceTimersByTime(HAND_RESOLUTION_TIMINGS.reveal - 300));
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "layoffs");

    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(localStorage.getItem(handResolutionStorageKey("game-a", 4))).toBe("skipped");
    expect(screen.getByRole("button", { name: "Replay layoffs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replay layoffs" }));
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "reveal");

    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    unmount();
    renderResolution(hand);
    expect(screen.getByRole("heading", { name: "Knock wins" })).toBeInTheDocument();
  });

  it("skips animation under reduced motion", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const { container } = renderResolution(result({}, defender(1, 10)));
    expect(container.querySelector("[data-resolution-stage]" )).toHaveAttribute("data-resolution-stage", "outcome");
    expect(screen.getByRole("button", { name: "Replay layoffs" })).toBeInTheDocument();
  });
});
