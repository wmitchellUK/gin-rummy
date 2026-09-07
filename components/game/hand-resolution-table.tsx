"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlayerGameView, PublicCard, PublicMeld, RevealedPlayerHandView, ScoredHandResultView } from "@/src/shared/game-view";
import { CardFace, cardLabel } from "./game-card";

const DECLARATION_MS = 900;
const REVEAL_MS = 700;
const LAYOFF_MS = 450;
const NO_LAYOFF_MS = 650;

type ResolutionStage = "declaration" | "reveal" | "layoffs" | "outcome";

export const handResolutionStorageKey = (gameId: string, handNumber: number) =>
  `gin-rummy:hand-resolution:v1:${gameId}:${handNumber}`;

function wasResolved(key: string) {
  try { return localStorage.getItem(key) !== null; } catch { return false; }
}

function rememberResolution(key: string, value: "completed" | "skipped") {
  try { localStorage.setItem(key, value); } catch { /* Resolution memory is a display preference. */ }
}

function reducedMotionIsPreferred() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function CardBack() {
  return <span className="card-back" aria-hidden="true"><span>R</span></span>;
}

function ResolutionCard({ card, concealed = false, highlighted = false, data }: {
  card: PublicCard;
  concealed?: boolean;
  highlighted?: boolean;
  data?: Record<string, string | number>;
}) {
  return <span
    className={`resolution-card${concealed ? " is-concealed" : " is-revealed"}${highlighted ? " is-highlighted" : ""}`}
    role={concealed ? undefined : "img"}
    aria-label={concealed ? undefined : cardLabel(card)}
    {...data}
  >{concealed ? <CardBack /> : <CardFace card={card} />}</span>;
}

function currentMelds(result: ScoredHandResultView, completedLayoffs: number): readonly PublicMeld[] {
  const declarer = result.players.find((player) => player.playerId === result.declarerId)!;
  const defender = result.players.find((player) => player.playerId !== result.declarerId)!;
  const melds = [...declarer.melds];
  defender.layoffs.slice(0, completedLayoffs).forEach((layoff) => { melds[layoff.targetMeldIndex] = layoff.resultingMeld; });
  return melds;
}

function displayedDeadwood(player: RevealedPlayerHandView, completedLayoffs: number) {
  const laidOffIds = new Set(player.layoffs.slice(0, completedLayoffs).map((layoff) => layoff.card.id));
  return player.originalDeadwoodCards.filter((card) => !laidOffIds.has(card.id));
}

function displayedDeadwoodValue(player: RevealedPlayerHandView, completedLayoffs: number) {
  return completedLayoffs > 0 && player.layoffs.length > 0
    ? player.layoffs[Math.min(completedLayoffs, player.layoffs.length) - 1]!.remainingDeadwoodValue
    : player.originalDeadwoodValue;
}

function outcomeTitle(result: ScoredHandResultView) {
  if (result.scoringReason === "GIN") return "Gin";
  if (result.scoringReason === "UNDERCUT") return "Undercut";
  return "Knock wins";
}

function scoreFormula(result: ScoredHandResultView, declarer: RevealedPlayerHandView, defender: RevealedPlayerHandView, rules: PlayerGameView["rules"]) {
  if (result.scoringReason === "KNOCK") return `${defender.finalDeadwoodValue} − ${declarer.originalDeadwoodValue} = ${result.pointsAwarded}`;
  if (result.scoringReason === "UNDERCUT") return `${declarer.originalDeadwoodValue} − ${defender.finalDeadwoodValue} + ${rules.undercutBonus} = ${result.pointsAwarded}`;
  return `${defender.originalDeadwoodValue} + ${rules.ginBonus} = ${result.pointsAwarded}`;
}

function SeatHand({
  player, viewerSeat, declarerId, melds, completedLayoffs, concealed, activeLayoffCardId,
}: {
  player: RevealedPlayerHandView;
  viewerSeat: 0 | 1;
  declarerId: string;
  melds: readonly PublicMeld[];
  completedLayoffs: number;
  concealed: boolean;
  activeLayoffCardId?: string;
}) {
  const deadwood = displayedDeadwood(player, completedLayoffs);
  const deadwoodValue = displayedDeadwoodValue(player, completedLayoffs);
  const isDeclarer = player.playerId === declarerId;
  return <article className={`resolution-seat ${player.seat === viewerSeat ? "resolution-seat-you" : "resolution-seat-away"}`} aria-label={`${player.displayName}'s revealed hand`}>
    <header><div><span>{player.seat === viewerSeat ? "You" : "Opponent"}</span><h2>{player.displayName}</h2></div><strong>{deadwoodValue}<small> deadwood</small></strong></header>
    <div className="resolution-groups">
      <section className="resolution-group resolution-meld-group" aria-label={`${player.displayName}'s melds`}>
        <h3>Melds</h3>
        <div className="resolution-melds">{melds.length ? melds.map((meld, meldIndex) => <div
          className="resolution-meld"
          data-meld-target={isDeclarer ? meldIndex : undefined}
          key={`${meld.kind}:${meldIndex}`}
        ><span>{meld.kind === "RUN" ? "Run" : "Set"}</span><div>{meld.cards.map((card) => <ResolutionCard card={card} concealed={concealed} key={card.id} />)}</div></div>) : <p>None</p>}</div>
      </section>
      <section className="resolution-group resolution-deadwood-group" aria-label={`${player.displayName}'s deadwood`}>
        <h3>Deadwood <strong>{deadwoodValue}</strong></h3>
        <div className="resolution-deadwood">{deadwood.length ? deadwood.map((card) => <ResolutionCard
          card={card}
          concealed={concealed}
          highlighted={card.id === activeLayoffCardId}
          data={{ "data-deadwood-card": card.id }}
          key={card.id}
        />) : <span className="resolution-none">None</span>}</div>
      </section>
    </div>
  </article>;
}

function animateLayoff(root: HTMLElement, cardId: string, targetMeldIndex: number) {
  const source = Array.from(root.querySelectorAll<HTMLElement>("[data-deadwood-card]"))
    .find((element) => element.dataset.deadwoodCard === cardId);
  const target = root.querySelector<HTMLElement>(`[data-meld-target="${targetMeldIndex}"]`);
  if (!source || !target) return () => undefined;
  const rootRect = root.getBoundingClientRect();
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const copy = source.cloneNode(true) as HTMLElement;
  copy.setAttribute("aria-hidden", "true");
  copy.removeAttribute("role");
  copy.removeAttribute("aria-label");
  copy.className = "resolution-card resolution-moving-card is-revealed";
  Object.assign(copy.style, {
    left: `${from.left - rootRect.left}px`, top: `${from.top - rootRect.top}px`, width: `${from.width}px`, height: `${from.height}px`,
  });
  root.append(copy);
  const x = to.left + Math.max(0, to.width - from.width) - from.left;
  const y = to.top + Math.max(0, (to.height - from.height) / 2) - from.top;
  const animation = typeof copy.animate === "function" ? copy.animate([
    { transform: "translate3d(0,0,0) rotate(0deg)", offset: 0 },
    { transform: `translate3d(${x * .55}px,${y * .55 - 18}px,0) rotate(-4deg)`, offset: .55 },
    { transform: `translate3d(${x}px,${y}px,0) rotate(0deg)`, offset: 1 },
  ], { duration: LAYOFF_MS, easing: "cubic-bezier(.2,.75,.25,1)", fill: "forwards" }) : undefined;
  return () => { animation?.cancel(); copy.remove(); };
}

export function HandResolutionTable({
  gameId, result, viewerSeat, rules, finalDiscard, footer, replayToken = 0, onOutcome,
}: {
  gameId: string;
  result: ScoredHandResultView;
  viewerSeat: 0 | 1;
  rules: PlayerGameView["rules"];
  finalDiscard?: PublicCard;
  footer?: ReactNode;
  replayToken?: number;
  onOutcome?: () => void;
}) {
  const resolutionKey = handResolutionStorageKey(gameId, result.handNumber);
  const [stage, setStage] = useState<ResolutionStage>("declaration");
  const [completedLayoffs, setCompletedLayoffs] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef(result);
  const onOutcomeRef = useRef(onOutcome);
  resultRef.current = result;
  onOutcomeRef.current = onOutcome;
  const declarer = result.players.find((player) => player.playerId === result.declarerId)!;
  const defender = result.players.find((player) => player.playerId !== result.declarerId)!;
  const layoffs = defender.layoffs;
  const declarerMelds = useMemo(() => currentMelds(result, completedLayoffs), [completedLayoffs, result]);
  const stageIndex = stage === "declaration" ? 0 : stage === "reveal" ? 1 : stage === "layoffs" ? 2 : 3;

  useEffect(() => {
    setCompletedLayoffs(0);
    setAnnouncement("");
    if (reducedMotionIsPreferred() || (replayToken === 0 && wasResolved(resolutionKey))) {
      setCompletedLayoffs(layoffs.length);
      setStage("outcome");
    } else setStage("declaration");
  }, [layoffs.length, replayToken, resolutionKey]);

  useEffect(() => {
    const currentResult = resultRef.current;
    const currentDefender = currentResult.players.find((player) => player.playerId !== currentResult.declarerId)!;
    const currentLayoffs = currentDefender.layoffs;
    if (stage === "declaration") {
      const timer = window.setTimeout(() => setStage("reveal"), DECLARATION_MS);
      return () => window.clearTimeout(timer);
    }
    if (stage === "reveal") {
      const timer = window.setTimeout(() => setStage(currentResult.declaration === "GIN" ? "outcome" : "layoffs"), REVEAL_MS);
      return () => window.clearTimeout(timer);
    }
    if (stage !== "layoffs") return;
    if (!currentLayoffs.length) {
      const timer = window.setTimeout(() => setStage("outcome"), NO_LAYOFF_MS);
      return () => window.clearTimeout(timer);
    }
    if (completedLayoffs >= currentLayoffs.length) {
      const timer = window.setTimeout(() => setStage("outcome"), 180);
      return () => window.clearTimeout(timer);
    }
    const layoff = currentLayoffs[completedLayoffs]!;
    const removeCopy = rootRef.current ? animateLayoff(rootRef.current, layoff.card.id, layoff.targetMeldIndex) : () => undefined;
    const timer = window.setTimeout(() => {
      setCompletedLayoffs((value) => value + 1);
      setAnnouncement(`${cardLabel(layoff.card)} laid off. ${layoff.remainingDeadwoodValue} deadwood remaining.`);
    }, LAYOFF_MS);
    return () => { window.clearTimeout(timer); removeCopy(); };
  }, [completedLayoffs, layoffs.length, resolutionKey, stage]);

  useEffect(() => {
    if (stage !== "outcome") return;
    if (!wasResolved(resolutionKey)) rememberResolution(resolutionKey, "completed");
    onOutcomeRef.current?.();
  }, [resolutionKey, stage]);

  function showResult() {
    rememberResolution(resolutionKey, "skipped");
    setCompletedLayoffs(layoffs.length);
    setAnnouncement("Final hand result shown.");
    setStage("outcome");
  }

  function replayLayoffs() {
    setCompletedLayoffs(0);
    setAnnouncement("Replaying the hand resolution.");
    setStage("reveal");
  }

  const declaration = result.declaration === "GIN"
    ? `${result.declarerName} went gin.`
    : `${result.declarerName} knocked with ${declarer.originalDeadwoodValue} deadwood.`;
  const activeLayoff = stage === "layoffs" ? layoffs[completedLayoffs] : undefined;
  const concealed = stage === "declaration";

  return <div className={`hand-resolution-table stage-${stage}`} ref={rootRef} data-resolution-stage={stage}>
    <ol className="resolution-progress" aria-label="Hand resolution progress">
      {["Declaration", "Reveal", "Layoffs", "Result"].map((label, index) => <li className={index <= stageIndex ? "is-active" : ""} aria-current={index === stageIndex ? "step" : undefined} key={label}>{label}</li>)}
    </ol>
    <div className="resolution-declaration" role="status" aria-live="polite">
      <div><span>{result.declaration === "GIN" ? "Gin declared" : "Knock declared"}</span><strong>{declaration}</strong></div>
      {finalDiscard && <div className="resolution-final-discard"><span>Final discard</span><ResolutionCard card={finalDiscard} highlighted={stage === "declaration"} /></div>}
    </div>
    <div className="resolution-tabletop">
      {[...result.players].sort((left, right) => left.seat === viewerSeat ? 1 : right.seat === viewerSeat ? -1 : left.seat - right.seat).map((player) => <SeatHand
        player={player}
        viewerSeat={viewerSeat}
        declarerId={result.declarerId}
        melds={player.playerId === result.declarerId ? declarerMelds : player.melds}
        completedLayoffs={player.playerId === defender.playerId ? completedLayoffs : 0}
        concealed={concealed}
        activeLayoffCardId={activeLayoff?.card.id}
        key={player.playerId}
      />)}
      {stage === "layoffs" && !layoffs.length && <p className="resolution-notice" role="status">No layoffs available.</p>}
    </div>
    <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
    {stage === "outcome" ? <>
      <section className={`resolution-outcome outcome-${result.scoringReason.toLowerCase()}`} aria-labelledby={`resolution-outcome-${result.handNumber}`}>
        <div><span>Hand {result.handNumber}</span><h2 id={`resolution-outcome-${result.handNumber}`}>{outcomeTitle(result)}</h2><p>{result.winnerName} scores the hand.</p></div>
        <strong>+{result.pointsAwarded}</strong>
        <small>{scoreFormula(result, declarer, defender, rules)}</small>
        {result.scoringReason === "GIN" && <p className="resolution-explanation">Layoffs are not allowed against gin.</p>}
        {result.scoringReason === "UNDERCUT" && defender.finalDeadwoodValue === 0 && <p className="resolution-explanation">0 deadwood after layoffs. This is an undercut—not gin.</p>}
      </section>
      <button className="action-button secondary resolution-replay" type="button" onClick={replayLayoffs}>Replay layoffs</button>
      {footer}
    </> : <button className="action-button secondary resolution-skip" type="button" onClick={showResult}>Show result</button>}
  </div>;
}

export const HAND_RESOLUTION_TIMINGS = { declaration: DECLARATION_MS, reveal: REVEAL_MS, layoff: LAYOFF_MS, noLayoff: NO_LAYOFF_MS } as const;
