"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ensureAnonymousSession } from "@/lib/supabase/anonymous";
import {
  gameplayControlsAreAvailable, selectedDiscardActionAvailability, type HandScoreView,
  type LegalControl, type PlayerGameView, type PublicCard,
} from "@/src/shared/game-view";
import { CardArtProvider } from "./card-art-provider";
import { CardHand, moveVisibleCard, orderVisibleCards, reconcileKnownOrder } from "./card-hand";
import { ContextualGameActions } from "./game-actions";
import { CardFace, cardLabel } from "./game-card";
import { HandResolutionTable } from "./hand-resolution-table";

type ApiResponse = { game?: PlayerGameView; rematchGameId?: string; error?: { code?: string } };
type RecentGame = { gameId: string; opponent: string; updatedAt: number };

export function newestGameView(current: PlayerGameView | undefined, incoming: PlayerGameView): PlayerGameView {
  return !current || current.gameId !== incoming.gameId || incoming.version >= current.version ? incoming : current;
}

async function jsonRequest(path: string, init?: RequestInit): Promise<{ response: Response; body: ApiResponse }> {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...init?.headers } });
  return { response, body: await response.json().catch(() => ({})) };
}

export function GameScreen({ gameId }: { gameId: string }) {
  return <CardArtProvider><GameScreenContent gameId={gameId} /></CardArtProvider>;
}

function GameScreenContent({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [game, setGame] = useState<PlayerGameView>();
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loadedOrderGameId, setLoadedOrderGameId] = useState<string>();
  const gameRef = useRef<PlayerGameView | undefined>(undefined);
  const actionInFlight = useRef(false);
  const botWakeVersion = useRef<string | null>(null);

  const acceptGameView = useCallback((incoming: PlayerGameView) => {
    gameRef.current = newestGameView(gameRef.current, incoming);
    setGame((current) => newestGameView(current, incoming));
  }, []);

  const refresh = useCallback(async () => {
    const { response, body } = await jsonRequest(`/api/games/${gameId}`);
    if (!response.ok || !body.game) throw new Error(body.error?.code ?? "GAME_NOT_FOUND");
    acceptGameView(body.game);
  }, [acceptGameView, gameId]);

  useEffect(() => {
    let active = true;
    const token = sessionStorage.getItem(`gin-rummy:invite:${gameId}`);
    if (token) setInviteUrl(`${window.location.origin}/join/${token}`);
    void ensureAnonymousSession().then(() => { if (active) setAuthReady(true); }).catch(() => { if (active) setError("We couldn’t prepare your player. Try again."); });
    return () => { active = false; };
  }, [gameId]);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    void refresh().catch(() => { if (active) setError("This game is not available to this player. Open it in the browser where you joined, or use a new invite."); });
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1200);
    return () => { active = false; window.clearInterval(timer); };
  }, [authReady, refresh]);

  useEffect(() => {
    if (!game || game.gameId !== gameId) return;
    if (loadedOrderGameId === gameId) setOrder((current) => {
      const next = reconcileKnownOrder(current, game.you.hand);
      return sameOrder(current, next) ? current : next;
    });
    try {
      const prior = JSON.parse(localStorage.getItem("gin-rummy:recent-games") ?? "[]") as RecentGame[];
      const entry: RecentGame = { gameId: game.gameId, opponent: game.opponent?.displayName ?? "Waiting for opponent", updatedAt: Date.now() };
      localStorage.setItem("gin-rummy:recent-games", JSON.stringify([entry, ...prior.filter((item) => item.gameId !== entry.gameId)].slice(0, 4)));
    } catch { /* Recent tables are a convenience, never game state. */ }
  }, [game, gameId, loadedOrderGameId]);

  useEffect(() => {
    setOrder(readSavedOrder(gameId));
    setLoadedOrderGameId(gameId);
  }, [gameId]);

  useEffect(() => {
    if (loadedOrderGameId === gameId) saveOrder(gameId, order);
  }, [gameId, loadedOrderGameId, order]);

  useEffect(() => {
    if (!game?.botActionPending) {
      botWakeVersion.current = null;
      return;
    }
    const wakeKey = `${game.gameId}:${game.version}`;
    if (botWakeVersion.current === wakeKey) return;
    const range = game.phase === "AWAITING_DISCARD" ? [900, 1600] : game.phase === "HAND_COMPLETE" ? [600, 1000] : [700, 1200];
    const delay = range[0]! + Math.floor(Math.random() * (range[1]! - range[0]!));
    const timer = window.setTimeout(() => {
      botWakeVersion.current = wakeKey;
      void jsonRequest(`/api/games/${gameId}/bot-action`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: game.version }),
      }).then(({ response, body }) => {
        if (body.game) acceptGameView(body.game);
        if (!response.ok) throw new Error(body.error?.code ?? "BOT_ACTION_FAILED");
      }).catch(() => {
        botWakeVersion.current = null;
        void refresh().catch(() => undefined);
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [acceptGameView, game, gameId, refresh]);

  useEffect(() => {
    if (selectedCardId !== undefined && (game?.phase !== "AWAITING_DISCARD" || !game.you.hand.some((card) => card.id === selectedCardId))) {
      setSelectedCardId(undefined);
    }
  }, [game, selectedCardId]);

  async function action(type: LegalControl, cardId?: string) {
    const current = gameRef.current ?? game;
    if (!current || current.gameId !== gameId || actionInFlight.current || !current.legalControls.includes(type)) return;
    if (cardId && !current.you.hand.some((card) => card.id === cardId)) {
      setSelectedCardId(undefined);
      setError("That card is no longer in your hand. The latest game has been loaded.");
      void refresh().catch(() => undefined);
      return;
    }
    actionInFlight.current = true;
    setBusy(true); setError("");
    try {
      const { response, body } = await jsonRequest(`/api/games/${gameId}/actions`, { method: "POST", body: JSON.stringify({ expectedVersion: current.version, action: { actionId: crypto.randomUUID(), type, ...(cardId ? { cardId } : {}) } }) });
      if (body.game) acceptGameView(body.game);
      if (!response.ok) throw new Error(body.error?.code ?? "ACTION_FAILED");
      setSelectedCardId(undefined);
    } catch (cause) { setError(actionMessage(cause)); void refresh().catch(() => undefined); } finally { actionInFlight.current = false; setBusy(false); }
  }
  async function rematch(response: "REQUEST" | "ACCEPT" | "PLAY_AGAIN") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await jsonRequest(`/api/games/${gameId}/rematch`, { method: "POST", body: JSON.stringify({ response }) });
      if (result.body.game) acceptGameView(result.body.game);
      if (!result.response.ok) throw new Error(result.body.error?.code ?? "REMATCH_UNAVAILABLE");
      if (result.body.rematchGameId) router.push(`/game/${result.body.rematchGameId}`);
    } catch (cause) { setError(actionMessage(cause)); } finally { setBusy(false); }
  }
  const moveCard = (cardId: string, targetIndex: number) => setOrder((current) => {
    const visibleCards = orderVisibleCards(game?.you.hand ?? [], current);
    return moveVisibleCard(current, visibleCards, cardId, targetIndex);
  });

  if (!game) return <main className="game-shell"><p className="simple-panel" role={error ? "alert" : undefined}>{error || "Preparing your table…"}</p></main>;
  const can = (control: LegalControl) => !busy && game.legalControls.includes(control);
  const discard = game.discardPile[0];
  const selected = game.you.hand.find((card) => card.id === selectedCardId);
  const selectedActions = selectedDiscardActionAvailability(game, selectedCardId);
  const orderedHand = orderVisibleCards(game.you.hand, order);
  const youAreActive = game.legalControls.length > 0;
  const isPlaying = gameplayControlsAreAvailable(game);

  return <main className="game-shell"><section className="game-table">
    <header className="table-header"><Link className="wordmark" href="/">Gin <span>Rummy</span></Link><div className="table-tools"><span className="table-status">{game.mode === "SINGLE_PLAYER" ? "Table with Naia" : "Private table"}</span><Link href="/settings" aria-label="Settings" className="icon-button">⚙</Link></div></header>
    {game.status === "WAITING" ? <WaitingGame inviteUrl={inviteUrl} /> : isPlaying ? <>
      <section className="opponent-area" aria-label={game.opponent?.kind === "BOT" ? "Naia, computer opponent" : "Opponent"}>
        <div className="player-identity opponent-identity"><div className={`avatar${game.opponent?.kind === "BOT" ? " bot-avatar" : ""}`} aria-hidden="true">{game.opponent?.kind === "BOT" ? <Image src="/avatars/Naia-pomeranian.webp" alt="" width={64} height={64} priority /> : initials(game.opponent?.displayName ?? "?")}</div><div className="identity-copy"><p className="eyebrow">Opponent <span className="connection"><i /> {game.opponent?.kind === "BOT" ? "Computer opponent" : "At table"}</span></p><div className="identity-line"><h1>{game.opponent?.displayName ?? "Opponent"}</h1><span className="identity-score"><span>Score</span>{game.opponent?.score ?? 0}</span></div><p className="seat-note">{game.opponent?.cardCount ?? 0} cards {game.dealerId ? "· Dealer" : ""}</p></div></div>
        <OpponentHand count={game.opponent?.cardCount ?? 0} name={game.opponent?.displayName ?? "Opponent"} /><ScoreHud game={game} />
      </section>
      <section className="table-center" aria-label="Public piles and turn status">
        <div className="piles">
          <button className="pile-control stock-pile" disabled={!can("DRAW_STOCK")} onClick={() => void action("DRAW_STOCK")} aria-label={`Draw from stock, ${game.stockCount} cards remaining`}><CardBack /><span><b>Stock</b><em>{game.stockCount} cards</em></span></button>
          <button className="pile-control discard-pile" disabled={!can("DRAW_DISCARD") || !discard} onClick={() => void action("DRAW_DISCARD")} aria-label={discard ? `Take discard ${cardLabel(discard)}` : "Discard pile is empty"}>{discard ? <CardFace card={discard} /> : <span className="empty-card">—</span>}<span><b>Discard</b><em>{discard ? cardLabel(discard) : "Empty"}</em></span></button>
        </div><TurnPrompt game={game} active={youAreActive} selected={selected} selectedActions={selectedActions} />
      </section>
      <section className="player-area" aria-labelledby="your-hand">
        <div className="player-hand-heading"><div className="player-identity"><div className="avatar you-avatar" aria-hidden="true">{initials(game.you.displayName)}</div><div className="identity-copy"><p className="eyebrow">You {youAreActive ? "· Your turn" : "· At the table"}</p><div className="identity-line"><h2 id="your-hand">{game.you.displayName}</h2><span className="identity-score"><span>Score</span>{game.you.score}</span></div></div></div><div className="hand-tools"><span>{game.you.hand.length} cards</span><small>{busy ? "Order saved" : "Drag to organize"}</small></div></div>
        <CardHand cards={orderedHand} meldCandidates={game.you.meldCandidates ?? []} selectedCardId={selectedCardId} canDiscard={can("DISCARD")} canReorder={isPlaying && !busy} restrictedId={game.turnRestrictions?.cannotDiscardCardId} drawnId={game.drawnStockCardId} onSelect={setSelectedCardId} onMove={moveCard} />
      </section>
      {error && <p role="alert" className="game-error">{error}</p>}
      <ContextualGameActions legalControls={game.legalControls} busy={busy} discard={discard} selected={selected} selectedActions={selectedActions} onAction={action} />
    </> : game.status === "HAND_COMPLETE" ? <HandCompleteResult game={game} onStartNextHand={() => void action("START_NEXT_HAND")} canStartNextHand={can("START_NEXT_HAND")} /> : <GameResult game={game} busy={busy} onRematch={rematch} />}
    {error && !isPlaying && <p role="alert" className="game-error">{error}</p>}
  </section></main>;
}

function OpponentHand({ count, name }: { count: number; name: string }) { return <div className="opponent-hand" aria-label={`${name} has ${count} cards`}>{Array.from({ length: count }, (_, index) => <span className="opponent-card" style={{ "--card-index": index, "--card-count": count } as CSSProperties} key={index}><CardBack /></span>)}</div>; }
function ScoreHud({ game }: { game: PlayerGameView }) { return <aside className="score-hud" aria-label="Match scores"><p>First to {game.rules.matchTarget}</p><dl><div><dt>You</dt><dd>{game.you.score}</dd></div><div><dt>{game.opponent?.displayName ?? "Opponent"}</dt><dd>{game.opponent?.score ?? 0}</dd></div></dl></aside>; }
function TurnPrompt({ game, active, selected, selectedActions }: { game: PlayerGameView; active: boolean; selected?: PublicCard; selectedActions: ReturnType<typeof selectedDiscardActionAvailability> }) { return <div className={`turn-prompt${active ? " is-active" : ""}`} role="status" aria-live="polite" aria-atomic="true"><span className="turn-dot" /><p><strong>{active ? "Your turn" : `${game.opponent?.displayName ?? "Opponent"} is playing`}</strong><span aria-hidden="true"> · </span>{turnInstruction(game, selected, selectedActions)}</p></div>; }
function CardBack() { return <span className="card-back" aria-hidden="true"><span>R</span></span>; }
function WaitingGame({ inviteUrl }: { inviteUrl: string | null }) { const [copied, setCopied] = useState(false); async function copyInvite() { if (!inviteUrl) return; await navigator.clipboard.writeText(inviteUrl); setCopied(true); } return <section className="waiting-room" aria-labelledby="waiting-title"><div className="waiting-seal">R</div><p className="eyebrow">Private two-player table</p><h1 id="waiting-title">Your table is set.</h1><p>Share this private invitation with one friend. You can safely leave this page and return later.</p>{inviteUrl ? <><label className="invite-field"><span>Invite link</span><code>{inviteUrl}</code></label><button className="action-button primary" onClick={() => void copyInvite()}>{copied ? "Invitation copied" : "Copy invitation"}</button></> : <p className="table-note">Your private invitation is available in the browser that created this table.</p>}<p className="waiting-status" role="status"><i /> Waiting for an opponent to take a seat</p></section>; }
export function HandCompleteResult({ game, onStartNextHand, canStartNextHand }: { game: PlayerGameView; onStartNextHand: () => void; canStartNextHand: boolean }) {
  const result = game.handResult;
  if (!result) return null;
  const readiness = game.nextHandReadiness;
  const readyLabel = readiness?.you ? `Ready — waiting for ${game.opponent?.displayName ?? "opponent"}` : "Ready for next hand";
  const footer = <>
    <Readiness readiness={readiness} opponentName={game.opponent?.displayName ?? "Opponent"} />
    <button className="action-button primary result-primary" disabled={!canStartNextHand} onClick={onStartNextHand}>{canStartNextHand ? readyLabel : `Waiting for ${game.opponent?.displayName ?? "opponent"}`}</button>
  </>;
  if (result.kind === "CANCELLED") return <ResultOverlay title="Hand over" kicker="No score awarded">
    <p>The stock reached two cards. Both hands stay private and the score is unchanged.</p>
    <MatchScores scores={result.scoresAfter} />
    {footer}
  </ResultOverlay>;
  return <ResultOverlay title={`Hand ${result.handNumber} resolution`} kicker="The hand is over" wide>
    <HandResolutionTable
      gameId={game.gameId}
      result={result}
      viewerSeat={game.you.seat}
      rules={game.rules}
      footer={<><MatchScores scores={result.scoresAfter} />{footer}</>}
    />
  </ResultOverlay>;
}
export function GameResult({ game, busy, onRematch }: { game: PlayerGameView; busy: boolean; onRematch: (response: "REQUEST" | "ACCEPT" | "PLAY_AGAIN") => Promise<void> }) {
  const result = game.gameResult;
  if (!result) return null;
  return <CompletedGameResult game={game} busy={busy} onRematch={onRematch} />;
}
function CompletedGameResult({ game, busy, onRematch }: { game: PlayerGameView; busy: boolean; onRematch: (response: "REQUEST" | "ACCEPT" | "PLAY_AGAIN") => Promise<void> }) {
  const result = game.gameResult!;
  const decidingHand = result.completedHands.at(-1);
  if (!decidingHand || decidingHand.kind !== "SCORED") throw new Error("A completed match must end with a scored hand.");
  const [showSummary, setShowSummary] = useState(false);
  const [selectedHandNumber, setSelectedHandNumber] = useState<number>();
  const [replayToken, setReplayToken] = useState(0);
  function replayDecidingHand() {
    setReplayToken((value) => value + 1);
    setSelectedHandNumber(undefined);
    setShowSummary(false);
  }
  if (!showSummary) return <ResultOverlay title="Deciding hand" kicker={`Hand ${decidingHand.handNumber}`} wide key={`deciding-${replayToken}`}>
    <HandResolutionTable
      gameId={game.gameId}
      result={decidingHand}
      viewerSeat={game.you.seat}
      rules={game.rules}
      replayToken={replayToken}
      footer={<button className="action-button primary result-primary" type="button" onClick={() => setShowSummary(true)}>View match summary</button>}
    />
  </ResultOverlay>;
  const selectedHand = result.completedHands.find((hand) => hand.handNumber === selectedHandNumber);
  if (selectedHand?.kind === "SCORED") return <ResultOverlay title={`Hand ${selectedHand.handNumber} review`} kicker="Hand history" wide key={`review-${selectedHand.handNumber}`}>
    <HandResolutionTable
      gameId={game.gameId}
      result={selectedHand}
      viewerSeat={game.you.seat}
      rules={game.rules}
      startResolved
      footer={<button className="action-button primary result-primary" type="button" onClick={() => setSelectedHandNumber(undefined)}>Back to match summary</button>}
    />
  </ResultOverlay>;
  if (selectedHand?.kind === "CANCELLED") return <ResultOverlay title={`Hand ${selectedHand.handNumber} review`} kicker="No score awarded" key={`review-${selectedHand.handNumber}`}>
    <p>The stock reached two cards. Both hands stayed private and the score was unchanged.</p>
    <MatchScores scores={selectedHand.scoresAfter} />
    <button className="action-button primary result-primary" type="button" onClick={() => setSelectedHandNumber(undefined)}>Back to match summary</button>
  </ResultOverlay>;
  return <ResultOverlay title="Match complete" kicker="A fine game" key="summary">
    <VictoryCrest />
    <div className="match-winner"><span>Winner</span><strong>{result.winnerName}</strong><small>First to {result.matchTarget}</small></div>
    <MatchScores scores={result.finalScores} />
    <button className="action-button secondary replay-deciding-hand" type="button" onClick={replayDecidingHand}>Replay deciding hand</button>
    <section className="hand-history" aria-labelledby="hand-history-title"><h2 id="hand-history-title">Hand history</h2>{result.completedHands.map((hand) => <button
      type="button"
      aria-label={`Review hand ${hand.handNumber}: ${hand.kind === "CANCELLED" ? "no score, stock exhausted" : `${hand.winnerName} scored ${hand.pointsAwarded}, ${hand.scoringReason.toLowerCase()}`}`}
      onClick={() => setSelectedHandNumber(hand.handNumber)}
      key={hand.handNumber}
    ><span>Hand {hand.handNumber}</span><strong>{hand.kind === "CANCELLED" ? "No score" : `${hand.winnerName} +${hand.pointsAwarded}`}</strong><small>{hand.kind === "CANCELLED" ? "Stock exhausted" : hand.scoringReason === "GIN" ? "Gin" : hand.scoringReason === "UNDERCUT" ? "Undercut" : "Knock"}</small></button>)}</section>
    {game.mode === "SINGLE_PLAYER" ? <button className="action-button primary result-primary" onClick={() => void onRematch("PLAY_AGAIN")} disabled={busy}>Play Naia again</button> : <>
      {!game.rematch && <button className="action-button primary result-primary" onClick={() => void onRematch("REQUEST")} disabled={busy}>Request rematch</button>}
      {game.rematch?.requestedBy === "YOU" && <p className="waiting-status"><i /> Rematch requested — waiting for your opponent</p>}
      {game.rematch?.requestedBy === "OPPONENT" && <button className="action-button primary result-primary" onClick={() => void onRematch("ACCEPT")} disabled={busy}>Accept rematch</button>}
    </>}
    <Link className="quiet-link" href="/">Return home</Link>
  </ResultOverlay>;
}
function VictoryCrest() {
  return <div className="victory-crest" aria-hidden="true">
    <svg viewBox="0 0 180 112" focusable="false">
      <g className="victory-laurel">
        <path d="M59 89C38 79 27 61 29 39" /><path d="M121 89c21-10 32-28 30-50" />
        <path d="M43 71c-8 0-13-4-17-10 8-1 14 2 17 10Zm-8-15c-7-3-10-8-11-15 8 2 12 7 11 15Zm8 29c-8 2-14 0-20-5 7-4 14-2 20 5Zm94-14c8 0 13-4 17-10-8-1-14 2-17 10Zm8-15c7-3 10-8 11-15-8 2-12 7-11 15Zm-8 29c8 2 14 0 20-5-7-4-14-2-20 5Z" />
      </g>
      <g className="victory-cards">
        <rect x="59" y="24" width="43" height="62" rx="5" transform="rotate(-10 80.5 55)" />
        <rect x="78" y="21" width="43" height="62" rx="5" transform="rotate(10 99.5 52)" />
        <path d="m75 35 4 4 4-4-4-4-4 4Zm27-1c4 4 8 0 5-4-3-3-7 1-5 4Zm0 0c-4 4-8 0-5-4 3-3 7 1 5 4Z" />
      </g>
      <path className="victory-ribbon" d="M54 83h72l-8 18-28-7-28 7-8-18Z" />
      <text x="90" y="91">GIN</text>
      <g className="victory-sparkles">
        <path d="M43 27v10m-5-5h10" /><path d="M139 22v12m-6-6h12" /><path d="M125 11v7m-3.5-3.5h7" />
      </g>
    </svg>
  </div>;
}
function ResultOverlay({ title, kicker, children, wide = false }: { title: string; kicker: string; children: React.ReactNode; wide?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = panel.current;
    const backdrop = root?.parentElement;
    const siblings = Array.from(backdrop?.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      .map((element) => ({ element, ariaHidden: element.getAttribute("aria-hidden"), inert: element.inert }));
    siblings.forEach(({ element }) => { element.setAttribute("aria-hidden", "true"); element.inert = true; });
    titleRef.current?.focus();
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []);
      if (!items.length) { event.preventDefault(); titleRef.current?.focus(); return; }
      const first = items[0]!; const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    root?.addEventListener("keydown", onKeyDown);
    return () => {
      root?.removeEventListener("keydown", onKeyDown);
      siblings.forEach(({ element, ariaHidden, inert }) => { if (ariaHidden === null) element.removeAttribute("aria-hidden"); else element.setAttribute("aria-hidden", ariaHidden); element.inert = inert; });
      previouslyFocused?.focus();
    };
  }, []);
  return <section className="result-backdrop"><div ref={panel} className={`result-panel${wide ? " result-panel-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="result-handle" aria-hidden="true" /><p className="eyebrow">{kicker}</p><h1 ref={titleRef} id={titleId} tabIndex={-1}>{title}</h1>{children}</div></section>;
}
function Readiness({ readiness, opponentName }: { readiness: PlayerGameView["nextHandReadiness"]; opponentName: string }) { return <div className="readiness" aria-label="Next hand readiness"><span className={readiness?.you ? "is-ready" : ""}>You {readiness?.you ? "ready" : "reviewing"}</span><span className={readiness?.opponent ? "is-ready" : ""}>{opponentName} {readiness?.opponent ? "ready" : "reviewing"}</span></div>; }
function MatchScores({ scores }: { scores: readonly HandScoreView[] }) { return <section className="match-scores" aria-label="Match score">{scores.map((score) => <div key={score.playerId}><span>{score.displayName}</span><strong>{score.score}</strong></div>)}</section>; }
function turnInstruction(game: PlayerGameView, selected?: PublicCard, selectedActions?: ReturnType<typeof selectedDiscardActionAvailability>) { if (game.phase === "OPENING_NON_DEALER" || game.phase === "OPENING_DEALER") return game.legalControls.length ? "Take the up-card or pass" : "Considering the up-card"; if (game.phase === "AWAITING_DRAW") return game.legalControls.length ? "Draw a card" : "Choosing a draw"; if (game.phase === "AWAITING_DISCARD") { if (!game.legalControls.length) return "Choosing a discard"; if (selectedActions?.isProhibitedDiscard) return "Choose another card"; if (selectedActions?.canGin) return "You can Gin!"; if (selectedActions?.canKnock) return "Discard or knock"; return selected ? "Discard the selected card" : "Choose a card to discard"; } return "Review the hand result"; }
function initials(value: string) { return value.slice(0, 2).toUpperCase(); }
export function actionMessage(cause: unknown) {
  if (!(cause instanceof Error)) return "Action failed. Please try again.";
  if (cause.message === "STALE_VERSION") return "The game changed. The latest state has been loaded.";
  if (cause.message === "WRONG_PLAYER") return "It is not your turn.";
  if (cause.message === "ACTION_NOT_ALLOWED_IN_PHASE") return "That move is no longer available. The latest game has been loaded.";
  if (cause.message === "CARD_NOT_IN_HAND") return "That card is no longer in your hand. The latest game has been loaded.";
  if (cause.message === "ILLEGAL_REDISCARD") return "You can’t discard the face-up card you just picked up. Choose another card.";
  if (cause.message === "STOCK_DRAW_REQUIRED") return "After both players pass, you must draw from the stock.";
  if (cause.message === "KNOCK_DEADWOOD_TOO_HIGH") return "That hand cannot knock yet.";
  if (cause.message === "GIN_REQUIRES_ZERO_DEADWOOD") return "Gin requires zero deadwood.";
  if (cause.message === "GIN_ACTION_REQUIRED") return "This hand must be declared as gin.";
  if (cause.message === "INTERNAL_ERROR") return "We couldn’t record that move. Try again.";
  return "That action is not available right now.";
}

const handOrderKey = (gameId: string) => `gin-rummy:hand-order:v1:${gameId}`;
function readSavedOrder(gameId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(handOrderKey(gameId)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}
function saveOrder(gameId: string, order: readonly string[]) {
  try { localStorage.setItem(handOrderKey(gameId), JSON.stringify(order)); } catch { /* Display preferences must never block play. */ }
}
function sameOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
