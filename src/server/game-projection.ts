import { analyzeHand, generateCandidateMelds, type Card, type GameResult, type GameState, type HandResult, type Meld, type PlayerHandResult } from "@/src/game";
import type {
  CompletedHandSummaryView, DiscardOutcomeView, GameResultView, HandResultView, HandScoreView, LegalControl,
  PlayerGameView, PublicCard, PublicLayoff, PublicMeld, RevealedPlayerHandView,
} from "@/src/shared/game-view";

export type PlayerSnapshot = { readonly userId: string; readonly seat: 0 | 1; readonly displayName: string };

function controls(state: GameState, userId: string): readonly LegalControl[] {
  if (state.phase === "OPENING_NON_DEALER" || state.phase === "OPENING_DEALER") return state.currentPlayerId === userId ? ["PASS_INITIAL_UPCARD", "TAKE_INITIAL_UPCARD"] : [];
  if (state.phase === "AWAITING_DRAW") return state.currentPlayerId === userId ? (state.drawRestriction === "STOCK_ONLY_AFTER_OPENING_PASSES" ? ["DRAW_STOCK"] : ["DRAW_STOCK", "DRAW_DISCARD"]) : [];
  if (state.phase === "AWAITING_DISCARD" && state.currentPlayerId === userId) return ["DISCARD", "KNOCK", "GIN"];
  if (state.phase === "HAND_COMPLETE" && !state.nextHandAcknowledgements.includes(userId as never)) return ["START_NEXT_HAND"];
  return [];
}

function status(state: GameState): PlayerGameView["status"] {
  if (state.phase === "WAITING_FOR_PLAYER") return "WAITING";
  if (state.phase === "GAME_COMPLETE") return "COMPLETE";
  if (state.phase === "HAND_COMPLETE") return "HAND_COMPLETE";
  return "PLAYING";
}

const publicCard = (card: Card): PublicCard => card;
const publicMeld = (meld: Meld): PublicMeld => ({ kind: meld.kind, cards: meld.cards.map(publicCard) });
const publicLayoff = (layoff: PlayerHandResult["layoffs"][number]): PublicLayoff => ({
  card: publicCard(layoff.card), resultingMeld: publicMeld(layoff.resultingMeld),
});
function pair<T>(items: readonly T[]): readonly [T, T] {
  if (items.length !== 2) throw new Error("A hand result must contain two players.");
  return [items[0]!, items[1]!];
}

function projectHandResult(result: HandResult, snapshots: readonly PlayerSnapshot[]): HandResultView {
  const nameFor = (playerId: string) => snapshots.find((snapshot) => snapshot.userId === playerId)?.displayName ?? "Player";
  const scoresAfter = result.kind === "SCORED"
    ? result.players.map((player): HandScoreView => ({ playerId: player.playerId, displayName: nameFor(player.playerId), score: result.scoresAfter[player.playerId] }))
    : Object.entries(result.scoresAfter).map(([playerId, score]): HandScoreView => ({ playerId, displayName: nameFor(playerId), score }));
  if (result.kind === "CANCELLED") {
    return {
      kind: "CANCELLED", handNumber: result.handNumber, reason: result.reason, pointsAwarded: result.pointsAwarded,
      scoresAfter: pair(scoresAfter),
    };
  }
  const players = result.players.map((player): RevealedPlayerHandView => ({
    playerId: player.playerId, displayName: nameFor(player.playerId), revealedHand: player.revealedHand.map(publicCard),
    melds: player.melds.map(publicMeld), originalDeadwoodCards: player.originalDeadwoodCards.map(publicCard),
    originalDeadwoodValue: player.originalDeadwoodValue, layoffs: player.layoffs.map(publicLayoff),
    finalDeadwoodCards: player.finalDeadwoodCards.map(publicCard), finalDeadwoodValue: player.finalDeadwoodValue,
  }));
  return {
    kind: "SCORED", handNumber: result.handNumber, declaration: result.declaration,
    declarerId: result.declarerId, declarerName: nameFor(result.declarerId),
    winnerId: result.winnerId, winnerName: nameFor(result.winnerId), scoringReason: result.scoringReason,
    pointsAwarded: result.pointsAwarded,
    players: pair(players), scoresAfter: pair(scoresAfter),
  };
}

function projectGameResult(result: GameResult, snapshots: readonly PlayerSnapshot[]): GameResultView {
  const nameFor = (playerId: string) => snapshots.find((snapshot) => snapshot.userId === playerId)?.displayName ?? "Player";
  const finalScores = Object.entries(result.finalScores).map(([playerId, score]): HandScoreView => ({
    playerId,
    displayName: nameFor(playerId),
    score,
  }));
  const completedHands = result.completedHands.map((hand): CompletedHandSummaryView => hand.kind === "CANCELLED" ? {
    kind: "CANCELLED",
    handNumber: hand.handNumber,
    pointsAwarded: 0,
  } : {
    kind: "SCORED",
    handNumber: hand.handNumber,
    declaration: hand.declaration,
    winnerId: hand.winnerId,
    winnerName: nameFor(hand.winnerId),
    scoringReason: hand.scoringReason,
    pointsAwarded: hand.pointsAwarded,
  });
  return {
    winnerId: result.winnerId,
    winnerName: nameFor(result.winnerId),
    finalScores: pair(finalScores),
    matchTarget: result.matchTarget,
    completedHands,
  };
}

/** The sole GameState-to-browser serializer. Do not add canonical fields here. */
export function projectGameState(state: GameState, userId: string, snapshots: readonly PlayerSnapshot[], rematchRequestedBy?: string | null): PlayerGameView {
  const player = state.players.find((item) => item.id === userId);
  const self = snapshots.find((item) => item.userId === userId);
  if (!player || !self) throw new Error("Projection requested for a non-player.");
  const other = state.players.find((item) => item.id !== userId);
  const otherSnapshot = snapshots.find((item) => item.userId === other?.id);
  const result = state.phase === "HAND_COMPLETE" ? projectHandResult(state.handResult, snapshots) : undefined;
  const gameResult = state.phase === "GAME_COMPLETE" ? projectGameResult(state.gameResult, snapshots) : undefined;
  const meldCandidates = status(state) === "PLAYING" ? generateCandidateMelds(player.hand).map(publicMeld) : undefined;
  const nextHandReadiness = state.phase === "HAND_COMPLETE" ? {
    you: state.nextHandAcknowledgements.includes(userId as never),
    opponent: other ? state.nextHandAcknowledgements.includes(other.id) : false,
  } : undefined;
  const turnRestrictions = state.phase === "AWAITING_DISCARD"
    && state.currentPlayerId === userId
    && state.forbiddenDiscardId !== null
    ? { cannotDiscardCardId: state.forbiddenDiscardId }
    : undefined;
  const drawnStockCardId = state.phase === "AWAITING_DISCARD"
    && state.currentPlayerId === userId
    && state.drawSource === "STOCK"
    ? state.drawnCardId
    : undefined;
  const discardOutcomes = state.phase === "AWAITING_DISCARD" && state.currentPlayerId === userId
    ? player.hand.flatMap((card): readonly DiscardOutcomeView[] => {
      if (card.id === state.forbiddenDiscardId) return [];
      const deadwoodValue = analyzeHand(player.hand.filter((item) => item.id !== card.id)).deadwoodValue;
      return [{
        cardId: card.id,
        deadwoodValue,
        declaration: deadwoodValue === 0 ? "GIN" : deadwoodValue <= state.rules.knockThreshold ? "KNOCK" : null,
      }];
    })
    : undefined;
  return {
    gameId: state.gameId, version: state.version, status: status(state), phase: state.phase, rules: state.rules,
    you: { seat: self.seat, displayName: self.displayName, score: player.matchScore, hand: player.hand, ...(meldCandidates ? { meldCandidates } : {}) },
    ...(other && otherSnapshot ? { opponent: { seat: otherSnapshot.seat, displayName: otherSnapshot.displayName, score: other.matchScore, cardCount: other.hand.length } } : {}),
    dealerId: state.dealerId, ...("currentPlayerId" in state ? { currentPlayerId: state.currentPlayerId } : {}),
    stockCount: state.stock.length, discardPile: state.discardPile,
    ...("initialUpcard" in state ? { initialUpcard: state.initialUpcard } : {}), legalControls: controls(state, userId),
    ...(turnRestrictions ? { turnRestrictions } : {}),
    ...(drawnStockCardId ? { drawnStockCardId } : {}),
    ...(discardOutcomes ? { discardOutcomes } : {}),
    ...(result ? { handResult: result } : {}),
    ...(nextHandReadiness ? { nextHandReadiness } : {}),
    ...(gameResult ? { gameResult } : {}),
    ...(rematchRequestedBy ? { rematch: { requestedBy: rematchRequestedBy === userId ? "YOU" : "OPPONENT" } } : {}),
  };
}
