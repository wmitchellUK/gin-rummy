"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ensureAnonymousSession } from "@/lib/supabase/anonymous";
import {
  gameplayControlsAreAvailable, selectedDiscardActionAvailability, type HandResultView, type HandScoreView,
  type LegalControl, type PlayerGameView, type PublicCard, type PublicMeld, type RevealedPlayerHandView,
} from "@/src/shared/game-view";
import { CardArtProvider } from "./card-art-provider";
import { CardHand, moveVisibleCard, orderVisibleCards, reconcileKnownOrder } from "./card-hand";
import { ContextualGameActions } from "./game-actions";
import { CardFace, CardMark, cardLabel } from "./game-card";

type ApiResponse = { game?: PlayerGameView; rematchGameId?: string; error?: { code?: string } };
type RecentGame = { gameId: string; opponent: string; updatedAt: number };

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

  const refresh = useCallback(async () => {
    const { response, body } = await jsonRequest(`/api/games/${gameId}`);
    if (!response.ok || !body.game) throw new Error(body.error?.code ?? "GAME_NOT_FOUND");
    setGame((current) => !current || body.game!.version >= current.version ? body.game : current);
  }, [gameId]);

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

  async function action(type: LegalControl, cardId?: string) {
    if (!game || busy) return;
    setBusy(true); setError("");
    try {
      const { response, body } = await jsonRequest(`/api/games/${gameId}/actions`, { method: "POST", body: JSON.stringify({ expectedVersion: game.version, action: { actionId: crypto.randomUUID(), type, ...(cardId ? { cardId } : {}) } }) });
      if (body.game) setGame(body.game);
      if (!response.ok) throw new Error(body.error?.code ?? "ACTION_FAILED");
      setSelectedCardId(undefined);
    } catch (cause) { setError(actionMessage(cause)); void refresh().catch(() => undefined); } finally { setBusy(false); }
  }
  async function rematch(response: "REQUEST" | "ACCEPT") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await jsonRequest(`/api/games/${gameId}/rematch`, { method: "POST", body: JSON.stringify({ response }) });
      if (result.body.game) setGame(result.body.game);
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
    <header className="table-header"><Link className="wordmark" href="/">Gin <span>Rummy</span></Link><div className="table-tools"><span className="table-status">Private table</span><Link href="/settings" aria-label="Settings" className="icon-button">⚙</Link></div></header>
    {game.status === "WAITING" ? <WaitingGame inviteUrl={inviteUrl} /> : isPlaying ? <>
      <section className="opponent-area" aria-label="Opponent">
        <div className="player-identity opponent-identity"><div className="avatar" aria-hidden="true">{initials(game.opponent?.displayName ?? "?")}</div><div className="identity-copy"><p className="eyebrow">Opponent <span className="connection"><i /> At table</span></p><div className="identity-line"><h1>{game.opponent?.displayName ?? "Opponent"}</h1><span className="identity-score"><span>Score</span>{game.opponent?.score ?? 0}</span></div><p className="seat-note">{game.opponent?.cardCount ?? 0} cards {game.dealerId ? "· Dealer" : ""}</p></div></div>
        <OpponentHand count={game.opponent?.cardCount ?? 0} /><ScoreHud game={game} />
      </section>
      <section className="table-center" aria-label="Public piles and turn status">
        <div className="piles">
          <button className="pile-control stock-pile" disabled={!can("DRAW_STOCK")} onClick={() => void action("DRAW_STOCK")} aria-label={`Draw from stock, ${game.stockCount} cards remaining`}><CardBack /><span><b>Stock</b><em>{game.stockCount} cards</em></span></button>
          <button className="pile-control discard-pile" disabled={!can("DRAW_DISCARD") || !discard} onClick={() => void action("DRAW_DISCARD")} aria-label={discard ? `Take discard ${cardLabel(discard)}` : "Discard pile is empty"}>{discard ? <CardFace card={discard} /> : <span className="empty-card">—</span>}<span><b>Discard</b><em>{discard ? cardLabel(discard) : "Empty"}</em></span></button>
        </div><TurnPrompt game={game} active={youAreActive} selected={selected} selectedActions={selectedActions} />
      </section>
      <section className="player-area" aria-labelledby="your-hand">
        <div className="player-hand-heading"><div className="player-identity"><div className="avatar you-avatar" aria-hidden="true">{initials(game.you.displayName)}</div><div className="identity-copy"><p className="eyebrow">You {youAreActive ? "· Your turn" : "· At the table"}</p><div className="identity-line"><h2 id="your-hand">{game.you.displayName}</h2><span className="identity-score"><span>Score</span>{game.you.score}</span></div></div></div><div className="hand-tools"><span>{game.you.hand.length} cards</span><small>{youAreActive ? "Drag to organize" : "Order saved"}</small></div></div>
        <CardHand cards={orderedHand} meldCandidates={game.you.meldCandidates ?? []} selectedCardId={selectedCardId} canDiscard={can("DISCARD")} canReorder={isPlaying && youAreActive && !busy} restrictedId={game.turnRestrictions?.cannotDiscardCardId} drawnId={game.drawnStockCardId} onSelect={setSelectedCardId} onMove={moveCard} />
      </section>
      {error && <p role="alert" className="game-error">{error}</p>}
      <ContextualGameActions legalControls={game.legalControls} busy={busy} discard={discard} selected={selected} selectedActions={selectedActions} onAction={action} />
    </> : game.status === "HAND_COMPLETE" ? <HandCompleteResult game={game} onStartNextHand={() => void action("START_NEXT_HAND")} canStartNextHand={can("START_NEXT_HAND")} /> : <GameResult game={game} busy={busy} onRematch={rematch} />}
    {error && !isPlaying && <p role="alert" className="game-error">{error}</p>}
  </section></main>;
}

function OpponentHand({ count }: { count: number }) { return <div className="opponent-hand" aria-label={`Opponent has ${count} cards`}>{Array.from({ length: count }, (_, index) => <span className="opponent-card" style={{ "--card-index": index, "--card-count": count } as CSSProperties} key={index}><CardBack /></span>)}</div>; }
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
  const declarer = result.players.find((player) => player.playerId === result.declarerId)!;
  const opponent = result.players.find((player) => player.playerId !== result.declarerId)!;
  return <ResultOverlay title="Hand over" kicker={`${result.declarerName} ${result.declaration === "KNOCK" ? "knocked" : "went gin"}`}>
    <div className="result-score"><strong>{result.winnerName} wins the hand</strong><span>+{result.pointsAwarded}</span><small>{scoreFormula(result, declarer, opponent, game)}</small></div>
    <div className="revealed-hands">{result.players.map((player) => <RevealedHand key={player.playerId} player={player} />)}</div>
    <MatchScores scores={result.scoresAfter} />
    {footer}
  </ResultOverlay>;
}
export function GameResult({ game, busy, onRematch }: { game: PlayerGameView; busy: boolean; onRematch: (response: "REQUEST" | "ACCEPT") => Promise<void> }) {
  const result = game.gameResult;
  if (!result) return null;
  return <ResultOverlay title="Match complete" kicker="A fine game">
    <div className="match-winner"><span>Winner</span><strong>{result.winnerName}</strong><small>First to {result.matchTarget}</small></div>
    <MatchScores scores={result.finalScores} />
    <section className="hand-history" aria-labelledby="hand-history-title"><h2 id="hand-history-title">Hand history</h2>{result.completedHands.map((hand) => <div key={hand.handNumber}><span>Hand {hand.handNumber}</span><strong>{hand.kind === "CANCELLED" ? "No score" : `${hand.winnerName} +${hand.pointsAwarded}`}</strong><small>{hand.kind === "CANCELLED" ? "Stock exhausted" : hand.scoringReason === "GIN" ? "Gin" : hand.scoringReason === "UNDERCUT" ? "Undercut" : "Knock"}</small></div>)}</section>
    {!game.rematch && <button className="action-button primary result-primary" onClick={() => void onRematch("REQUEST")} disabled={busy}>Request rematch</button>}
    {game.rematch?.requestedBy === "YOU" && <p className="waiting-status"><i /> Rematch requested — waiting for your opponent</p>}
    {game.rematch?.requestedBy === "OPPONENT" && <button className="action-button primary result-primary" onClick={() => void onRematch("ACCEPT")} disabled={busy}>Accept rematch</button>}
    <Link className="quiet-link" href="/">Return home</Link>
  </ResultOverlay>;
}
function ResultOverlay({ title, kicker, children }: { title: string; kicker: string; children: React.ReactNode }) {
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
  return <section className="result-backdrop"><div ref={panel} className="result-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="result-handle" aria-hidden="true" /><p className="eyebrow">{kicker}</p><h1 ref={titleRef} id={titleId} tabIndex={-1}>{title}</h1>{children}</div></section>;
}
function RevealedHand({ player }: { player: RevealedPlayerHandView }) { return <article className="revealed-hand"><h2>{player.displayName}</h2><ResultCards cards={player.revealedHand} /><dl className="hand-breakdown"><div><dt>Melds</dt><dd>{player.melds.length ? player.melds.map((meld, index) => <span className="result-meld" key={index}><Meld cards={meld.cards} kind={meld.kind} /></span>) : "None"}</dd></div><div><dt>Original deadwood</dt><dd><CardMarks cards={player.originalDeadwoodCards} empty="None" /> <b>{player.originalDeadwoodValue} pts</b></dd></div>{player.layoffs.length > 0 && <div><dt>Layoffs</dt><dd>{player.layoffs.map((layoff) => <span className="result-layoff" key={layoff.card.id}><CardMark card={layoff.card} /> onto <Meld cards={layoff.resultingMeld.cards} kind={layoff.resultingMeld.kind} /></span>)}</dd></div>}<div><dt>Final deadwood</dt><dd><CardMarks cards={player.finalDeadwoodCards} empty="None" /> <b>{player.finalDeadwoodValue} pts</b></dd></div></dl></article>; }
function ResultCards({ cards }: { cards: readonly PublicCard[] }) { return <div className="result-cards">{cards.map((card) => <span className="mini-card" role="img" aria-label={cardLabel(card)} key={card.id}><CardFace card={card} /></span>)}</div>; }
function CardMarks({ cards, empty }: { cards: readonly PublicCard[]; empty: string }) { return <>{cards.length ? cards.map((card) => <CardMark card={card} key={card.id} />) : empty}</>; }
function Readiness({ readiness, opponentName }: { readiness: PlayerGameView["nextHandReadiness"]; opponentName: string }) { return <div className="readiness" aria-label="Next hand readiness"><span className={readiness?.you ? "is-ready" : ""}>You {readiness?.you ? "ready" : "reviewing"}</span><span className={readiness?.opponent ? "is-ready" : ""}>{opponentName} {readiness?.opponent ? "ready" : "reviewing"}</span></div>; }
function MatchScores({ scores }: { scores: readonly HandScoreView[] }) { return <section className="match-scores" aria-label="Match score">{scores.map((score) => <div key={score.playerId}><span>{score.displayName}</span><strong>{score.score}</strong></div>)}</section>; }
function scoreFormula(result: Extract<HandResultView, { kind: "SCORED" }>, declarer: RevealedPlayerHandView, opponent: RevealedPlayerHandView, game: PlayerGameView) { if (result.scoringReason === "KNOCK") return `${opponent.finalDeadwoodValue} − ${declarer.originalDeadwoodValue} = ${result.pointsAwarded}`; if (result.scoringReason === "UNDERCUT") return `${declarer.originalDeadwoodValue} − ${opponent.finalDeadwoodValue} + ${game.rules.undercutBonus} = ${result.pointsAwarded}`; return `${opponent.originalDeadwoodValue} + ${game.rules.ginBonus} = ${result.pointsAwarded}`; }
function turnInstruction(game: PlayerGameView, selected?: PublicCard, selectedActions?: ReturnType<typeof selectedDiscardActionAvailability>) { if (game.phase === "OPENING_NON_DEALER" || game.phase === "OPENING_DEALER") return game.legalControls.length ? "Take the up-card or pass" : "Considering the up-card"; if (game.phase === "AWAITING_DRAW") return game.legalControls.length ? "Draw a card" : "Choosing a draw"; if (game.phase === "AWAITING_DISCARD") { if (!game.legalControls.length) return "Choosing a discard"; if (selectedActions?.isProhibitedDiscard) return "Choose another card"; if (selectedActions?.canGin) return "You can Gin!"; if (selectedActions?.canKnock) return "Discard or knock"; return selected ? "Discard the selected card" : "Choose a card to discard"; } return "Review the hand result"; }
function initials(value: string) { return value.slice(0, 2).toUpperCase(); }
function Meld({ kind, cards }: Pick<PublicMeld, "kind" | "cards">) { return <>{kind === "RUN" ? "Run" : "Set"}: {cards.map((card) => <CardMark card={card} key={card.id} />)}</>; }
function actionMessage(cause: unknown) { if (!(cause instanceof Error)) return "Action failed. Please try again."; if (cause.message === "STALE_VERSION") return "The game changed. The latest state has been loaded."; if (cause.message === "WRONG_PLAYER") return "It is not your turn."; if (cause.message === "KNOCK_DEADWOOD_TOO_HIGH") return "That hand cannot knock yet."; if (cause.message === "GIN_REQUIRES_ZERO_DEADWOOD") return "Gin requires zero deadwood."; return "That action is not available right now."; }

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
