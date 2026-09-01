import { sortCards } from "./cards";
import { dealHand, validateDealPlan } from "./deal";
import { analyzeHand } from "./hand-analysis";
import { otherPlayer, validateGameState } from "./invariants";
import { scoreDeclaration } from "./scoring";
import type {
  ApplyActionResult, AwaitingDiscardState, CancelledHandResult, GameAction, GameError,
  GameErrorCode, GameEvent, GameResult, GameState, HandCompleteState, PlayerId, PlayerState,
} from "./types";

const PUBLIC = { kind: "PUBLIC" } as const;
type PendingEvent = GameEvent extends infer Event
  ? Event extends GameEvent ? Omit<Event, "stateVersion"> : never
  : never;

const messages: Record<GameErrorCode, string> = {
  INVALID_STATE: "Game state is invalid.", INVALID_RULES: "Game rules are invalid.", INVALID_DEAL_PLAN: "Deal plan is invalid.",
  DUPLICATE_CARD: "A card appears more than once.", MALFORMED_CARD: "A card is malformed.", STALE_VERSION: "The game state has changed.",
  UNKNOWN_PLAYER: "The player is not in this game.", WRONG_PLAYER: "It is not this player's turn.", ACTION_NOT_ALLOWED_IN_PHASE: "That action is not allowed now.",
  STOCK_DRAW_REQUIRED: "The opening passes require a stock draw.", CARD_NOT_IN_HAND: "The selected card is not in the player's hand.",
  ILLEGAL_REDISCARD: "The just-drawn discard cannot be discarded this turn.", STOCK_UNAVAILABLE: "The stock cannot be drawn.",
  KNOCK_DEADWOOD_TOO_HIGH: "Deadwood is too high to knock.", GIN_ACTION_REQUIRED: "A zero-deadwood hand must declare gin.",
  GIN_REQUIRES_ZERO_DEADWOOD: "Gin requires zero deadwood.", NEXT_HAND_ALREADY_ACKNOWLEDGED: "This player already acknowledged the next hand.",
  NEXT_HAND_DEAL_PLAN_REQUIRED: "A deal plan is required to start the next hand.", UNEXPECTED_DEAL_PLAN: "A deal plan was not expected.",
  GAME_ALREADY_COMPLETE: "The game is already complete.",
};

function failure(state: Pick<GameState, "version">, code: GameErrorCode, details?: GameError["details"]): ApplyActionResult {
  return { ok: false, error: { code, message: messages[code], currentVersion: Number.isInteger(state.version) ? state.version : 0, ...(details ? { details } : {}) } };
}

function success(nextState: GameState, events: readonly PendingEvent[]): ApplyActionResult {
  return { ok: true, nextState, events: events.map((event) => ({ ...event, stateVersion: nextState.version } as GameEvent)) };
}

function allowed(state: GameState, action: GameAction): GameErrorCode | null {
  if (state.phase === "GAME_COMPLETE") return "GAME_ALREADY_COMPLETE";
  const byPhase: Record<Exclude<GameState["phase"], "GAME_COMPLETE">, readonly GameAction["type"][]> = {
    WAITING_FOR_PLAYER: ["START_GAME"], OPENING_NON_DEALER: ["PASS_INITIAL_UPCARD", "TAKE_INITIAL_UPCARD"],
    OPENING_DEALER: ["PASS_INITIAL_UPCARD", "TAKE_INITIAL_UPCARD"], AWAITING_DRAW: ["DRAW_STOCK", "DRAW_DISCARD"],
    AWAITING_DISCARD: ["DISCARD", "KNOCK", "GIN"], HAND_COMPLETE: ["START_NEXT_HAND"],
  };
  return byPhase[state.phase].includes(action.type) ? null : "ACTION_NOT_ALLOWED_IN_PHASE";
}

function actorError(state: GameState, action: GameAction): GameErrorCode | null {
  if (action.type === "START_GAME") return null;
  if (!state.players.some((player) => player.id === action.actorId)) return "UNKNOWN_PLAYER";
  if ((state.phase === "OPENING_NON_DEALER" || state.phase === "OPENING_DEALER"
    || state.phase === "AWAITING_DRAW" || state.phase === "AWAITING_DISCARD")
    && state.currentPlayerId !== action.actorId) return "WRONG_PLAYER";
  return null;
}

function replaceHand(players: readonly [PlayerState, PlayerState], playerId: PlayerId, hand: PlayerState["hand"]): readonly [PlayerState, PlayerState] {
  return players.map((player) => player.id === playerId ? { ...player, hand: sortCards(hand) } : player) as unknown as readonly [PlayerState, PlayerState];
}

function scores(players: readonly PlayerState[]) {
  return Object.fromEntries(players.map((player) => [player.id, player.matchScore])) as Readonly<Record<PlayerId, number>>;
}

function startGame(state: Extract<GameState, { phase: "WAITING_FOR_PLAYER" }>, action: Extract<GameAction, { type: "START_GAME" }>): ApplyActionResult {
  if (action.opponentId === state.players[0].id) return failure(state, "INVALID_STATE");
  if (!action.dealPlan || !state.players.some((player) => player.id === action.dealPlan.dealerId) && action.dealPlan.dealerId !== action.opponentId) return failure(state, "INVALID_DEAL_PLAN");
  const validation = validateDealPlan(action.dealPlan);
  if (!validation.ok) return failure(state, validation.code);
  const players: readonly [PlayerState, PlayerState] = [state.players[0], { id: action.opponentId, hand: [], matchScore: 0 }];
  const dealt = dealHand(action.dealPlan, players, action.dealPlan.dealerId);
  const nonDealer = otherPlayer(dealt.players, action.dealPlan.dealerId);
  const nextState: GameState = {
    ...state, phase: "OPENING_NON_DEALER", version: state.version + 1, players: dealt.players, handNumber: 1,
    dealerId: action.dealPlan.dealerId, stock: dealt.stock, discardPile: dealt.discardPile, initialUpcard: dealt.initialUpcard,
    currentPlayerId: nonDealer,
  };
  return success(nextState, [
    { type: "GAME_STARTED", dealerId: nextState.dealerId, visibility: PUBLIC },
    { type: "HAND_STARTED", handNumber: 1, dealerId: nextState.dealerId, visibility: PUBLIC },
    { type: "INITIAL_UPCARD_REVEALED", card: nextState.initialUpcard, visibility: PUBLIC },
  ]);
}

function opening(state: Extract<GameState, { phase: "OPENING_NON_DEALER" | "OPENING_DEALER" }>, action: Extract<GameAction, { type: "PASS_INITIAL_UPCARD" | "TAKE_INITIAL_UPCARD" }>): ApplyActionResult {
  if (action.type === "PASS_INITIAL_UPCARD") {
    if (state.phase === "OPENING_NON_DEALER") {
      const nextState: GameState = { ...state, phase: "OPENING_DEALER", version: state.version + 1, currentPlayerId: state.dealerId, nonDealerPassed: true };
      return success(nextState, [{ type: "INITIAL_UPCARD_PASSED", playerId: action.actorId, visibility: PUBLIC }]);
    }
    const nextState: GameState = { gameId: state.gameId, version: state.version + 1, rules: state.rules, players: state.players,
      handNumber: state.handNumber, dealerId: state.dealerId, stock: state.stock, discardPile: state.discardPile, handHistory: state.handHistory,
      phase: "AWAITING_DRAW", currentPlayerId: otherPlayer(state.players, state.dealerId), drawRestriction: "STOCK_ONLY_AFTER_OPENING_PASSES" };
    return success(nextState, [{ type: "INITIAL_UPCARD_PASSED", playerId: action.actorId, visibility: PUBLIC }]);
  }
  const card = state.discardPile[0]!;
  const player = state.players.find((item) => item.id === action.actorId)!;
  const nextState: AwaitingDiscardState = {
    gameId: state.gameId, version: state.version + 1, rules: state.rules, players: replaceHand(state.players, action.actorId, [...player.hand, card]),
    handNumber: state.handNumber, dealerId: state.dealerId, stock: state.stock, discardPile: state.discardPile.slice(1), handHistory: state.handHistory,
    phase: "AWAITING_DISCARD", currentPlayerId: action.actorId, drawSource: "INITIAL_UPCARD", forbiddenDiscardId: card.id,
  };
  return success(nextState, [{ type: "INITIAL_UPCARD_TAKEN", playerId: action.actorId, card, visibility: PUBLIC }]);
}

function draw(state: Extract<GameState, { phase: "AWAITING_DRAW" }>, action: Extract<GameAction, { type: "DRAW_STOCK" | "DRAW_DISCARD" }>): ApplyActionResult {
  if (action.type === "DRAW_DISCARD") {
    if (state.drawRestriction === "STOCK_ONLY_AFTER_OPENING_PASSES") return failure(state, "STOCK_DRAW_REQUIRED");
    const card = state.discardPile[0]!;
    const player = state.players.find((item) => item.id === action.actorId)!;
    const nextState: AwaitingDiscardState = { gameId: state.gameId, version: state.version + 1, rules: state.rules,
      players: replaceHand(state.players, action.actorId, [...player.hand, card]), handNumber: state.handNumber, dealerId: state.dealerId,
      stock: state.stock, discardPile: state.discardPile.slice(1), handHistory: state.handHistory, phase: "AWAITING_DISCARD",
      currentPlayerId: state.currentPlayerId, drawSource: "DISCARD", forbiddenDiscardId: card.id };
    return success(nextState, [{ type: "DISCARD_DRAWN", playerId: action.actorId, card, visibility: PUBLIC }]);
  }
  if (state.stock.length < 3) return failure(state, "STOCK_UNAVAILABLE");
  const card = state.stock[0]!;
  const player = state.players.find((item) => item.id === action.actorId)!;
  const nextPlayers = replaceHand(state.players, action.actorId, [...player.hand, card]);
  const nextStock = state.stock.slice(1);
  const events: PendingEvent[] = [
    { type: "STOCK_DRAWN", playerId: action.actorId, stockCount: nextStock.length, visibility: PUBLIC },
    { type: "PRIVATE_STOCK_CARD_RECEIVED", playerId: action.actorId, card, visibility: { kind: "PLAYER", playerId: action.actorId } },
  ];
  if (nextStock.length === 2) {
    const result: CancelledHandResult = { kind: "CANCELLED", handNumber: state.handNumber, dealerId: state.dealerId, reason: "STOCK_REDUCED_TO_TWO", pointsAwarded: 0, scoresAfter: scores(nextPlayers) };
    const nextState: HandCompleteState = { gameId: state.gameId, phase: "HAND_COMPLETE", version: state.version + 1, rules: state.rules,
      players: nextPlayers, handNumber: state.handNumber, dealerId: state.dealerId, stock: nextStock, discardPile: state.discardPile,
      handHistory: [...state.handHistory, result], handResult: result, nextHandAcknowledgements: [] };
    return success(nextState, [...events, { type: "HAND_CANCELLED", result, visibility: PUBLIC }]);
  }
  const nextState: AwaitingDiscardState = { gameId: state.gameId, phase: "AWAITING_DISCARD", version: state.version + 1, rules: state.rules,
    players: nextPlayers, handNumber: state.handNumber, dealerId: state.dealerId, stock: nextStock, discardPile: state.discardPile,
    handHistory: state.handHistory, currentPlayerId: state.currentPlayerId, drawSource: "STOCK", forbiddenDiscardId: null };
  return success(nextState, events);
}

function discardOrDeclare(state: Extract<GameState, { phase: "AWAITING_DISCARD" }>, action: Extract<GameAction, { type: "DISCARD" | "KNOCK" | "GIN" }>): ApplyActionResult {
  const selectedId = action.type === "DISCARD" ? action.cardId : action.discardCardId;
  const player = state.players.find((item) => item.id === action.actorId)!;
  const card = player.hand.find((item) => item.id === selectedId);
  if (!card) return failure(state, "CARD_NOT_IN_HAND");
  if (state.forbiddenDiscardId === selectedId) return failure(state, "ILLEGAL_REDISCARD");
  const hand = player.hand.filter((item) => item.id !== selectedId);
  const nextPlayers = replaceHand(state.players, action.actorId, hand);
  const nextDiscard = [card, ...state.discardPile];
  if (action.type === "DISCARD") {
    const nextState: GameState = { gameId: state.gameId, phase: "AWAITING_DRAW", version: state.version + 1, rules: state.rules,
      players: nextPlayers, handNumber: state.handNumber, dealerId: state.dealerId, stock: state.stock, discardPile: nextDiscard,
      handHistory: state.handHistory, currentPlayerId: otherPlayer(state.players, action.actorId), drawRestriction: "EITHER_PILE" };
    return success(nextState, [{ type: "CARD_DISCARDED", playerId: action.actorId, card, visibility: PUBLIC }]);
  }
  const analysis = analyzeHand(hand);
  if (action.type === "KNOCK" && analysis.deadwoodValue === 0) return failure(state, "GIN_ACTION_REQUIRED");
  if (action.type === "KNOCK" && analysis.deadwoodValue > state.rules.knockThreshold) return failure(state, "KNOCK_DEADWOOD_TOO_HIGH", { deadwoodValue: analysis.deadwoodValue, knockThreshold: state.rules.knockThreshold });
  if (action.type === "GIN" && analysis.deadwoodValue !== 0) return failure(state, "GIN_REQUIRES_ZERO_DEADWOOD", { deadwoodValue: analysis.deadwoodValue });
  const scored = scoreDeclaration({ handNumber: state.handNumber, dealerId: state.dealerId, declaration: action.type, declarerId: action.actorId,
    finalDiscard: card, players: nextPlayers, rules: state.rules });
  const history = [...state.handHistory, scored.result];
  const completed = scored.players.find((item) => item.id === scored.result.winnerId)!.matchScore >= state.rules.matchTarget;
  const base = { gameId: state.gameId, version: state.version + 1, rules: state.rules, players: scored.players, handNumber: state.handNumber,
    dealerId: state.dealerId, stock: state.stock, discardPile: nextDiscard, handHistory: history };
  const events: PendingEvent[] = [
    { type: "CARD_DISCARDED", playerId: action.actorId, card, visibility: PUBLIC },
    { type: "HAND_COMPLETED", result: scored.result, visibility: PUBLIC },
  ];
  if (completed) {
    const loserId = otherPlayer(scored.players, scored.result.winnerId);
    const result: GameResult = { winnerId: scored.result.winnerId, loserId, finalScores: scores(scored.players), matchTarget: state.rules.matchTarget, completedHands: history };
    const nextState: GameState = { ...base, phase: "GAME_COMPLETE", gameResult: result };
    return success(nextState, [...events, { type: "GAME_COMPLETED", result, visibility: PUBLIC }]);
  }
  const nextState: GameState = { ...base, phase: "HAND_COMPLETE", handResult: scored.result, nextHandAcknowledgements: [] };
  return success(nextState, events);
}

function nextHand(state: Extract<GameState, { phase: "HAND_COMPLETE" }>, action: Extract<GameAction, { type: "START_NEXT_HAND" }>): ApplyActionResult {
  if (state.nextHandAcknowledgements.includes(action.actorId)) return failure(state, "NEXT_HAND_ALREADY_ACKNOWLEDGED");
  const second = state.nextHandAcknowledgements.length === 1;
  if (!second && action.dealPlan) return failure(state, "UNEXPECTED_DEAL_PLAN");
  if (!second) {
    const nextState: GameState = { ...state, version: state.version + 1, nextHandAcknowledgements: [action.actorId] };
    return success(nextState, [{ type: "NEXT_HAND_ACKNOWLEDGED", playerId: action.actorId, visibility: PUBLIC }]);
  }
  if (!action.dealPlan) return failure(state, "NEXT_HAND_DEAL_PLAN_REQUIRED");
  const validation = validateDealPlan(action.dealPlan);
  if (!validation.ok) return failure(state, validation.code);
  const dealerId = otherPlayer(state.players, state.dealerId);
  const resetPlayers = state.players.map((player) => ({ ...player, hand: [] })) as unknown as readonly [PlayerState, PlayerState];
  const dealt = dealHand(action.dealPlan, resetPlayers, dealerId);
  const handNumber = state.handNumber + 1;
  const nextState: GameState = { gameId: state.gameId, version: state.version + 1, rules: state.rules, players: dealt.players, handNumber,
    dealerId, stock: dealt.stock, discardPile: dealt.discardPile, handHistory: state.handHistory, phase: "OPENING_NON_DEALER",
    initialUpcard: dealt.initialUpcard, currentPlayerId: otherPlayer(dealt.players, dealerId) };
  return success(nextState, [
    { type: "NEXT_HAND_ACKNOWLEDGED", playerId: action.actorId, visibility: PUBLIC },
    { type: "HAND_STARTED", handNumber, dealerId, visibility: PUBLIC },
    { type: "INITIAL_UPCARD_REVEALED", card: dealt.initialUpcard, visibility: PUBLIC },
  ]);
}

export function applyAction(state: GameState, action: GameAction): ApplyActionResult {
  const validation = validateGameState(state);
  if (!validation.ok) return failure(state, validation.code);
  if (!action || action.expectedVersion !== state.version) return failure(state, "STALE_VERSION");
  const actionError = allowed(state, action);
  if (actionError) return failure(state, actionError);
  const playerError = actorError(state, action);
  if (playerError) return failure(state, playerError);
  switch (state.phase) {
    case "WAITING_FOR_PLAYER": return startGame(state, action as Extract<GameAction, { type: "START_GAME" }>);
    case "OPENING_NON_DEALER": case "OPENING_DEALER": return opening(state, action as Extract<GameAction, { type: "PASS_INITIAL_UPCARD" | "TAKE_INITIAL_UPCARD" }>);
    case "AWAITING_DRAW": return draw(state, action as Extract<GameAction, { type: "DRAW_STOCK" | "DRAW_DISCARD" }>);
    case "AWAITING_DISCARD": return discardOrDeclare(state, action as Extract<GameAction, { type: "DISCARD" | "KNOCK" | "GIN" }>);
    case "HAND_COMPLETE": return nextHand(state, action as Extract<GameAction, { type: "START_NEXT_HAND" }>);
    case "GAME_COMPLETE": return failure(state, "GAME_ALREADY_COMPLETE");
  }
}
