import type { GameState } from "@/src/game";
import type { PlayerGameView, LegalControl } from "@/src/shared/game-view";

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

/** The sole GameState-to-browser serializer. Do not add canonical fields here. */
export function projectGameState(state: GameState, userId: string, snapshots: readonly PlayerSnapshot[]): PlayerGameView {
  const player = state.players.find((item) => item.id === userId);
  const self = snapshots.find((item) => item.userId === userId);
  if (!player || !self) throw new Error("Projection requested for a non-player.");
  const other = state.players.find((item) => item.id !== userId);
  const otherSnapshot = snapshots.find((item) => item.userId === other?.id);
  const result = state.phase === "HAND_COMPLETE" ? state.handResult : undefined;
  const gameResult = state.phase === "GAME_COMPLETE" ? state.gameResult : undefined;
  return {
    gameId: state.gameId, version: state.version, status: status(state), phase: state.phase, rules: state.rules,
    you: { seat: self.seat, displayName: self.displayName, score: player.matchScore, hand: player.hand },
    ...(other && otherSnapshot ? { opponent: { seat: otherSnapshot.seat, displayName: otherSnapshot.displayName, score: other.matchScore, cardCount: other.hand.length } } : {}),
    dealerId: state.dealerId, ...("currentPlayerId" in state ? { currentPlayerId: state.currentPlayerId } : {}),
    stockCount: state.stock.length, discardPile: state.discardPile,
    ...("initialUpcard" in state ? { initialUpcard: state.initialUpcard } : {}), legalControls: controls(state, userId),
    ...(result ? { handResult: result } : {}), ...(gameResult ? { gameResult } : {}),
  };
}
