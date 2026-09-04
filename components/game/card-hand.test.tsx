import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicCard, PublicMeld } from "@/src/shared/game-view";
import {
  CardHand,
  contiguousMeldGroups,
  moveVisibleCard,
  orderVisibleCards,
  reconcileKnownOrder,
} from "./card-hand";

const cards: PublicCard[] = [
  { id: "6:DIAMONDS", rank: "6", suit: "DIAMONDS" },
  { id: "7:DIAMONDS", rank: "7", suit: "DIAMONDS" },
  { id: "8:DIAMONDS", rank: "8", suit: "DIAMONDS" },
  { id: "8:CLUBS", rank: "8", suit: "CLUBS" },
  { id: "8:HEARTS", rank: "8", suit: "HEARTS" },
  { id: "9:DIAMONDS", rank: "9", suit: "DIAMONDS" },
];

const meld = (kind: PublicMeld["kind"], values: readonly PublicCard[]): PublicMeld => ({ kind, cards: values });

afterEach(cleanup);

describe("saved hand order", () => {
  it("deduplicates stored IDs, appends unseen cards, and reuses known positions", () => {
    expect(reconcileKnownOrder([cards[2]!.id, cards[0]!.id, cards[2]!.id], cards.slice(0, 4))).toEqual([
      cards[2]!.id, cards[0]!.id, cards[1]!.id, cards[3]!.id,
    ]);
    expect(orderVisibleCards([cards[0]!, cards[2]!, cards[3]!], [cards[3]!.id, cards[0]!.id, cards[2]!.id]))
      .toEqual([cards[3], cards[0], cards[2]]);
  });

  it("moves visible cards without discarding remembered absent identities", () => {
    const absent = "K:SPADES";
    const known = [cards[0]!.id, absent, cards[1]!.id, cards[2]!.id];
    expect(moveVisibleCard(known, cards.slice(0, 3), cards[2]!.id, 0)).toEqual([
      cards[2]!.id, absent, cards[0]!.id, cards[1]!.id,
    ]);
  });
});

describe("contiguous meld feedback", () => {
  it("keeps the longest same-kind group instead of contained sub-runs", () => {
    const ordered = [cards[0]!, cards[1]!, cards[2]!, cards[5]!];
    const groups = contiguousMeldGroups(ordered, [
      meld("RUN", ordered.slice(0, 3)),
      meld("RUN", ordered.slice(1, 4)),
      meld("RUN", ordered),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "RUN", start: 0, end: 3 });
  });

  it("retains an overlapping run and set while rejecting separated candidates", () => {
    const ordered = cards.slice(0, 5);
    const groups = contiguousMeldGroups(ordered, [
      meld("RUN", ordered.slice(0, 3)),
      meld("SET", ordered.slice(2, 5)),
      meld("RUN", [ordered[0]!, ordered[1]!, cards[5]!]),
    ]);
    expect(groups.map((group) => ({ kind: group.kind, start: group.start, end: group.end, lane: group.lane }))).toEqual([
      { kind: "RUN", start: 0, end: 2, lane: 0 },
      { kind: "SET", start: 2, end: 4, lane: 1 },
    ]);
  });
});

describe("CardHand interactions", () => {
  function renderHand(options: { canDiscard?: boolean; canReorder?: boolean } = {}) {
    const onMove = vi.fn();
    const onSelect = vi.fn();
    const result = render(<CardHand
      cards={cards.slice(0, 3)}
      meldCandidates={[meld("RUN", cards.slice(0, 3))]}
      canDiscard={options.canDiscard ?? false}
      canReorder={options.canReorder ?? true}
      onMove={onMove}
      onSelect={onSelect}
    />);
    return { ...result, onMove, onSelect };
  }

  it("announces meld membership and supports Shift+Arrow reordering", async () => {
    const { container, onMove } = renderHand();
    const first = screen.getByRole("button", { name: /6 of diamonds, position 1 of 3, part of run/i });
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(container.querySelectorAll(".meld-group-outline.meld-run")).toHaveLength(1);
    first.focus();
    await userEvent.setup().keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(onMove).toHaveBeenCalledWith(cards[0]!.id, 1);
    expect(screen.getByText(/moved to position 2 of 3/i)).toBeInTheDocument();
  });

  it("draws one connected frame around the full meld span", () => {
    const { container } = renderHand();
    const hand = container.querySelector<HTMLElement>(".card-hand")!;
    const slots = Array.from(container.querySelectorAll<HTMLElement>("[data-hand-slot]"));
    vi.spyOn(hand, "getBoundingClientRect").mockReturnValue({
      left: 10, right: 210, top: 20, bottom: 150, width: 200, height: 130, x: 10, y: 20, toJSON: () => ({}),
    });
    slots.forEach((slot, index) => vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({
      left: 20 + index * 60, right: 70 + index * 60, top: 40, bottom: 140, width: 50, height: 100,
      x: 20 + index * 60, y: 40, toJSON: () => ({}),
    }));
    fireEvent(window, new Event("resize"));
    const outline = container.querySelector<HTMLElement>(".meld-group-outline")!;
    expect(outline.style.left).toBe("7px");
    expect(outline.style.top).toBe("17px");
    expect(outline.style.width).toBe("176px");
    expect(outline.style.height).toBe("106px");
  });

  it("keeps tap selection phase-gated", async () => {
    const inactive = renderHand({ canDiscard: false, canReorder: true });
    await userEvent.setup().click(screen.getByRole("button", { name: /6 of diamonds/i }));
    expect(inactive.onSelect).not.toHaveBeenCalled();
    inactive.unmount();
    const active = renderHand({ canDiscard: true, canReorder: true });
    await userEvent.setup().click(screen.getByRole("button", { name: /6 of diamonds/i }));
    expect(active.onSelect).toHaveBeenCalledWith(cards[0]!.id);
  });

  it("uses a drag threshold, reorders toward the nearest card, and suppresses the following click", () => {
    const { container, onMove, onSelect } = renderHand({ canDiscard: true, canReorder: true });
    const slots = Array.from(container.querySelectorAll<HTMLElement>("[data-hand-slot]"));
    slots.forEach((slot, index) => vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({
      left: index * 60, right: index * 60 + 60, top: 0, bottom: 90, width: 60, height: 90, x: index * 60, y: 0, toJSON: () => ({}),
    }));
    const first = screen.getByRole("button", { name: /6 of diamonds/i });
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 20 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      fireEvent(first, event);
    };
    pointer("pointerdown", 20);
    pointer("pointermove", 23);
    expect(onMove).not.toHaveBeenCalled();
    pointer("pointermove", 145);
    pointer("pointerup", 145);
    fireEvent.click(first);
    expect(onMove).toHaveBeenCalledWith(cards[0]!.id, 2);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
