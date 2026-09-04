"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { PublicCard, PublicMeld } from "@/src/shared/game-view";
import { CardFace, cardLabel } from "./game-card";

const DRAG_THRESHOLD = 7;

export type DisplayMeldGroup = {
  readonly key: string;
  readonly kind: PublicMeld["kind"];
  readonly start: number;
  readonly end: number;
  readonly cardIds: readonly string[];
  readonly lane: number;
};

export function reconcileKnownOrder(knownOrder: readonly string[], cards: readonly PublicCard[]): string[] {
  const unique = [...new Set(knownOrder.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const seen = new Set(unique);
  for (const card of cards) if (!seen.has(card.id)) { unique.push(card.id); seen.add(card.id); }
  return unique;
}

export function orderVisibleCards(cards: readonly PublicCard[], knownOrder: readonly string[]): PublicCard[] {
  const position = new Map(reconcileKnownOrder(knownOrder, cards).map((id, index) => [id, index]));
  return [...cards].sort((left, right) => position.get(left.id)! - position.get(right.id)!);
}

export function moveVisibleCard(
  knownOrder: readonly string[],
  visibleCards: readonly PublicCard[],
  cardId: string,
  targetIndex: number,
): string[] {
  const base = reconcileKnownOrder(knownOrder, visibleCards);
  const visibleIds = visibleCards.map((card) => card.id);
  const from = visibleIds.indexOf(cardId);
  if (from < 0) return base;
  const boundedTarget = Math.max(0, Math.min(targetIndex, visibleIds.length - 1));
  if (from === boundedTarget) return base;
  const nextVisible = [...visibleIds];
  nextVisible.splice(from, 1);
  nextVisible.splice(boundedTarget, 0, cardId);
  const visibleSet = new Set(visibleIds);
  const slots = base.flatMap((id, index) => visibleSet.has(id) ? [index] : []);
  const next = [...base];
  slots.forEach((slot, index) => { next[slot] = nextVisible[index]!; });
  return next;
}

function isSubset(left: readonly string[], right: readonly string[]): boolean {
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

export function contiguousMeldGroups(cards: readonly PublicCard[], candidates: readonly PublicMeld[]): DisplayMeldGroup[] {
  const positions = new Map(cards.map((card, index) => [card.id, index]));
  const contiguous = candidates.flatMap((candidate) => {
    const indices = candidate.cards.map((card) => positions.get(card.id));
    if (indices.some((index) => index === undefined)) return [];
    const sorted = [...indices as number[]].sort((a, b) => a - b);
    const start = sorted[0]!;
    const end = sorted.at(-1)!;
    if (end - start + 1 !== candidate.cards.length) return [];
    return [{
      key: `${candidate.kind}:${candidate.cards.map((card) => card.id).sort().join("|")}`,
      kind: candidate.kind,
      start,
      end,
      cardIds: candidate.cards.map((card) => card.id),
      lane: 0,
    }];
  });
  const maximal = contiguous.filter((candidate) => !contiguous.some((other) => (
    other.kind === candidate.kind
    && other.cardIds.length > candidate.cardIds.length
    && isSubset(candidate.cardIds, other.cardIds)
  )));
  const sorted = [...new Map(maximal.map((group) => [group.key, group])).values()]
    .sort((left, right) => left.start - right.start || right.end - left.end || left.kind.localeCompare(right.kind));
  const laneEnds: number[] = [];
  return sorted.map((group) => {
    let lane = laneEnds.findIndex((end) => end < group.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(group.end); }
    else laneEnds[lane] = group.end;
    return { ...group, lane };
  });
}

type CardHandProps = {
  readonly cards: readonly PublicCard[];
  readonly meldCandidates: readonly PublicMeld[];
  readonly selectedCardId?: string;
  readonly canDiscard: boolean;
  readonly canReorder: boolean;
  readonly restrictedId?: string;
  readonly drawnId?: string;
  readonly onSelect: (cardId: string | undefined) => void;
  readonly onMove: (cardId: string, targetIndex: number) => void;
};

type DragState = {
  pointerId: number;
  cardId: string;
  startX: number;
  startY: number;
  currentIndex: number;
  dragged: boolean;
};

export function CardHand({
  cards,
  meldCandidates,
  selectedCardId,
  canDiscard,
  canReorder,
  restrictedId,
  drawnId,
  onSelect,
  onMove,
}: CardHandProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | undefined>(undefined);
  const suppressClick = useRef<string | undefined>(undefined);
  const [draggedCardId, setDraggedCardId] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const groups = useMemo(() => contiguousMeldGroups(cards, meldCandidates), [cards, meldCandidates]);
  const membership = useMemo(() => {
    const map = new Map<string, PublicMeld["kind"][]>();
    for (const group of groups) for (const id of group.cardIds) {
      const kinds = map.get(id) ?? [];
      if (!kinds.includes(group.kind)) kinds.push(group.kind);
      map.set(id, kinds);
    }
    return map;
  }, [groups]);

  useLayoutEffect(() => {
    const hand = root.current;
    if (!hand) return;
    let animationFrame = 0;

    const measureGroups = () => {
      const handBounds = hand.getBoundingClientRect();
      const slots = Array.from(hand.querySelectorAll<HTMLElement>("[data-hand-slot]"));
      groups.forEach((group, groupIndex) => {
        const outline = hand.querySelector<HTMLElement>(`[data-meld-outline="${groupIndex}"]`);
        const memberBounds = slots
          .slice(group.start, group.end + 1)
          .map((slot) => slot.getBoundingClientRect());
        if (!outline || memberBounds.length === 0) return;
        const left = Math.min(...memberBounds.map((bounds) => bounds.left)) - handBounds.left;
        const top = Math.min(...memberBounds.map((bounds) => bounds.top)) - handBounds.top;
        const right = Math.max(...memberBounds.map((bounds) => bounds.right)) - handBounds.left;
        const bottom = Math.max(...memberBounds.map((bounds) => bounds.bottom)) - handBounds.top;
        outline.style.left = `${left - 3}px`;
        outline.style.top = `${top - 3}px`;
        outline.style.width = `${right - left + 6}px`;
        outline.style.height = `${bottom - top + 6}px`;
      });
    };

    measureGroups();
    animationFrame = window.requestAnimationFrame(measureGroups);
    window.addEventListener("resize", measureGroups);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measureGroups);
    observer?.observe(hand);
    hand.querySelectorAll<HTMLElement>("[data-hand-slot]").forEach((slot) => observer?.observe(slot));
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", measureGroups);
      observer?.disconnect();
    };
  }, [cards, groups]);

  function announceMove(card: PublicCard, index: number) {
    setAnnouncement(`${cardLabel(card)} moved to position ${index + 1} of ${cards.length}.`);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, card: PublicCard, index: number) {
    if (event.key === "Escape" && card.id === selectedCardId) {
      event.preventDefault();
      onSelect(undefined);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= cards.length) return;
    if (event.shiftKey && canReorder) {
      onMove(card.id, targetIndex);
      announceMove(card, targetIndex);
      return;
    }
    root.current?.querySelectorAll<HTMLButtonElement>("[data-hand-card]")[targetIndex]?.focus();
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, card: PublicCard, index: number) {
    if (!canReorder || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, cardId: card.id, startX: event.clientX, startY: event.clientY, currentIndex: index, dragged: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (!active.dragged && distance < DRAG_THRESHOLD) return;
    active.dragged = true;
    setDraggedCardId(active.cardId);
    const slots = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-hand-slot]") ?? []);
    if (!slots.length) return;
    const targetIndex = slots.reduce((best, slot, index) => {
      const rect = slot.getBoundingClientRect();
      const distanceToCenter = Math.abs(event.clientX - (rect.left + rect.right) / 2);
      return distanceToCenter < best.distance ? { index, distance: distanceToCenter } : best;
    }, { index: active.currentIndex, distance: Number.POSITIVE_INFINITY }).index;
    if (targetIndex !== active.currentIndex) {
      active.currentIndex = targetIndex;
      onMove(active.cardId, targetIndex);
    }
  }

  function finishPointer(event: PointerEvent<HTMLButtonElement>, card: PublicCard) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.dragged) {
      suppressClick.current = active.cardId;
      announceMove(card, active.currentIndex);
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    drag.current = undefined;
    setDraggedCardId(undefined);
  }

  return <div
    ref={root}
    className={`card-hand cards-${cards.length}`}
    style={{ "--hand-count": cards.length } as CSSProperties}
    aria-label="Your hand"
  >
    <span id="hand-keyboard-help" className="visually-hidden">Use the arrow keys to move between cards. During your turn, hold Shift with an arrow key to reorder. Escape clears a selected discard.</span>
    <span className="visually-hidden" aria-live="polite">{announcement}</span>
    <span className="meld-group-layer" aria-hidden="true">
      {groups.map((group, index) => <span
        data-meld-outline={index}
        className={`meld-group-outline meld-${group.kind.toLowerCase()}`}
        style={{ "--meld-label-lift": `${group.lane * 22}px` } as CSSProperties}
        key={group.key}
      >
        <span className="meld-group-label">{group.kind === "RUN" ? "Run" : "Set"}</span>
      </span>)}
    </span>
    {cards.map((card, index) => {
      const selected = card.id === selectedCardId;
      const marker = card.id === restrictedId ? "Hold" : card.id === drawnId ? "Drawn" : undefined;
      const kinds = membership.get(card.id) ?? [];
      const description = kinds.length ? `, part of ${kinds.map((kind) => kind.toLowerCase()).join(" and ")}` : "";
      return <span
        data-hand-slot
        data-card-id={card.id}
        className={`hand-card-slot${kinds.length ? " has-meld" : ""}${selected ? " is-selected" : ""}${draggedCardId === card.id ? " is-dragging" : ""}`}
        style={{ "--card-index": index } as CSSProperties}
        key={card.id}
      >
        <button
          data-hand-card
          data-card-id={card.id}
          className={`playing-card${selected ? " selected-card" : ""}${marker ? " turn-card-indicated" : ""}${kinds.length ? " meld-card" : ""}${draggedCardId === card.id ? " dragging-card" : ""}`}
          aria-label={`${cardLabel(card)}, position ${index + 1} of ${cards.length}${description}${marker ? `, ${marker.toLowerCase()}${marker === "Hold" ? ", cannot be discarded this turn" : ""}` : ""}`}
          aria-describedby="hand-keyboard-help"
          aria-pressed={canDiscard ? selected : undefined}
          disabled={!canDiscard && !canReorder}
          onKeyDown={(event) => keyDown(event, card, index)}
          onPointerDown={(event) => pointerDown(event, card, index)}
          onPointerMove={pointerMove}
          onPointerUp={(event) => finishPointer(event, card)}
          onPointerCancel={(event) => finishPointer(event, card)}
          onClick={(event) => {
            if (suppressClick.current === card.id) { suppressClick.current = undefined; event.preventDefault(); return; }
            if (canDiscard) onSelect(selected ? undefined : card.id);
          }}
        ><CardFace card={card} marker={marker} /></button>
      </span>;
    })}
  </div>;
}
