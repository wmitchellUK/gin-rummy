# Gin Rummy v1 Product Specification

## Product goals

Gin Rummy is a polished, private, two-player web game that makes it easy to start a real game with a friend and finish a complete match without accounts, setup friction, or loss of progress. The table should feel like a premium physical card game: the player's hand is prominent, actions are clear, and scores and outcomes are easy to understand.

The server is authoritative for every game action and score. A player may play as a guest, choose a display name, and optionally use an account to retain their game history across devices.

The public Card Studio is a prototype presentation tool. It lets any visitor prepare and globally activate custom portraits for the twelve jack, queen, and king suit combinations. Artwork changes how face cards are drawn only; it never changes a card's rank, suit, value, legality, game state, or player-safe projection.

## Non-goals

V1 does not include AI opponents, public matchmaking, tournaments, payments, chat, a friends system, avatar marketplace, or leaderboards. Card Studio does not include asset garbage collection, moderation, rate limiting, AI generation, background removal, rotation controls, per-game artwork pinning, or administrator accounts. Authentication and role checks are a deliberate extension point after the public prototype.

## User journey

1. A visitor opens the landing page, enters a display name, and creates a private game or enters an invite code.
2. The creator receives a shareable game URL and a short invite code, then waits for one opponent.
3. The opponent opens the URL or submits the code, chooses a display name if needed, and joins. The game begins when both seats are filled.
4. Players take turns through hands, see the scored result of each hand, and start the next hand.
5. When a player reaches the match target, both see the game result and may request a rematch. A rematch creates a new match with the same two players.
6. Recent completed and in-progress games are available on the current device; authenticated players see their history when they sign in on another device.

## Routes and screens

| Route | Screen | Required behavior |
| --- | --- | --- |
| `/` | Landing | Enter or change display name; create a private game; join with invite code; link to recent games. |
| `/game/[gameId]` | Game table | Resolve the invite, show waiting, play, reconnect, hand-result, game-result, and rematch states as appropriate. The full URL is the shareable invite URL. |
| `/history` | History | Show the current identity's recent in-progress and completed games, newest first; open a selected game. |
| `/card-studio` | Public Card Studio prototype | Create, rename, edit, archive, and globally activate face-card sets; restore the built-in design. No sign-in is required during the prototype. |

The invite code is short, human-enterable, unique among joinable games, and maps to the same private game as its URL. A game accepts exactly two players. Joining a full game is rejected without exposing either player's cards or private state.

## Product states

| State | Player experience |
| --- | --- |
| Landing | Name, create-game, and join-by-code controls are available without account creation. |
| Waiting for opponent | Creator sees the invite URL/code, copy controls, and a waiting status. They may refresh safely. |
| Playing | Show the player’s hand, their legal turn actions, public piles, turn/status, hand and match scores, and opponent card count only. |
| Disconnected opponent | Keep the game state intact, show a clear reconnecting/offline status, and disable actions that require the absent player. Resume when the opponent reconnects. |
| Hand result | Freeze play and show declaration, melds, deadwood, layoff result where applicable, points awarded, and updated match score. Each player selects Start next hand; the server deals only when both have acknowledged the result. |
| Game result | Show winner, final score, completed-hand summary, and rematch controls. No further game actions are accepted. |
| Rematch | A player can request a rematch; when the other accepts, create and open a new private match for the same pair. A declined or unanswered request leaves the completed game unchanged. |
| History | Show enough information to identify each recent game: opponent name, status/result, score, and last activity. |

## Rules and scoring

V1 uses standard two-player Gin Rummy with the following explicit choices. Rule values are configurable through `GameRules`; v1 defaults are: `knockThreshold: 10`, `ginBonus: 25`, `undercutBonus: 25`, and `matchTarget: 100`.

### Cards, deal, and turn flow

- Use one standard 52-card deck, with no jokers. Card values are ace = 1; 2–10 at face value; jack, queen, and king = 10. Ace is low only: A-2-3 is valid and Q-K-A is not.
- Randomly choose the dealer for the first hand. Deal 10 cards to each player, one at a time, starting with the non-dealer. The remaining deck is the stock; turn its top card face up to begin the discard pile.
- The non-dealer gets the first decision: take the initial up-card or pass. If they pass, the dealer may take that same card or pass. If both pass, the non-dealer must draw the top stock card and play proceeds normally.
- On a normal turn, draw either the top stock card or the top discard. A player drawing from stock may discard any card. A player taking the discard may not discard that same card on the same turn.
- After drawing, discard exactly one card before ending the turn, unless declaring gin or an ordinary knock ends the hand. A player may not discard before drawing, inspect hidden stock cards, or draw other than the two legal sources.
- The first hand’s dealer is chosen randomly. For every later hand, the dealer alternates, including after a cancelled hand caused by stock exhaustion.

### Melds and deadwood

- A set is three or four cards of the same rank in different suits.
- A run is three or more consecutive cards in the same suit. Ace is low only.
- A card can be assigned to only one meld. When several overlapping valid meld assignments exist, score the hand using the assignment that minimizes total deadwood; no fixed meld priority is used.
- Deadwood is the total card value not assigned to the selected melds. The engine must calculate the optimal (minimum) deadwood, rather than relying on a displayed grouping chosen by a player.

### Knocking, gin, and hand score

- After the required draw and before ending the turn, a player may end the hand by discarding and knocking when their optimal deadwood after that discard is 10 or less.
- Gin is an optimal deadwood total of zero after the player’s discard. The player declares gin; it scores the opponent’s entire deadwood plus the 25-point gin bonus. The opponent cannot lay off cards against gin.
- For an ordinary knock, reveal both hands and the knocker’s melds. The opponent may lay off otherwise-deadwood cards onto the knocker’s revealed sets or runs when the resulting meld remains valid. The opponent’s deadwood is then recalculated after all legal layoffs; the knocker cannot lay off cards.
- If the knocker’s deadwood is lower than the opponent’s deadwood after layoff, the knocker scores the difference. Otherwise the opponent undercuts and scores the difference plus the 25-point undercut bonus. Equal deadwood is an undercut.
- The hand-result screen must show each player’s optimized melds, original deadwood, valid layoffs when applicable, final comparable deadwood, score calculation, and updated match score.
- If the stock is reduced to two cards and no player has ended the hand, the hand is cancelled immediately: no points are awarded, cards are not exposed, and the next hand is dealt with the dealer alternating.

### Match completion

- The winner is the first player whose cumulative score reaches or exceeds 100 at the end of a scored hand.
- A completed match does not start another hand. It remains viewable in history and may lead to a separately recorded rematch.

## Functional requirements

- Guests can create and join games; account creation is never required to play.
- Require a non-empty display name, normalize whitespace, enforce a reasonable length limit, and permit duplicate names without treating them as identity.
- Keep each game private: access is through the game URL or invite code, and no browsing or public listing exposes active games.
- Persist the canonical game, player identities, hand state, actions, scores, and completion state server-side. Clients submit intents such as draw, discard, knock, gin, next-hand acknowledgement, and rematch response; they never submit resulting game state or scores.
- Validate every action against the current server state and turn. Prevent duplicate, stale, out-of-turn, illegal, and replayed actions.
- Never send an opponent’s card identities, undealt stock order, or any other hidden information to a client. The player may see their own cards, public discard pile, public scores, card counts, and revealed cards only when rules require reveal.
- Support multiple hands until match completion. Record enough hand detail to render results and recent-game summaries accurately.
- Copying the URL/code works without requiring the creator to remain connected. The URL and code remain usable until the second player joins or the game is no longer joinable.

## Card Studio prototype

- Anyone may create, rename, edit, archive, or globally activate artwork during the prototype. Set names are trimmed to 1–80 characters and need not be unique.
- A set has an independently versioned draft and an immutable published snapshot. Uploading, replacing, or removing a slot changes only the draft. Activation atomically publishes the current draft, increments the published revision, and selects that revision globally.
- Draft mutations return the new `draftVersion`, and activation returns the new published revision and active manifest. Clients must use those returned values for every subsequent mutation rather than predicting a version locally.
- The built-in court-card design is a first-class global choice. The active custom set cannot be archived; archived sets cannot be edited or activated.
- Open and future games use the current global published set. Visible game pages check for a new manifest approximately every five seconds; the selected set is not copied into canonical game state.
- Missing slots, failed manifest requests before an initial load, and failed portrait image loads render the built-in court-card design. After a successful manifest load, a transient polling failure preserves the last successful presentation until a later refresh succeeds.
- Original uploads are never stored. The server accepts JPEG, PNG, or WebP input up to 10 MB, applies the confirmed 2:3 crop after orientation, preserves transparency when present, and stores only a metadata-free 600×900 WebP result.
- Processed assets use randomized immutable object paths. Current and superseded processed assets remain publicly readable when their URL is known so already-published revisions remain renderable.

## Reconnect behavior

- A refresh, browser restart, or transient network loss returns a recognized device/account to its existing seat and current canonical game state.
- On reconnect, fetch authoritative state before enabling interaction; realtime messages are notifications to refetch or synchronize, not a substitute for canonical state.
- An in-flight action may be retried safely using an idempotency key. If the action was already accepted, return the resulting current state rather than applying it twice.
- Show connection status. While the local client is disconnected, disable actions and preserve the last known view as non-authoritative. While the opponent is disconnected, retain the game and show their status; do not auto-forfeit in v1.
- A guest’s recent-game identity is retained on that device. An authenticated identity additionally retains its history across devices. Loss of guest browser storage can prevent automatic recovery of that guest seat; the share URL alone does not reveal a player seat’s private cards.

## Error behavior

- Present actionable, non-technical errors for invalid invite codes, expired/unavailable invites, a full game, failed joins, lost connectivity, and unavailable history.
- For an invalid or stale game action, do not optimistically change cards or score permanently. Explain that the game changed, refetch canonical state, and restore the legal controls.
- For server or network failures, preserve unsent user intent only when it is safe to retry idempotently; otherwise ask the player to retry after state reload.
- Never reveal private state in error messages, logs rendered to users, or responses for unauthorized/full games.

## Accessibility expectations

- The entire experience is usable with keyboard only, including card selection, draw source, discard, declaration, copy invite, and dialogs.
- Use semantic controls, visible focus states, logical focus management, and accessible names/instructions for every card and action.
- Do not convey suit, card state, turn, connection, or errors by color alone. Provide text and suitable screen-reader announcements for turn changes, opponent actions, hand results, and errors.
- Meet WCAG 2.2 AA contrast expectations. Support responsive layouts, browser zoom, reduced motion, and touch targets of at least 44 by 44 CSS pixels where practical.

## Acceptance criteria

- A new visitor can choose a name, create a private game, copy a shareable URL/code, and another visitor can join it without either creating an account.
- Exactly two players can enter a game; a third join attempt is rejected safely.
- The game correctly enforces every rule and score choice above, including initial up-card passes, optimal deadwood, layoffs, gin, undercuts, stock-at-two cancellation, and alternating dealers.
- Players can complete consecutive hands until a player reaches 100, view each hand’s scoring, and see a final game result.
- Refreshing or reconnecting either player during waiting, play, hand result, or game result restores the correct state without leaking hidden cards or duplicating actions.
- A completed game supports a mutually accepted rematch that is recorded as a new match.
- Guests can view recent games on the same device; authenticated players can view their recent games after signing in elsewhere.
- The primary game flow is keyboard-accessible, has meaningful status/error announcements, and meets the accessibility expectations above.
- A visitor can create and edit a Card Studio set, confirm global activation, and see the same published face-card portrait in open games without exposing an opponent's hidden cards.
- Restoring the built-in design updates visible open games within approximately five seconds. Missing artwork falls back to the built-in court-card design.
