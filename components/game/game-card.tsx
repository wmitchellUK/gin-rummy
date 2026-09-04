"use client";

import type { CSSProperties, SyntheticEvent } from "react";
import type { FaceCardRank, FaceCardSlot, FaceCardSuit } from "@/src/shared/card-art";
import type { PublicCard } from "@/src/shared/game-view";
import { useCardArt } from "./card-art-provider";

const SUIT_SYMBOLS: Record<string, string> = {
  CLUBS: "♣",
  DIAMONDS: "♦",
  HEARTS: "♥",
  SPADES: "♠",
};

const PIP_LAYOUTS: Record<string, readonly [x: number, y: number, inverted?: boolean][]> = {
  A: [[50, 50]],
  "2": [[50, 12], [50, 88, true]],
  "3": [[50, 10], [50, 50], [50, 90, true]],
  "4": [[24, 12], [76, 12], [24, 88, true], [76, 88, true]],
  "5": [[24, 10], [76, 10], [50, 50], [24, 90, true], [76, 90, true]],
  "6": [[24, 8], [76, 8], [24, 50], [76, 50], [24, 92, true], [76, 92, true]],
  "7": [[24, 7], [76, 7], [50, 31], [24, 50], [76, 50], [24, 93, true], [76, 93, true]],
  "8": [[24, 6], [76, 6], [50, 29], [24, 50], [76, 50], [50, 71, true], [24, 94, true], [76, 94, true]],
  "9": [[24, 5], [76, 5], [24, 34], [76, 34], [50, 50], [24, 66, true], [76, 66, true], [24, 95, true], [76, 95, true]],
  "10": [[24, 4], [76, 4], [50, 22], [24, 35], [76, 35], [24, 65, true], [76, 65, true], [50, 78, true], [24, 96, true], [76, 96, true]],
};

function isFaceCardRank(rank: string): rank is FaceCardRank {
  return rank === "J" || rank === "Q" || rank === "K";
}

function isFaceCardSuit(suit: string): suit is FaceCardSuit {
  return suit === "CLUBS" || suit === "DIAMONDS" || suit === "HEARTS" || suit === "SPADES";
}

function portraitSlot(card: PublicCard): FaceCardSlot | undefined {
  return isFaceCardRank(card.rank) && isFaceCardSuit(card.suit)
    ? `${card.rank}:${card.suit}`
    : undefined;
}

export function revisionedCardArtUrl(url: string, revision: number): string {
  const hashStart = url.indexOf("#");
  const hash = hashStart >= 0 ? url.slice(hashStart) : "";
  const withoutHash = hashStart >= 0 ? url.slice(0, hashStart) : url;
  const revisionPattern = /([?&])v=[^&]*/;
  if (revisionPattern.test(withoutHash)) {
    return `${withoutHash.replace(revisionPattern, `$1v=${revision}`)}${hash}`;
  }
  return `${withoutHash}${withoutHash.includes("?") ? "&" : "?"}v=${revision}${hash}`;
}

export function suitColorClass(card: Pick<PublicCard, "suit">): "red-suit" | "black-suit" {
  return card.suit === "HEARTS" || card.suit === "DIAMONDS" ? "red-suit" : "black-suit";
}

export function cardLabel(card: Pick<PublicCard, "rank" | "suit">): string {
  return `${card.rank} of ${card.suit.toLowerCase()}`;
}

export function CardMark({ card }: { card: PublicCard }) {
  return <span className={`card-mark ${suitColorClass(card)}`} aria-hidden="true"><span>{card.rank}</span><span className="suit-icon">{SUIT_SYMBOLS[card.suit]}</span></span>;
}

function hideBrokenPortrait(event: SyntheticEvent<HTMLImageElement>) {
  const portrait = event.currentTarget.parentElement;
  portrait?.setAttribute("hidden", "");
  portrait?.previousElementSibling?.removeAttribute("hidden");
}

function CourtCardFrame() {
  return <svg
    className="court-card-frame"
    viewBox="0 0 100 150"
    preserveAspectRatio="none"
    focusable="false"
    aria-hidden="true"
  >
    <path
      className="court-card-frame-line court-card-frame-outer"
      d="M50 3C55 10 62 12 72 12C88 20 95 42 95 75C95 108 88 130 72 138C62 138 55 140 50 147C45 140 38 138 28 138C12 130 5 108 5 75C5 42 12 20 28 12C38 12 45 10 50 3Z"
    />
    <path
      className="court-card-frame-line court-card-frame-inner"
      d="M50 8C55 14 61 16 70 16C84 23 91 44 91 75C91 106 84 127 70 134C61 134 55 136 50 142C45 136 39 134 30 134C16 127 9 106 9 75C9 44 16 23 30 16C39 16 45 14 50 8Z"
    />
    <path className="court-card-frame-gem" d="M50 2L55 10L50 18L45 10Z" />
    <path className="court-card-frame-gem" d="M50 132L55 140L50 148L45 140Z" />
    <path className="court-card-frame-gem court-card-frame-side-gem" d="M4 69L9 75L4 81L0 75Z" />
    <path className="court-card-frame-gem court-card-frame-side-gem" d="M96 69L100 75L96 81L91 75Z" />
  </svg>;
}

export function CardFace({ card, marker }: { card: PublicCard; marker?: "Hold" | "Drawn" }) {
  const { manifest, revision } = useCardArt();
  const pips = PIP_LAYOUTS[card.rank];
  const slot = portraitSlot(card);
  const portraitUrl = slot && manifest[slot]
    ? revisionedCardArtUrl(manifest[slot], revision)
    : undefined;

  return <span className={`card-face ${suitColorClass(card)}`} aria-hidden="true">
    <CardMark card={card} />
    {marker && <span className="turn-card-badge">{marker}</span>}
    {pips ? <span className={`card-pips pip-count-${pips.length}`}>{pips.map(([x, y, inverted], index) => <span className={inverted ? "pip-inverted" : undefined} style={{ "--pip-x": `${x}%`, "--pip-y": `${y}%` } as CSSProperties} key={index}>{SUIT_SYMBOLS[card.suit]}</span>)}</span> : <>
      <span className="court-card" hidden={Boolean(portraitUrl)}><b>{card.rank}</b><span>{SUIT_SYMBOLS[card.suit]}</span></span>
      {portraitUrl && <span className="court-card-art">
        {/* Dynamic public Storage URLs cannot be declared in Next image remotePatterns. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={portraitUrl} src={portraitUrl} alt="" decoding="async" onError={hideBrokenPortrait} />
        <CourtCardFrame />
      </span>}
    </>}
    <span className="card-mark card-mark-inverted"><span>{card.rank}</span><span className="suit-icon">{SUIT_SYMBOLS[card.suit]}</span></span>
  </span>;
}
