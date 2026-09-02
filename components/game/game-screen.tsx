"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ensureAnonymousSession } from "@/lib/supabase/anonymous";
import {
  gameplayControlsAreAvailable, selectedDiscardActionAvailability, type HandResultView,
  type LegalControl, type PlayerGameView, type PublicCard, type PublicMeld, type RevealedPlayerHandView,
} from "@/src/shared/game-view";

type ApiResponse = { game?: PlayerGameView; rematchGameId?: string; error?: { code?: string } };
type RecentGame = { gameId: string; opponent: string; updatedAt: number };

async function jsonRequest(path: string, init?: RequestInit): Promise<{ response: Response; body: ApiResponse }> {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...init?.headers } });
  return { response, body: await response.json().catch(() => ({})) };
}

export function GameScreen({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [game, setGame] = useState<PlayerGameView>();
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

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
    if (!game) return;
    setOrder((current) => {
      const ids = game.you.hand.map((card) => card.id);
      return [...current.filter((id) => ids.includes(id)), ...ids.filter((id) => !current.includes(id))];
    });
    try {
      const prior = JSON.parse(localStorage.getItem("gin-rummy:recent-games") ?? "[]") as RecentGame[];
      const entry: RecentGame = { gameId: game.gameId, opponent: game.opponent?.displayName ?? "Waiting for opponent", updatedAt: Date.now() };
      localStorage.setItem("gin-rummy:recent-games", JSON.stringify([entry, ...prior.filter((item) => item.gameId !== entry.gameId)].slice(0, 4)));
    } catch { /* Recent tables are a convenience, never game state. */ }
  }, [game]);

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
  const sortHand = () => setOrder((current) => [...current].sort((first, second) => cardSortValue(game?.you.hand.find((card) => card.id === first)) - cardSortValue(game?.you.hand.find((card) => card.id === second))));
  const moveCard = (cardId: string, direction: -1 | 1) => setOrder((current) => {
    const from = current.indexOf(cardId); const to = from + direction;
    if (from < 0 || to < 0 || to >= current.length) return current;
    const next = [...current]; [next[from], next[to]] = [next[to]!, next[from]!]; return next;
  });

  if (!game) return <main className="game-shell"><p className="simple-panel" role={error ? "alert" : undefined}>{error || "Preparing your table…"}</p></main>;
  const can = (control: LegalControl) => !busy && game.legalControls.includes(control);
  const discard = game.discardPile[0];
  const selected = game.you.hand.find((card) => card.id === selectedCardId);
  const selectedActions = selectedDiscardActionAvailability(game, selectedCardId);
  const orderedHand = [...game.you.hand].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const youAreActive = game.legalControls.length > 0;

  return <main className="game-shell"><section className="game-table" aria-live="polite">
    <header className="table-header"><Link className="wordmark" href="/">Gin <span>Rummy</span></Link><div className="table-tools"><span className="table-status">Private table</span><Link href="/settings" aria-label="Settings" className="icon-button">⚙</Link></div></header>
    {game.status === "WAITING" ? <WaitingGame inviteUrl={inviteUrl} /> : gameplayControlsAreAvailable(game) ? <>
      <section className="opponent-area" aria-label="Opponent">
        <div className="player-identity opponent-identity"><div className="avatar" aria-hidden="true">{initials(game.opponent?.displayName ?? "?")}</div><div className="identity-copy"><p className="eyebrow">Opponent <span className="connection"><i /> At table</span></p><div className="identity-line"><h1>{game.opponent?.displayName ?? "Opponent"}</h1><span className="identity-score"><span>Score</span>{game.opponent?.score ?? 0}</span></div><p className="seat-note">{game.opponent?.cardCount ?? 0} cards {game.dealerId ? "· Dealer" : ""}</p></div></div>
        <OpponentHand count={game.opponent?.cardCount ?? 0} /><ScoreHud game={game} />
      </section>
      <section className="table-center" aria-label="Public piles and turn status">
        <div className="piles">
          <button className="pile-control stock-pile" disabled={!can("DRAW_STOCK")} onClick={() => void action("DRAW_STOCK")} aria-label={`Draw from stock, ${game.stockCount} cards remaining`}><CardBack /><span><b>Stock</b><em>{game.stockCount} cards</em></span></button>
          <button className="pile-control discard-pile" disabled={!can("DRAW_DISCARD") || !discard} onClick={() => void action("DRAW_DISCARD")} aria-label={discard ? `Take discard ${cardLabel(discard)}` : "Discard pile is empty"}>{discard ? <CardFace card={discard} /> : <span className="empty-card">—</span>}<span><b>Discard</b><em>{discard ? cardLabel(discard) : "Empty"}</em></span></button>
        </div><TurnPrompt game={game} active={youAreActive} />
      </section>
      <section className="player-area" aria-labelledby="your-hand">
        <div className="player-hand-heading"><div className="player-identity"><div className="avatar you-avatar" aria-hidden="true">{initials(game.you.displayName)}</div><div className="identity-copy"><p className="eyebrow">You {youAreActive ? "· Your turn" : "· At the table"}</p><div className="identity-line"><h2 id="your-hand">{game.you.displayName}</h2><span className="identity-score"><span>Score</span>{game.you.score}</span></div></div></div><div className="hand-tools"><span>{game.you.hand.length} cards</span><button className="sort-button" onClick={sortHand}>Sort <span aria-hidden="true">↕</span></button></div></div>
        <CardHand cards={orderedHand} selectedCardId={selectedCardId} canDiscard={can("DISCARD")} restrictedId={game.turnRestrictions?.cannotDiscardCardId} drawnId={game.drawnStockCardId} onSelect={setSelectedCardId} onMove={moveCard} />
        <div className="hand-rail"><span>{game.turnRestrictions?.cannotDiscardCardId ? "Hold card cannot be discarded this turn" : selected ? `Selected: ${cardLabel(selected)}` : "Choose a card after you draw"}</span><span className="rail-help">Shift + arrow keys reorders</span></div>
      </section>
      <GameActions game={game} can={can} busy={busy} discard={discard} selected={selected} selectedActions={selectedActions} onAction={action} />
    </> : game.status === "HAND_COMPLETE" ? <HandCompleteResult game={game} onStartNextHand={() => void action("START_NEXT_HAND")} canStartNextHand={can("START_NEXT_HAND")} /> : <GameResult game={game} busy={busy} onRematch={rematch} />}
    {error && <p role="alert" className="game-error">{error}</p>}
  </section></main>;
}

function OpponentHand({ count }: { count: number }) { return <div className="opponent-hand" aria-label={`Opponent has ${count} cards`}>{Array.from({ length: count }, (_, index) => <span className="opponent-card" style={{ "--card-index": index, "--card-count": count } as CSSProperties} key={index}><CardBack /></span>)}</div>; }
function ScoreHud({ game }: { game: PlayerGameView }) { return <aside className="score-hud" aria-label="Match scores"><p>First to {game.rules.matchTarget}</p><dl><div><dt>You</dt><dd>{game.you.score}</dd></div><div><dt>{game.opponent?.displayName ?? "Opponent"}</dt><dd>{game.opponent?.score ?? 0}</dd></div></dl></aside>; }
function TurnPrompt({ game, active }: { game: PlayerGameView; active: boolean }) { return <div className={`turn-prompt${active ? " is-active" : ""}`}><span className="turn-dot" /><div><strong>{active ? "Your turn" : `${game.opponent?.displayName ?? "Opponent"} is playing`}</strong><p>{prompt(game)}</p></div></div>; }
function GameActions({ can, busy, discard, selected, selectedActions, onAction }: { game: PlayerGameView; can: (control: LegalControl) => boolean; busy: boolean; discard?: PublicCard; selected?: PublicCard; selectedActions: ReturnType<typeof selectedDiscardActionAvailability>; onAction: (type: LegalControl, cardId?: string) => Promise<void> }) {
  const opening = can("PASS_INITIAL_UPCARD") || can("TAKE_INITIAL_UPCARD");
  return <section className="game-actions" aria-label="Game actions">{opening ? <><button className="action-button secondary" disabled={!can("PASS_INITIAL_UPCARD")} onClick={() => void onAction("PASS_INITIAL_UPCARD")}>Pass</button><button className="action-button primary" disabled={!can("TAKE_INITIAL_UPCARD")} onClick={() => void onAction("TAKE_INITIAL_UPCARD")}>Take discard</button></> : <><button className="action-button primary" disabled={!can("DRAW_STOCK")} onClick={() => void onAction("DRAW_STOCK")}>Draw stock</button><button className="action-button wood" disabled={!can("DRAW_DISCARD") || !discard} onClick={() => void onAction("DRAW_DISCARD")}>Take discard</button></>}<button className="action-button muted" disabled={!can("KNOCK") || !selectedActions.canKnock} title="Select a legal discard after drawing" onClick={() => void onAction("KNOCK", selected?.id)}>Knock</button><button className="action-button muted" disabled={!can("GIN") || !selectedActions.canGin} title="Select a legal discard after drawing" onClick={() => void onAction("GIN", selected?.id)}>Gin</button>{can("DISCARD") && <button className="discard-confirm" disabled={busy || !selectedActions.canDiscard} onClick={() => void onAction("DISCARD", selected?.id)}>{selected ? <>Discard <CardMark card={selected} /></> : "Select a card to discard"}</button>}</section>;
}
function CardHand({ cards, selectedCardId, canDiscard, restrictedId, drawnId, onSelect, onMove }: { cards: readonly PublicCard[]; selectedCardId?: string; canDiscard: boolean; restrictedId?: string; drawnId?: string; onSelect: (cardId: string | undefined) => void; onMove: (cardId: string, direction: -1 | 1) => void }) {
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, card: PublicCard, index: number) { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const direction = event.key === "ArrowLeft" ? -1 : 1; if (event.shiftKey) { onMove(card.id, direction); return; } const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[data-hand-card]")[index + direction]; target?.focus(); }
  return <div className={`card-hand cards-${cards.length}`} style={{ "--hand-count": cards.length } as CSSProperties}>{cards.map((card, index) => { const selected = card.id === selectedCardId; const marker = card.id === restrictedId ? "Hold" : card.id === drawnId ? "Drawn" : undefined; return <button data-hand-card key={card.id} className={`playing-card${selected ? " selected-card" : ""}${marker ? " turn-card-indicated" : ""}`} style={{ "--card-index": index } as CSSProperties} aria-label={`${cardLabel(card)}${marker ? `, ${marker.toLowerCase()}` : ""}`} aria-pressed={selected} disabled={!canDiscard} onKeyDown={(event) => keyDown(event, card, index)} onClick={() => onSelect(selected ? undefined : card.id)}><CardFace card={card} marker={marker} /></button>; })}</div>;
}
function CardBack() { return <span className="card-back" aria-hidden="true"><span>R</span></span>; }
function WaitingGame({ inviteUrl }: { inviteUrl: string | null }) { const [copied, setCopied] = useState(false); async function copyInvite() { if (!inviteUrl) return; await navigator.clipboard.writeText(inviteUrl); setCopied(true); } return <section className="waiting-room" aria-labelledby="waiting-title"><div className="waiting-seal">R</div><p className="eyebrow">Private two-player table</p><h1 id="waiting-title">Your table is set.</h1><p>Share this private invitation with one friend. You can safely leave this page and return later.</p>{inviteUrl ? <><label className="invite-field"><span>Invite link</span><code>{inviteUrl}</code></label><button className="action-button primary" onClick={() => void copyInvite()}>{copied ? "Invitation copied" : "Copy invitation"}</button></> : <p className="table-note">Your private invitation is available in the browser that created this table.</p>}<p className="waiting-status" role="status"><i /> Waiting for an opponent to take a seat</p></section>; }
function HandCompleteResult({ game, onStartNextHand, canStartNextHand }: { game: PlayerGameView; onStartNextHand: () => void; canStartNextHand: boolean }) { const result = game.handResult; if (!result) return null; if (result.kind === "CANCELLED") return <ResultOverlay title="Hand over" kicker="No score awarded"><p>The stock reached two cards. Cards were not revealed.</p><MatchScores scores={result.scoresAfter} /><button className="action-button primary" disabled={!canStartNextHand} onClick={onStartNextHand}>{canStartNextHand ? "Start next hand" : "Waiting for opponent"}</button></ResultOverlay>; const declarer = result.players.find((player) => player.playerId === result.declarerId)!; const opponent = result.players.find((player) => player.playerId !== result.declarerId)!; return <ResultOverlay title="Hand over" kicker={`${result.declarerName} ${result.declaration === "KNOCK" ? "knocked" : "went gin"}`}><div className="result-score"><strong>{result.winnerName}</strong><span>+{result.pointsAwarded}</span><small>{scoreFormula(result, declarer, opponent, game)}</small></div><div className="revealed-hands">{result.players.map((player) => <RevealedHand key={player.playerId} player={player} />)}</div><MatchScores scores={result.scoresAfter} /><button className="action-button primary" disabled={!canStartNextHand} onClick={onStartNextHand}>{canStartNextHand ? "Start next hand" : "Waiting for opponent"}</button></ResultOverlay>; }
function GameResult({ game, busy, onRematch }: { game: PlayerGameView; busy: boolean; onRematch: (response: "REQUEST" | "ACCEPT") => Promise<void> }) { return <ResultOverlay title="Match complete" kicker="A fine game"><Result value={game.gameResult} />{!game.rematch && <button className="action-button primary" onClick={() => void onRematch("REQUEST")} disabled={busy}>Request rematch</button>}{game.rematch?.requestedBy === "YOU" && <p className="waiting-status"><i /> Rematch requested — waiting for your opponent</p>}{game.rematch?.requestedBy === "OPPONENT" && <button className="action-button primary" onClick={() => void onRematch("ACCEPT")} disabled={busy}>Accept rematch</button>}<Link className="quiet-link" href="/">Return home</Link></ResultOverlay>; }
function ResultOverlay({ title, kicker, children }: { title: string; kicker: string; children: React.ReactNode }) { return <section className="result-backdrop"><div className="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title"><p className="eyebrow">{kicker}</p><h1 id="result-title">{title}</h1>{children}</div></section>; }
function RevealedHand({ player }: { player: RevealedPlayerHandView }) { return <article className="revealed-hand"><h2>{player.displayName}</h2><div className="result-cards">{player.revealedHand.map((card) => <span className="mini-card" key={card.id}><CardMark card={card} /></span>)}</div><p><b>Melds:</b> {player.melds.length ? player.melds.map((meld, index) => <span key={index}><Meld cards={meld.cards} kind={meld.kind} />{index < player.melds.length - 1 ? " · " : ""}</span>) : "None"}</p><p><b>Deadwood:</b> {player.finalDeadwoodValue}</p>{player.layoffs.length > 0 && <p><b>Layoffs:</b> {player.layoffs.length}</p>}</article>; }
function MatchScores({ scores }: { scores: HandResultView["scoresAfter"] }) { return <section className="match-scores" aria-label="Match score">{scores.map((score) => <div key={score.playerId}><span>{score.displayName}</span><strong>{score.score}</strong></div>)}</section>; }
function scoreFormula(result: Extract<HandResultView, { kind: "SCORED" }>, declarer: RevealedPlayerHandView, opponent: RevealedPlayerHandView, game: PlayerGameView) { if (result.scoringReason === "KNOCK") return `${opponent.finalDeadwoodValue} − ${declarer.originalDeadwoodValue} = ${result.pointsAwarded}`; if (result.scoringReason === "UNDERCUT") return `${declarer.originalDeadwoodValue} − ${opponent.finalDeadwoodValue} + ${game.rules.undercutBonus} = ${result.pointsAwarded}`; return `${opponent.originalDeadwoodValue} + ${game.rules.ginBonus} = ${result.pointsAwarded}`; }
function Result({ value }: { value: unknown }) { if (!value || typeof value !== "object") return <p>The final score has been recorded.</p>; const result = value as { finalScores?: Record<string, number>; matchTarget?: number }; return <p>{result.finalScores ? `Final score: ${Object.values(result.finalScores).join(" – ")}.` : "The final score has been recorded."} {result.matchTarget ? `First to ${result.matchTarget}.` : ""}</p>; }
function prompt(game: PlayerGameView) { if (game.phase === "OPENING_NON_DEALER" || game.phase === "OPENING_DEALER") return game.legalControls.length ? "Take the up-card or pass." : "Considering the up-card"; if (game.phase === "AWAITING_DRAW") return game.legalControls.length ? "Draw a card" : "Choosing a draw"; if (game.phase === "AWAITING_DISCARD") return game.legalControls.length ? "Choose a card to discard" : "Choosing a discard"; return "Review the hand result"; }
function cardLabel(card: PublicCard) { return `${card.rank} of ${card.suit.toLowerCase()}`; }
function cardSortValue(card?: PublicCard) { if (!card) return 999; const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]; const suits = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES"]; return ranks.indexOf(card.rank) * 4 + suits.indexOf(card.suit); }
function initials(value: string) { return value.slice(0, 2).toUpperCase(); }
const SUIT_SYMBOLS: Record<string, string> = { CLUBS: "♣", DIAMONDS: "♦", HEARTS: "♥", SPADES: "♠" };
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
function suitColorClass(card: PublicCard) { return card.suit === "HEARTS" || card.suit === "DIAMONDS" ? "red-suit" : "black-suit"; }
function CardMark({ card }: { card: PublicCard }) { return <span className={`card-mark ${suitColorClass(card)}`} aria-hidden="true"><span>{card.rank}</span><span className="suit-icon">{SUIT_SYMBOLS[card.suit]}</span></span>; }
function CardFace({ card, marker }: { card: PublicCard; marker?: "Hold" | "Drawn" }) { const pips = PIP_LAYOUTS[card.rank]; return <span className={`card-face ${suitColorClass(card)}`} aria-hidden="true"><CardMark card={card} />{marker && <span className="turn-card-badge">{marker}</span>}{pips ? <span className={`card-pips pip-count-${pips.length}`}>{pips.map(([x, y, inverted], index) => <span className={inverted ? "pip-inverted" : undefined} style={{ "--pip-x": `${x}%`, "--pip-y": `${y}%` } as CSSProperties} key={index}>{SUIT_SYMBOLS[card.suit]}</span>)}</span> : <span className="court-card"><b>{card.rank}</b><span>{SUIT_SYMBOLS[card.suit]}</span></span>}<span className="card-mark card-mark-inverted"><span>{card.rank}</span><span className="suit-icon">{SUIT_SYMBOLS[card.suit]}</span></span></span>; }
function Meld({ kind, cards }: Pick<PublicMeld, "kind" | "cards">) { return <>{kind === "RUN" ? "Run" : "Set"}: {cards.map((card) => <CardMark card={card} key={card.id} />)}</>; }
function actionMessage(cause: unknown) { if (!(cause instanceof Error)) return "Action failed. Please try again."; if (cause.message === "STALE_VERSION") return "The game changed. The latest state has been loaded."; if (cause.message === "WRONG_PLAYER") return "It is not your turn."; if (cause.message === "KNOCK_DEADWOOD_TOO_HIGH") return "That hand cannot knock yet."; if (cause.message === "GIN_REQUIRES_ZERO_DEADWOOD") return "Gin requires zero deadwood."; return "That action is not available right now."; }
