# Gin Rummy Game Engine Specification

## Purpose and boundaries

`src/game` is the authoritative rules engine for a two-player Gin Rummy match. It is deterministic, immutable, and written in strict TypeScript. It has no React, Next.js, database, Supabase, network, clock, or ambient-randomness dependencies.

The engine accepts a canonical state and one trusted action and returns either a new canonical state plus domain events, or a typed error. It never partially applies an action and never mutates its inputs.

```ts
type ApplyActionResult =
  | {
      readonly ok: true;
      readonly nextState: GameState;
      readonly events: readonly GameEvent[];
    }
  | {
      readonly ok: false;
      readonly error: GameError;
    };

declare function applyAction(
  state: GameState,
  action: GameAction,
): ApplyActionResult;
```

The server owns authorization, idempotency, persistence, transactions, and projection of canonical state into player-safe views. Browser payloads must be parsed into a client intent, authorized, and converted into a trusted `GameAction` before calling the engine. In particular, a browser must never be allowed to provide a shuffled deck, choose the first dealer, claim a score, or submit resulting state.

The canonical `GameState` contains both hands and the stock order. It must therefore never be serialized directly to a client. A separate server-side projection layer must reveal only the requesting player's hand, the public discard pile, scores, counts, and legitimately revealed hand results. Engine events use explicit visibility for the same reason.

## Card model and notation

The document uses compact card notation such as `A♠`, `10♦`, and `K♣`. Aces are always low. The canonical sort order is rank first (`A` through `K`), then suit (`CLUBS`, `DIAMONDS`, `HEARTS`, `SPADES`). This order is for deterministic output only and has no rules significance.

```ts
export type PlayerId = string & { readonly __brand: "PlayerId" };
export type ActionId = string & { readonly __brand: "ActionId" };

export type Suit = "CLUBS" | "DIAMONDS" | "HEARTS" | "SPADES";

export type Rank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "10" | "J" | "Q" | "K";

export type CardId = string & { readonly __brand: "CardId" };

export interface Card {
  readonly id: CardId;       // canonical value derived from rank and suit
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface Run {
  readonly kind: "RUN";
  readonly suit: Suit;
  readonly cards: readonly [Card, Card, Card, ...Card[]];
}

// This domain name follows Gin Rummy terminology. Use globalThis.Set when the
// implementation needs JavaScript's built-in collection type.
export interface Set {
  readonly kind: "SET";
  readonly rank: Rank;
  readonly cards:
    | readonly [Card, Card, Card]
    | readonly [Card, Card, Card, Card];
}

export type Meld = Run | Set;

export interface GameRules {
  readonly knockThreshold: number; // v1: 10
  readonly ginBonus: number;       // v1: 25
  readonly undercutBonus: number;  // v1: 25
  readonly matchTarget: number;    // v1: 100
}
```

`cardValue` maps ace to 1, number cards to their number, and `J`, `Q`, and `K` to 10. A standard deck contains exactly one card for each of the 52 rank/suit pairs. Validation checks that `id`, `rank`, and `suit` agree; uniqueness is based on rank/suit identity, not merely an arbitrary `id` string.

## State model

Use a discriminated union so phase-specific data is available only in the phase where it is meaningful. Shared fields are shown separately for readability; the implementation should form each state as `GameStateBase & PhaseState`.

```ts
export type GamePhase =
  | "WAITING_FOR_PLAYER"
  | "OPENING_NON_DEALER"
  | "OPENING_DEALER"
  | "AWAITING_DRAW"
  | "AWAITING_DISCARD"
  | "HAND_COMPLETE"
  | "GAME_COMPLETE";

export interface PlayerState {
  readonly id: PlayerId;
  readonly hand: readonly Card[];
  readonly matchScore: number;
}

export interface GameStateBase {
  readonly gameId: string;
  readonly version: number;
  readonly rules: GameRules;
  readonly players: readonly PlayerState[];
  readonly handNumber: number;
  readonly dealerId: PlayerId | null;
  readonly stock: readonly Card[];         // index 0 is the next/top card
  readonly discardPile: readonly Card[];   // index 0 is the visible top
  readonly handHistory: readonly HandResult[];
}

export interface WaitingForPlayerState extends GameStateBase {
  readonly phase: "WAITING_FOR_PLAYER";
  readonly players: readonly [PlayerState];
  readonly handNumber: 0;
  readonly dealerId: null;
  readonly stock: readonly [];
  readonly discardPile: readonly [];
}

export interface OpeningStateBase extends GameStateBase {
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly initialUpcard: Card;
}

export interface OpeningNonDealerState extends OpeningStateBase {
  readonly phase: "OPENING_NON_DEALER";
  readonly currentPlayerId: PlayerId; // necessarily the non-dealer
}

export interface OpeningDealerState extends OpeningStateBase {
  readonly phase: "OPENING_DEALER";
  readonly currentPlayerId: PlayerId; // necessarily the dealer
  readonly nonDealerPassed: true;
}

export interface AwaitingDrawState extends GameStateBase {
  readonly phase: "AWAITING_DRAW";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly currentPlayerId: PlayerId;
  readonly drawRestriction: "EITHER_PILE" | "STOCK_ONLY_AFTER_OPENING_PASSES";
}

export interface AwaitingDiscardState extends GameStateBase {
  readonly phase: "AWAITING_DISCARD";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly currentPlayerId: PlayerId;
  readonly drawSource: "STOCK" | "DISCARD" | "INITIAL_UPCARD";
  readonly forbiddenDiscardId: CardId | null;
}

export interface HandCompleteState extends GameStateBase {
  readonly phase: "HAND_COMPLETE";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly handResult: HandResult;
  readonly nextHandAcknowledgements: readonly PlayerId[];
}

export interface GameCompleteState extends GameStateBase {
  readonly phase: "GAME_COMPLETE";
  readonly players: readonly [PlayerState, PlayerState];
  readonly dealerId: PlayerId;
  readonly gameResult: GameResult;
}

export type GameState =
  | WaitingForPlayerState
  | OpeningNonDealerState
  | OpeningDealerState
  | AwaitingDrawState
  | AwaitingDiscardState
  | HandCompleteState
  | GameCompleteState;
```

The waiting-state constructor accepts validated rules and the creator's player ID. Joining and invite management are application concerns. Once the second seat is authorized, the server dispatches the system-only `START_GAME` action containing both player IDs and a trusted first-hand deal plan.

### State invariants

Validate the entire incoming state before applying an action. A corrupt state returns `INVALID_STATE`, or the more specific `DUPLICATE_CARD`, `MALFORMED_CARD`, or `INVALID_RULES`; it must not throw or attempt repair.

- `version`, hand number, scores, bonuses, thresholds, and target are non-negative integers where applicable; match target is positive.
- Player IDs are unique and phase-appropriate. Active phases contain exactly two players.
- From the first deal onward, every canonical card appears exactly once across both hands, stock, and discard pile. All 52 canonical cards are present.
- The discard pile is non-empty during an active hand.
- Normal opening/draw phases have 10 cards per player. `AWAITING_DISCARD` has 11 for the acting player and 10 for the opponent.
- A cancelled hand may retain 11 cards for the player whose stock draw reduced the stock to two; cards remain hidden and are redealt next hand.
- `currentPlayerId`, dealer, initial up-card, forbidden discard, hand results, scores, and history agree with the phase and card zones.
- An active phase can never have fewer than three stock cards. Reaching two transitions immediately to `HAND_COMPLETE`.
- A `GAME_COMPLETE` winner has reached `matchTarget`; neither player has reached it in `HAND_COMPLETE`.

## Deterministic randomness and dealing

`applyAction` must never call `Math.random`, the clock, Web Crypto, Node crypto, or any other ambient source. Randomness is injected before the transition as a trusted value:

```ts
export interface DealPlan {
  readonly deck: readonly Card[]; // complete shuffled 52-card permutation
}

export interface FirstDealPlan extends DealPlan {
  readonly dealerId: PlayerId;
}

export interface RandomSource {
  nextUint32(): number;
}

declare function shuffledDeck(source: RandomSource): readonly Card[];
```

The server supplies a cryptographically suitable `RandomSource` to `shuffledDeck`; tests supply a fixed sequence. Fisher-Yates must use unbiased bounded sampling rather than `value % bound` directly. The resulting `DealPlan` is placed only on the trusted engine action and is never accepted from a browser or exposed in an event. This keeps the central transition a true function: identical state and action values produce identical output.

The first deal plan also chooses one of the two players as dealer. Later dealers alternate and cannot be supplied by the caller. Every deal plan is validated as an exact 52-card permutation before any state change.

With `deck[0]` as the top/next card, deal one at a time starting with the non-dealer:

```text
for round 0..9:
  non-dealer receives deck[round * 2]
  dealer receives deck[round * 2 + 1]
initial discard = deck[20]
stock = deck[21..51]
```

## Actions

All actions carry a unique `actionId` and an `expectedVersion`. Player actions carry the authenticated actor ID. Idempotency is handled by the server transaction before `applyAction`: an already-recorded `actionId` returns its recorded result; a new action with an old version reaches the engine and returns `STALE_VERSION`.

```ts
interface ActionBase {
  readonly actionId: ActionId;
  readonly expectedVersion: number;
}

interface PlayerActionBase extends ActionBase {
  readonly actorId: PlayerId;
}

export type GameAction =
  | (ActionBase & {
      readonly type: "START_GAME";
      readonly actorId: "SYSTEM";
      readonly opponentId: PlayerId;
      readonly dealPlan: FirstDealPlan;
    })
  | (PlayerActionBase & { readonly type: "PASS_INITIAL_UPCARD" })
  | (PlayerActionBase & { readonly type: "TAKE_INITIAL_UPCARD" })
  | (PlayerActionBase & { readonly type: "DRAW_STOCK" })
  | (PlayerActionBase & { readonly type: "DRAW_DISCARD" })
  | (PlayerActionBase & {
      readonly type: "DISCARD";
      readonly cardId: CardId;
    })
  | (PlayerActionBase & {
      readonly type: "KNOCK";
      readonly discardCardId: CardId;
    })
  | (PlayerActionBase & {
      readonly type: "GIN";
      readonly discardCardId: CardId;
    })
  | (PlayerActionBase & {
      readonly type: "START_NEXT_HAND";
      // Required only when this is the second acknowledgement. The server
      // enriches the trusted action while holding the canonical-state lock.
      readonly dealPlan?: DealPlan;
    });
```

`KNOCK` and `GIN` atomically include the final discard. A player must not first send `DISCARD` and then declare. This avoids an intermediate state in which the turn has already passed.

## Explicit state machine

Every successful action increments `version` by exactly one, even when the phase does not change (the first next-hand acknowledgement). Every failed action returns the original state conceptually, emits no events, and does not increment the version.

| Current phase | Action | Guard | Next phase and effect |
| --- | --- | --- | --- |
| `WAITING_FOR_PLAYER` | `START_GAME` | system action; opponent differs from creator; valid rules and first deal | Deal, expose `deck[20]`, choose dealer from plan, then `OPENING_NON_DEALER`. |
| `OPENING_NON_DEALER` | `TAKE_INITIAL_UPCARD` | actor is non-dealer | Move up-card to actor's hand; `AWAITING_DISCARD`, forbidding that card as the discard. |
| `OPENING_NON_DEALER` | `PASS_INITIAL_UPCARD` | actor is non-dealer | `OPENING_DEALER` with the same up-card untouched. |
| `OPENING_DEALER` | `TAKE_INITIAL_UPCARD` | actor is dealer | Move up-card to actor's hand; `AWAITING_DISCARD`, forbidding that card as the discard. |
| `OPENING_DEALER` | `PASS_INITIAL_UPCARD` | actor is dealer | `AWAITING_DRAW` for non-dealer with `STOCK_ONLY_AFTER_OPENING_PASSES`. |
| `AWAITING_DRAW` | `DRAW_DISCARD` | actor is current player; restriction permits discard | Move visible top discard to hand; `AWAITING_DISCARD`; that exact card is forbidden as the next discard. |
| `AWAITING_DRAW` | `DRAW_STOCK` | actor is current player; stock has at least 3 | Draw top stock. If two stock cards remain, cancel immediately and enter `HAND_COMPLETE`; otherwise enter `AWAITING_DISCARD` with no forbidden discard. |
| `AWAITING_DISCARD` | `DISCARD` | actor is current player; card is in hand and is not forbidden | Move card to top of discard, switch current player, then `AWAITING_DRAW` with `EITHER_PILE`. |
| `AWAITING_DISCARD` | `KNOCK` | legal final discard; resulting optimal deadwood is from 1 through `knockThreshold` | Score ordinary knock. Enter `HAND_COMPLETE`, or `GAME_COMPLETE` if the awarded points reach the target. |
| `AWAITING_DISCARD` | `GIN` | legal final discard; resulting optimal deadwood is exactly 0 | Score gin with no opponent layoff. Enter `HAND_COMPLETE`, or `GAME_COMPLETE` if the target is reached. |
| `HAND_COMPLETE` | `START_NEXT_HAND` | actor has not acknowledged; match is not complete | Record acknowledgement and remain in `HAND_COMPLETE`; after the second acknowledgement, require a valid deal plan, alternate dealer, deal, and enter `OPENING_NON_DEALER`. |
| `GAME_COMPLETE` | any game action | none | Reject with `GAME_ALREADY_COMPLETE`. Rematch creation is outside this engine and creates a new game ID/state. |

There is deliberately no `PASS_INITIAL_UPCARD` after opening, no discard before draw, no second draw, and no standalone declaration after a discard.

### Stock exhaustion

The product rule is interpreted literally: when a legal `DRAW_STOCK` moves the stock count from three to two, the hand is cancelled immediately before the player may discard, knock, or declare gin. No points are awarded, neither hand is exposed in `HandResult`, and the drawn card remains in the canonical hand solely to keep card-zone integrity. Both players acknowledge the cancelled result normally. On the next deal, the dealer alternates.

## Meld and deadwood algorithms

All algorithms operate on immutable card arrays and return cards and melds in canonical order.

### Valid sets

`isValidSet(cards)` returns true exactly when:

- the length is 3 or 4;
- every card has the same rank;
- suits are all distinct; and
- card identities are unique.

### Valid runs

Map ranks to `A=1`, `2=2`, ..., `10=10`, `J=11`, `Q=12`, `K=13`. `isValidRun(cards)` sorts by rank and returns true exactly when:

- length is at least 3;
- every card has the same suit;
- card identities/ranks are unique; and
- every adjacent numeric rank differs by exactly one.

Ace has only value 1. There is no wraparound and no alternate high-ace representation, so `Q-K-A` is invalid.

### Generate every candidate meld

Do not greedily consume a set or run. Generate the complete candidate collection for the hand:

1. Group by rank. For each group of three, emit the three-card set. For each group of four, emit all four distinct three-card subsets and the four-card set.
2. Group by suit and sort by numeric rank. Split each suit into maximal consecutive sequences. For each sequence of length `n >= 3`, emit every contiguous subsequence of every length from 3 through `n`.
3. Deduplicate by canonical meld signature and sort by that signature.

Generating submelds is necessary. For example, a four-card run may need to surrender one end card to another scoring possibility, and a three-card subset of a four-card rank group may coexist with a run using the fourth card.

Canonical signatures are zero-padded and independent of input ordering:

```text
RUN:<suit-order>:<start-rank-2-digits>:<end-rank-2-digits>
SET:<rank-2-digits>:<sorted-suit-orders>
```

### Enumerate compatible meld combinations

Assign each card in the hand a local bit position. Each candidate meld has a bit mask. Use include/exclude depth-first search (or equivalent dynamic programming) across the sorted candidate list. A candidate can be included only when `(usedMask & candidateMask) === 0`. Record every terminal compatible combination, including the empty combination. With only 10 or 11 cards, a local numeric bit mask is sufficient and avoids any 52-bit JavaScript bitwise assumptions.

A card may occur in many candidates but, because selected masks must be disjoint, in at most one meld in a final arrangement.

### Minimum deadwood and deterministic ties

For each compatible combination, deadwood is every hand card outside its union mask. Sum `cardValue` for those cards. Choose the arrangement by this exact ascending tuple:

1. deadwood value;
2. deadwood card count;
3. canonical comma-joined deadwood card IDs; and
4. canonical comma-joined sorted meld signatures.

The first criterion is the rule; the remaining criteria only make equal optima reproducible. No set-before-run or run-before-set gameplay priority exists. Return a full `HandAnalysis` containing selected melds, deadwood cards/value, and the chosen arrangement signature.

```ts
export interface HandAnalysis {
  readonly melds: readonly Meld[];
  readonly deadwoodCards: readonly Card[];
  readonly deadwoodValue: number;
  readonly arrangementSignature: string;
}
```

### Ordinary knock and gin

For either declaration, first remove the declared discard from the 11-card hand and place it on the discard pile. Analyze the resulting 10-card hand.

- `KNOCK` is legal only when optimal deadwood is at least 1 and at most `knockThreshold` inclusive. At zero, return `GIN_ACTION_REQUIRED`.
- `GIN` is legal only when optimal deadwood is exactly zero. Otherwise return `GIN_REQUIRES_ZERO_DEADWOOD`.
- The final discard cannot be the exact discard/up-card just drawn when `forbiddenDiscardId` is set.

### Opponent layoff

Gin never permits layoffs. For an ordinary knock:

1. Select the knocker's optimal arrangement using the deterministic rule above. Those melds are the only layoff targets.
2. Enumerate every opponent arrangement having the opponent's minimum original deadwood value. Do not consider a worse original meld arrangement merely because it creates different layoff cards.
3. For each such arrangement, exhaustively search assignments of its deadwood cards onto mutable copies of the knocker's melds. At every node, try skipping the card and adding it to each target for which the resulting meld remains valid.
4. A set accepts a matching-rank missing suit only while it has fewer than four cards. A run accepts a same-suit card only when the resulting sorted ranks remain one consecutive sequence. Recursive mutation naturally supports chained layoffs such as `3♥`, then `2♥`, onto `4♥-5♥-6♥`.
5. Memoize by remaining-card mask plus canonical target-meld signatures. This covers different card orders and cards that can legally attach to more than one target.
6. Choose the result by final deadwood value, final deadwood count, canonical remaining-card IDs, chosen opponent arrangement signature, then canonical ordered layoff signature.

This is an exhaustive optimization, not a greedy pass. Each opponent card can be used in its own meld, laid off once, or remain deadwood, but never more than one of those.

```ts
export interface Layoff {
  readonly card: Card;
  readonly targetMeldSignatureBefore: string;
  readonly resultingMeld: Meld;
}
```

### Scoring

For gin, the declarer scores:

```text
opponent original optimal deadwood + ginBonus
```

For ordinary knock, compare knocker deadwood `K` with opponent deadwood after optimal layoff `O`:

- if `K < O`, the knocker scores `O - K`;
- if `K >= O`, the opponent undercuts and scores `(K - O) + undercutBonus`.

Equality is therefore an undercut worth exactly the bonus. Award points to exactly one player, update the cumulative score, and only then determine whether the match target has been reached.

## Results

Cancelled results intentionally contain no hands, melds, or stock information.

```ts
export interface PlayerHandResult {
  readonly playerId: PlayerId;
  readonly revealedHand: readonly Card[];
  readonly melds: readonly Meld[];
  readonly originalDeadwoodCards: readonly Card[];
  readonly originalDeadwoodValue: number;
  readonly layoffs: readonly Layoff[];
  readonly finalDeadwoodCards: readonly Card[];
  readonly finalDeadwoodValue: number;
}

export interface ScoredHandResult {
  readonly kind: "SCORED";
  readonly handNumber: number;
  readonly dealerId: PlayerId;
  readonly declaration: "KNOCK" | "GIN";
  readonly declarerId: PlayerId;
  readonly finalDiscard: Card;
  readonly players: readonly [PlayerHandResult, PlayerHandResult];
  readonly winnerId: PlayerId;
  readonly scoringReason: "GIN" | "KNOCK" | "UNDERCUT";
  readonly pointsAwarded: number;
  readonly scoresBefore: Readonly<Record<PlayerId, number>>;
  readonly scoresAfter: Readonly<Record<PlayerId, number>>;
}

export interface CancelledHandResult {
  readonly kind: "CANCELLED";
  readonly handNumber: number;
  readonly dealerId: PlayerId;
  readonly reason: "STOCK_REDUCED_TO_TWO";
  readonly pointsAwarded: 0;
  readonly scoresAfter: Readonly<Record<PlayerId, number>>;
}

export type HandResult = ScoredHandResult | CancelledHandResult;

export interface GameResult {
  readonly winnerId: PlayerId;
  readonly loserId: PlayerId;
  readonly finalScores: Readonly<Record<PlayerId, number>>;
  readonly matchTarget: number;
  readonly completedHands: readonly HandResult[];
}
```

## Events and visibility

Events describe accepted facts for persistence/audit and UI synchronization. They are not canonical state and must not be used to reconstruct a player view without authorization. Every event includes the resulting `stateVersion` and a visibility discriminator.

```ts
type EventMeta = {
  readonly stateVersion: number;
  readonly visibility:
    | { readonly kind: "PUBLIC" }
    | { readonly kind: "PLAYER"; readonly playerId: PlayerId }
    | { readonly kind: "SERVER_ONLY" };
};

export type GameEvent = EventMeta & (
  | { readonly type: "GAME_STARTED"; readonly dealerId: PlayerId }
  | { readonly type: "HAND_STARTED"; readonly handNumber: number; readonly dealerId: PlayerId }
  | { readonly type: "INITIAL_UPCARD_REVEALED"; readonly card: Card }
  | { readonly type: "INITIAL_UPCARD_PASSED"; readonly playerId: PlayerId }
  | { readonly type: "INITIAL_UPCARD_TAKEN"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "STOCK_DRAWN"; readonly playerId: PlayerId; readonly stockCount: number }
  | { readonly type: "PRIVATE_STOCK_CARD_RECEIVED"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "DISCARD_DRAWN"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "CARD_DISCARDED"; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: "HAND_COMPLETED"; readonly result: ScoredHandResult }
  | { readonly type: "HAND_CANCELLED"; readonly result: CancelledHandResult }
  | { readonly type: "NEXT_HAND_ACKNOWLEDGED"; readonly playerId: PlayerId }
  | { readonly type: "GAME_COMPLETED"; readonly result: GameResult }
);
```

`PRIVATE_STOCK_CARD_RECEIVED` is visible only to the drawing player. A public `STOCK_DRAWN` never contains the card. A cancelled-hand event never reveals hands. No event contains a deal plan or future stock order.

## Typed errors and validation order

```ts
export type GameErrorCode =
  | "INVALID_STATE"
  | "INVALID_RULES"
  | "INVALID_DEAL_PLAN"
  | "DUPLICATE_CARD"
  | "MALFORMED_CARD"
  | "STALE_VERSION"
  | "UNKNOWN_PLAYER"
  | "WRONG_PLAYER"
  | "ACTION_NOT_ALLOWED_IN_PHASE"
  | "STOCK_DRAW_REQUIRED"
  | "CARD_NOT_IN_HAND"
  | "ILLEGAL_REDISCARD"
  | "STOCK_UNAVAILABLE"
  | "KNOCK_DEADWOOD_TOO_HIGH"
  | "GIN_ACTION_REQUIRED"
  | "GIN_REQUIRES_ZERO_DEADWOOD"
  | "NEXT_HAND_ALREADY_ACKNOWLEDGED"
  | "NEXT_HAND_DEAL_PLAN_REQUIRED"
  | "UNEXPECTED_DEAL_PLAN"
  | "GAME_ALREADY_COMPLETE";

export interface GameError {
  readonly code: GameErrorCode;
  readonly message: string; // safe, stable, and free of hidden card data
  readonly currentVersion: number;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}
```

Apply checks in a fixed order so malformed requests return stable errors:

1. structural state, card-zone, and rules invariants;
2. `expectedVersion` equality;
3. action allowed for phase;
4. actor membership and turn ownership;
5. payload/deal-plan shape and card ownership;
6. rule semantics such as rediscard and declaration deadwood.

Error messages and details must never name an opponent's hidden card or a stock card. Parsing failures before the engine should use an application-level malformed-request error.

## Worked examples

### Overlapping run and set: greedy selection fails

Hand:

```text
3♣ 3♦ 3♥ 4♥ 5♥  7♠ 8♠ 9♠  A♦ K♦
```

Candidates include set `3♣-3♦-3♥`, run `3♥-4♥-5♥`, and run `7♠-8♠-9♠`. The `3♥` cannot be in both. Choosing the set leaves `4♥ + 5♥ + A♦ + K♦ = 20` deadwood. Choosing the heart run leaves `3♣ + 3♦ + A♦ + K♦ = 17`. The exhaustive combination search must return 17.

### Equal optimal arrangements

Hand:

```text
4♥ 5♥ 6♥  5♣ 5♦  9♠ 10♠ J♠  A♣ K♦
```

The `5♥` can join either `4♥-5♥-6♥` or `5♣-5♦-5♥`; `9♠-10♠-J♠` is compatible with either. The first arrangement leaves `5♣ + 5♦ + A♣ + K♦ = 21`; the second leaves `4♥ + 6♥ + A♣ + K♦ = 21`. The tie tuple, not traversal order, chooses one repeatably.

### Chained and alternative layoffs

Knocker melds:

```text
4♥-5♥-6♥    9♣-9♦-9♠
```

Opponent deadwood includes `3♥`, `2♥`, `7♥`, and `9♥`. `3♥` can extend the run, after which `2♥` becomes legal; `7♥` extends the other end. `9♥` can complete the set, and after the run reaches `2♥-7♥` it cannot incorrectly be inserted with a gap. The search must find all valid orderings and use each card once.

For multiple-target behavior, if the knocker instead has runs `3♥-4♥-5♥` and `7♥-8♥-9♥`, opponent card `6♥` can legally extend either run. The canonical layoff tie-break makes the recorded target stable.

### Ordinary knock

Knocker:

```text
3♥ 4♥ 5♥  7♣ 7♦ 7♠  A♠ 2♠ 3♠  9♦
```

Opponent:

```text
10♣ 10♦ 10♥  4♠ 5♠ 6♠  8♣ 2♦ 3♣ 4♦
```

The knocker has 9 deadwood. The opponent has 17 (`8 + 2 + 3 + 4`) with no layoff onto the shown knocker melds. The knocker scores `17 - 9 = 8`.

### Undercut and equality

If a knocker has 8 deadwood and the opponent has 5 after layoffs, the opponent scores `(8 - 5) + 25 = 28`. If both finish with 8, equality is still an undercut and the opponent scores `(8 - 8) + 25 = 25`.

### Gin

After the declared discard, a hand consisting entirely of compatible melds has zero deadwood. If the opponent's optimal original deadwood is 18, gin awards `18 + 25 = 43`. Even if an opponent deadwood card could extend one of the gin hand's runs, no layoff search is performed.

## Unit test plan

Use Vitest with card builders and fixed deal plans. Tests should assert the complete result where practical: phase, actor, zones, version, events and visibility, selected meld signatures, deadwood cards/value, layoffs, points, and errors. Also assert that input state/action objects remain deeply equal to their pre-call snapshots.

### Cards, melds, and optimization

- **Ace-low run:** `A♣-2♣-3♣` is a valid run with value ordering 1-2-3.
- **Invalid Q-K-A:** `Q♣-K♣-A♣` and `K♣-A♣-2♣` are invalid.
- **Sets:** three same-rank, distinct-suit cards are valid; mixed rank and repeated identity are invalid.
- **Four-card sets:** all four suits form a valid set; candidate generation emits four three-card subsets plus the four-card set.
- **Overlapping run/set choices:** use the `3` example above; ensure the shared `3♥` appears in only one selected meld and deadwood is 17.
- **Multiple possible meld arrangements:** use the equal-21 example above; permute input and candidate ordering and assert the same arrangement signature.
- **Optimal deadwood:** compare exhaustive output to all compatible combinations for hands containing long runs, four-card sets, and two overlaps; ensure non-greedy minimum.
- Candidate generation emits every contiguous subrun of `2♥-3♥-4♥-5♥-6♥`, not only the maximal run.

### Declarations, layoffs, and scoring

- **Knock exactly at 10:** after final discard, optimal deadwood 10 is accepted under v1 rules.
- **Illegal knock over 10:** deadwood 11 returns `KNOCK_DEADWOOD_TOO_HIGH`, no events, unchanged state/version.
- **Gin:** zero deadwood with `GIN` scores opponent original deadwood plus 25 and records `GIN`.
- **Ordinary knock:** use the worked 9-versus-17 example and assert 8 points to the knocker.
- **Layoff onto a run:** lay `3♥`, then `2♥`, and `7♥` onto `4♥-5♥-6♥`; assert the chained optimum.
- **Layoff onto a set:** lay `9♥` onto `9♣-9♦-9♠`; a fifth rank-nine card is impossible in a valid deck and a repeated suit is rejected by state validation.
- **Multiple possible layoffs:** lay `6♥` against `3♥-4♥-5♥` and `7♥-8♥-9♥`; assert deterministic target and final deadwood regardless of search order.
- **Undercut:** knocker 8 versus opponent final 5 awards 28 to opponent with v1 bonus.
- **Equal-deadwood undercut:** 8 versus 8 awards 25 to opponent.
- **No layoff against gin:** give opponent cards that could extend declarer's runs; assert no layoffs and full original opponent deadwood is scored.
- Declaring `KNOCK` at zero returns `GIN_ACTION_REQUIRED`; declaring `GIN` above zero returns `GIN_REQUIRES_ZERO_DEADWOOD`.

### State machine and turn flow

- **Opening up-card accepted:** test acceptance by non-dealer and, after one pass, by dealer; each reaches `AWAITING_DISCARD`, owns 11 cards, and cannot rediscard the up-card.
- **Both opening passes:** dealer's second pass gives the non-dealer `AWAITING_DRAW` with `STOCK_ONLY_AFTER_OPENING_PASSES`; `DRAW_DISCARD` returns `STOCK_DRAW_REQUIRED`.
- **Discard draw:** moves only the public top discard into the current hand, preserves deeper discard order, and sets `forbiddenDiscardId`.
- **Stock draw:** moves only `stock[0]`, emits public count plus player-private card event, and reveals no future stock card.
- **Illegal rediscard of the picked-up discard:** `DISCARD`, `KNOCK`, and `GIN` using `forbiddenDiscardId` each return `ILLEGAL_REDISCARD` unchanged.
- **Wrong-player action:** every phase-specific player action rejects the non-current player with `WRONG_PLAYER`.
- **Stale version:** a legal-looking action with `expectedVersion !== state.version` returns `STALE_VERSION` before card/rule semantics.
- **Two cards remaining in stock:** starting at three, `DRAW_STOCK` cancels immediately at two, awards zero, hides both hands, and prevents discard/knock; after both acknowledgements the dealer alternates.
- The first `START_NEXT_HAND` records one acknowledgement and increments version without dealing; a duplicate acknowledgement fails; the second requires a server deal plan and starts the hand.
- Every ordinary discard switches current player and returns to unrestricted `AWAITING_DRAW`.

### Match, deck integrity, and failure atomicity

- **Reaching 100 match points:** begin with a player below 100, award enough points to reach or exceed it, and assert immediate `GAME_COMPLETE`, correct `GameResult`, and rejection of `START_NEXT_HAND`.
- **Malformed or duplicate deck state:** reject missing cards, duplicate rank/suit identity, mismatched ID/rank/suit, wrong hand sizes, invalid current player, and active stock size below three with typed errors and no events.
- Reject a `START_GAME` or second `START_NEXT_HAND` deal plan that is not an exact 52-card permutation.
- Assert an unexpected deal plan on a first acknowledgement is rejected so callers cannot smuggle or prematurely consume randomness.
- Assert accepted actions increment the version exactly once even when emitting multiple events; all emitted events carry the same resulting version.
- Assert every rejected action returns no events and does not mutate any nested input array or object.

## Recommended source layout

```text
src/game/
  index.ts                    # public exports only
  types.ts                    # cards, actions, states, results, events, errors
  cards.ts                    # deck construction, identity, rank/value, canonical sort
  shuffle.ts                  # injected RandomSource and unbiased Fisher-Yates helper
  deal.ts                     # DealPlan validation and immutable dealing
  invariants.ts               # GameRules and full GameState validation
  melds.ts                    # set/run validation and complete candidate generation
  hand-analysis.ts            # compatible combinations, deadwood, deterministic tie-break
  layoffs.ts                  # exhaustive layoff search and deterministic reconstruction
  scoring.ts                  # gin, knock, undercut, HandResult/GameResult construction
  state-machine.ts            # phase/action transition table implementation
  apply-action.ts             # validation order and central API
  test/
    card-fixtures.ts          # concise card/hand/deck builders
    state-fixtures.ts         # valid states for each phase; fixed deal plans
    melds.test.ts
    hand-analysis.test.ts
    layoffs.test.ts
    scoring.test.ts
    state-machine.test.ts
    invariants.test.ts
```

Keep helpers module-private unless another layer genuinely needs them. `index.ts` should expose the domain types, constructors, player-safe analysis/results as appropriate, `shuffledDeck`, and `applyAction`; it should not expose mutation primitives that bypass validation.

## Implementation sequence

1. Implement cards, canonical ordering, rule validation, fixed deck builders, and state fixtures.
2. Implement meld validation/candidate generation and exhaustive hand analysis with all optimization tests.
3. Implement exhaustive layoff search, scoring, and worked-example tests.
4. Implement deal validation, immutable phase transitions, errors, versions, and events.
5. Add full-state invariant checks and failure-atomicity tests.
6. Only after this pure engine is complete should a server transaction adapter map authenticated client intents to trusted actions, add deal plans, persist with optimistic version checking, and project private state safely.
