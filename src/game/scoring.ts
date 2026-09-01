import { sortCards } from "./cards";
import { analyzeHand } from "./hand-analysis";
import { optimizeLayoffs } from "./layoffs";
import type {
  Card, GameRules, PlayerHandResult, PlayerId, PlayerState, ScoredHandResult,
} from "./types";

const scoresRecord = (players: readonly PlayerState[]): Readonly<Record<PlayerId, number>> =>
  Object.fromEntries(players.map((player) => [player.id, player.matchScore])) as Readonly<Record<PlayerId, number>>;

export interface ScoreDeclarationInput {
  readonly handNumber: number;
  readonly dealerId: PlayerId;
  readonly declaration: "KNOCK" | "GIN";
  readonly declarerId: PlayerId;
  readonly finalDiscard: Card;
  readonly players: readonly [PlayerState, PlayerState];
  readonly rules: GameRules;
}

export interface ScoreDeclarationOutput {
  readonly result: ScoredHandResult;
  readonly players: readonly [PlayerState, PlayerState];
}

export function scoreDeclaration(input: ScoreDeclarationInput): ScoreDeclarationOutput {
  const declarer = input.players.find((player) => player.id === input.declarerId)!;
  const opponent = input.players.find((player) => player.id !== input.declarerId)!;
  const declarerAnalysis = analyzeHand(declarer.hand);
  const opponentAnalysis = analyzeHand(opponent.hand);
  const layoff = input.declaration === "KNOCK" ? optimizeLayoffs(opponent.hand, declarerAnalysis.melds) : null;
  const opponentFinalCards = layoff?.finalDeadwoodCards ?? opponentAnalysis.deadwoodCards;
  const opponentFinalValue = layoff?.finalDeadwoodValue ?? opponentAnalysis.deadwoodValue;

  let winnerId: PlayerId;
  let pointsAwarded: number;
  let scoringReason: ScoredHandResult["scoringReason"];
  if (input.declaration === "GIN") {
    winnerId = declarer.id;
    pointsAwarded = opponentAnalysis.deadwoodValue + input.rules.ginBonus;
    scoringReason = "GIN";
  } else if (declarerAnalysis.deadwoodValue < opponentFinalValue) {
    winnerId = declarer.id;
    pointsAwarded = opponentFinalValue - declarerAnalysis.deadwoodValue;
    scoringReason = "KNOCK";
  } else {
    winnerId = opponent.id;
    pointsAwarded = declarerAnalysis.deadwoodValue - opponentFinalValue + input.rules.undercutBonus;
    scoringReason = "UNDERCUT";
  }
  const scoresBefore = scoresRecord(input.players);
  const updatedPlayers = input.players.map((player) => player.id === winnerId
    ? { ...player, matchScore: player.matchScore + pointsAwarded }
    : player) as unknown as readonly [PlayerState, PlayerState];
  const playerResults = input.players.map((player): PlayerHandResult => {
    const isDeclarer = player.id === declarer.id;
    const analysis = isDeclarer ? declarerAnalysis : opponentAnalysis;
    return {
      playerId: player.id,
      revealedHand: sortCards(player.hand),
      melds: analysis.melds,
      originalDeadwoodCards: analysis.deadwoodCards,
      originalDeadwoodValue: analysis.deadwoodValue,
      layoffs: isDeclarer ? [] : (layoff?.layoffs ?? []),
      finalDeadwoodCards: isDeclarer ? analysis.deadwoodCards : opponentFinalCards,
      finalDeadwoodValue: isDeclarer ? analysis.deadwoodValue : opponentFinalValue,
    };
  }) as unknown as readonly [PlayerHandResult, PlayerHandResult];
  return {
    players: updatedPlayers,
    result: {
      kind: "SCORED",
      handNumber: input.handNumber,
      dealerId: input.dealerId,
      declaration: input.declaration,
      declarerId: input.declarerId,
      finalDiscard: input.finalDiscard,
      players: playerResults,
      winnerId,
      scoringReason,
      pointsAwarded,
      scoresBefore,
      scoresAfter: scoresRecord(updatedPlayers),
    },
  };
}
