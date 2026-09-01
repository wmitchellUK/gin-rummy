# Identity and invites: v1 design

## Scope and decision

This document is an audit and a proposed product design. It does not change the
game engine, game rules, canonical game-state model, authorization model, or
hidden-card projection rules.

**Recommendation:** make every visitor a silent, persistent *player* backed by
a Supabase anonymous Auth identity. A player chooses a public name only when a
name is needed. A game seat belongs to that Auth identity. An invite is a
single-use capability to claim an *open* second seat; it is never a credential
for an occupied seat. Do not present anonymous players with Login or Logout in
v1.

The current server-authoritative game and membership controls are a good
foundation and should be retained.

## 1. Current implementation audit

### Auth clients and session bootstrap

- `lib/supabase/client.ts` creates the browser Supabase SSR client with the
  public publishable/anon key. `lib/supabase/server.ts` creates a cookie-aware
  user-scoped server client. Both are appropriate client types.
- `lib/supabase/anonymous.ts` is the bootstrap actually used by the game UI.
  `ensureAnonymousSession()` reads the browser session and calls
  `signInAnonymously()` only if no user is present. It verifies the resulting
  session before returning the Auth UUID. It uses the Supabase browser client's
  normal persistent session storage/cookie integration; the application adds no
  separate identity value in localStorage or sessionStorage.
- `POST /api/session/anonymous` independently performs almost the same
  bootstrap using the server cookie client. It is exercised by E2E but is not
  called by the application UI. There are therefore two session-establishment
  paths with no clear ownership.
- `lib/supabase/proxy.ts` refreshes claims/cookies on matched requests. It
  deliberately leaves `/`, `/api/*`, and `/game/*` public at navigation time;
  game API handlers perform their own authorization. This is correct for an
  invite/public-entry flow, although `/game/[gameId]` is currently not an
  invite-entry flow.
- Anonymous sign-in is enabled locally in `supabase/config.toml` and is rate
  limited there. Supabase anonymous users are authenticated users for RLS.

### Profiles and names

- The `on_auth_user_created` trigger in migration `0003_profiles_trigger.sql`
  always creates `profiles(id, display_name = 'Guest')`.
- `POST /api/profile` validates trim/collapsed whitespace and a 1--40 character
  name, then updates the authenticated user's profile through server-only
  service-role code. Client direct writes are denied by RLS.
- There is no `GET /api/profile` or bootstrap/me endpoint. The landing page
  never loads the saved name. It initializes its name input to `Player` on
  every visit and creates/joins only after overwriting the profile with that
  input. A returning player who does nothing can thus be renamed from a prior
  name to `Player`.
- `profiles.display_name` is global. `game_players.display_name` is a correct
  immutable-at-creation/join snapshot, and game views use the snapshot.

### Landing, creation, and invites

- `/` renders `GameLobby`. It silently bootstraps anonymous Auth, always shows
  a large name field, Save name, Create game, an invite-code entry field, and
  Log out. It also reads `?invite=` from the landing URL.
- Create saves the name first, then `POST /api/games`; the server looks up the
  profile name, creates the creator's seat 0 and waiting state atomically via
  `create_waiting_game`, and returns the game ID plus an 8-character code.
- The creator is routed to `/game/[gameId]?invite=[code]`. The waiting screen
  can display that code only because it re-reads the query string. It does not
  render the full share URL or a copy control.
- The only join UI is the landing form. It saves the typed name first and posts
  the code to `POST /api/games/join`. There is no `/join/[invite]` page and a
  non-member opening `/game/[gameId]?invite=[code]` is not offered Join; the
  game fetch fails membership and the UI tells them to return to the lobby.
- In other words, the query-string code is an out-of-band hint for the
  existing lobby, not a clean invite route. The game ID route itself is
  participant-only in practice.

### Join, seat recovery, routing, and membership

- `joinGameByInvite()` normalizes and validates the 8-character code, finds the
  game using trusted server code, loads its waiting canonical state, and rejects
  a creator attempting to join their own waiting game. It creates the deal
  server-side, then invokes `join_game_and_start`.
- The join RPC locks the waiting game row, verifies status and that the joining
  Auth ID is not already a player, inserts only seat 1, writes initial state,
  and changes status in one transaction. The primary key `(game_id, user_id)`
  and unique `(game_id, seat)` prevent duplicate ownership, one user taking two
  seats, and a third seat. This is a sound concurrency boundary.
- `GET /api/games/[gameId]`, game actions, and rematch all first require the
  current Auth UUID and server-check membership. A current browser with the
  original anonymous session therefore refreshes and recovers its own seat.
- A game page itself always bootstraps a session before fetching. If browser
  identity was lost, this silently creates a *new* identity, which correctly
  cannot load the old game but produces a generic “Could not load this game”
  error. The UI does not explain lost identity versus an invalid/non-member
  game.
- The game screen polls the canonical safe projection every 1.2 seconds. The
  server emits safe private Realtime notifications, with member-scoped Realtime
  RLS, but no browser subscription currently consumes them.
- `/history` and `GET /api/history` are described in product/architecture
  documents but do not exist. `/settings` does not exist.

### Logout and legacy account UI

- The lobby's **Log out** confirmation calls
  `startFreshAnonymousSession()`: local Supabase sign-out followed by a new
  anonymous sign-in. This abandons—not deletes—the previous identity and all
  of its seats from that browser. The confirmation is better than a silent
  loss, but “Log out” inaccurately implies a normal reversible account action.
- A separate legacy `LogoutButton` calls ordinary `supabase.auth.signOut()` and
  routes to `/auth/login`. Legacy login, password signup, reset, and
  `/protected` starter routes/components remain. An anonymous user is a real
  authenticated user, so the proxy's generic protected-route check does not
  distinguish a signed-in guest from a formal account. The surfaces conflict
  with the low-friction product model and with each other.
- No application-owned identity is stored in browser storage. The only session
  loss risks found are normal Supabase session/cookie/storage loss and the two
  intentional sign-out paths.

### Schema, RLS, secrets, and tests

- `profiles.id` references `auth.users`; `games.created_by` and
  `game_players.user_id` also reference `auth.users`.
- RLS is enabled on all application tables. Browser reads are limited to one's
  profile, games/results where a membership row exists, and one's own
  `game_players` row. Browser writes are revoked. Canonical state, actions, and
  events are denied. These are strong and should remain enabled.
- Server route handlers use a user-scoped client to derive the JWT subject and
  a server-only service-role client for trusted repository/RPC work. The secret
  key is not imported into browser components.
- The SQL tests cover RLS denial of canonical data and browser writes, and the
  unique/transactional join and stale commit contracts. Vitest covers safe
  projection and authoritative actions. The Playwright flow covers two separate
  anonymous browsers creating/joining, action synchronization, and refresh.
- Missing tests include profile bootstrap/returning-name behavior, invite URL
  acceptance, own-invite/existing-seat routing, full-invite UI, reset identity,
  lost identity, and concurrent join attempts at the HTTP/UI layer.

## 2. Problems and inconsistencies

1. **A real Auth identity is presented as a disposable “guest login.”** The
   current Log out action destroys browser access to private seats while the
   app does not offer account recovery.
2. **Name state has no lifecycle.** A trigger-created sentinel (`Guest`), a UI
   default (`Player`), and the persisted profile are three competing meanings.
   The product cannot tell “has never named this player” from “their name is
   Guest,” and returning players are needlessly asked and can be overwritten.
3. **The advertised shareable game URL does not work as an invite.** Joining is
   only possible through the root form; `/game/[id]` requires membership.
4. **Invite and game routes have mixed responsibilities.** A game URL carries
   an invite code query parameter, while the code is also manually entered.
   The waiting page depends on a fragile query string rather than server-owned
   invite state.
5. **Legacy email/password starter UI contradicts the v1 experience.** It
   exposes Login, Sign up, and another logout semantics without a defined
   relationship to anonymous-player ownership.
6. **The architecture specification is ahead of implementation.** History,
   browser Realtime consumption, copyable URL, and clean invite resolution are
   documented but absent.
7. **Current invite entropy is only 40 bits.** Eight characters from a
   32-character alphabet is convenient to type but is not a strong URL bearer
   secret against online guessing by a determined attacker. It should not be
   the sole private-link capability without stringent rate limiting.

## 3. Recommended identity mental model

Use these four separate concepts everywhere in code and product copy:

| Concept | Meaning | Authority and lifetime |
| --- | --- | --- |
| **Player identity** | Internal Supabase Auth user, anonymous in v1 | Auth UUID; persisted by Supabase in the browser; never displayed as a user-facing ID |
| **Your name** | Public name chosen by the player | `profiles.display_name`; optional until a game operation needs it |
| **Game seat** | A player's ownership of one side of a particular game | `game_players(game_id, user_id)`; only the matching Auth UUID may read/play that seat |
| **Invite** | Opaque capability to claim a waiting game's open second seat | Random, server-resolved, invalid for occupied seats; never identifies or authenticates a player |

Call people **players**, not “anonymous users,” “guests,” or “accounts” in the
game UI. The browser silently prepares a player identity. There is no user
action called Login in anonymous-only v1.

### Invite credential recommendation

Use one high-entropy invite token in a clean URL, e.g.
`/join/4sA...` (at least 128 random bits, URL-safe). Store only a hash/digest
of that token in the database. This is the smallest secure private-link
model: it removes the code/link duality and supports copy/paste naturally.

Do not include an 8-character manual code in the first coherent version. If
human transcription proves important later, make it an explicitly secondary
feature: use a substantially longer code, throttle/abuse-protect resolution,
and describe it as a convenience rather than an identity credential. It still
may claim only a waiting seat.

## 4. First-visit flow

1. Visitor opens `/` or `/join/[invite]`.
2. A single client session bootstrap ensures a Supabase session. If none exists,
   it silently signs in anonymously. Show a brief “Preparing your table…” only
   while this is in progress; do not ask them to log in.
3. The app fetches a small authenticated bootstrap response containing the
   current profile/name state. A profile may exist with no chosen display name.
4. Landing with no name can still show the page. Selecting **Create game** or
   accepting an open invite opens “What should we call you?” and saves the name
   before the operation continues.
5. Once named, the player is READY. Normal reloads and browser restarts reuse
   their existing Auth identity and name.

## 5. Returning-player flow

- At `/`, silently recover the Auth session and load the profile. If a name is
  set, show it discreetly as **Playing as Alex** with a Settings control.
- Offer **New game**, **Join game** (paste an invite link), and **Recent games**.
  Do not show a mandatory name form or Login/Logout controls.
- `/history` lists games for the current Auth identity. It is device/browser
  history for anonymous players; it becomes cross-device history only after a
  future account upgrade.
- Opening `/game/[gameId]` with an identity that owns a seat goes straight to
  its safe canonical projection. It never re-joins or changes its seat.

## 6. Create-game flow

1. Ensure player identity and name. If unnamed, request **Your name** in a
   focused dialog/screen and persist it.
2. `POST /api/games` derives the Auth ID and profile name server-side. It
   atomically creates the waiting game, creator seat, initial waiting state,
   and a new invite token.
3. Route the creator to `/game/[gameId]` (not a query-string invite).
4. The waiting room obtains its own invite URL from a member-safe game view or
   a narrow member-only invite endpoint and shows **Invite a player**, a Copy
   invite button, the player's own name, and **Waiting for an opponent**.
5. The creator may refresh safely. Their Auth identity and membership restore
   the waiting room. The invite is usable until a second seat is claimed or the
   game is otherwise closed.

The initial waiting state must keep the invite value out of views returned to
the opponent. It is an ability the creator can share, not routine game data.

## 7. Invite and join flow

`/join/[invite]` is an acceptance route, not a game page.

1. Bootstrap/recover anonymous Auth.
2. Call a server-only invite-resolution endpoint with the token. It compares a
   token digest and determines the state under server control. It never returns
   canonical state, player names, hands, or a waiting game projection to a
   non-member.
3. If the current Auth ID already owns a seat, return `ALREADY_A_PLAYER` with
   its game ID and route directly to `/game/[gameId]`. This covers opening one's
   own invite and a participant reopening an old invite.
4. If the invite has one open seat and the Auth ID is not already a player,
   request a name only if one is missing, then show an explicit **Join game**
   confirmation. Do not claim a seat merely by opening a URL.
5. `POST /api/invites/[invite]/join` derives both Auth ID and name server-side
   and atomically locks/checks/claims the open seat and starts the game. The
   successful response contains only the new member's safe projection/game ID.
6. If it is full, show **This game already has two players.** Do not show who
   they are, their scores, game status, or cards. Invalid, expired, revoked,
   and already-closed tokens use a generic **This invite is no longer
   available.**

The join RPC remains the final authority. An earlier resolve response is only
advisory and can be stale; two Join clicks or two users competing for the seat
result in exactly one successful claim.

## 8. Existing-seat recovery

Membership recovery is not invite recovery:

- A valid retained Supabase session gives the server an Auth UUID. If it has a
  `game_players` row for a requested game, return the safe projection and
  resume its exact seat.
- If it does not, `/game/[gameId]` must not expose information or offer a way
  to take an occupied seat. Return a privacy-preserving 404/API code and show:
  **This game is not available to this player. Open it in the browser where you
  joined, or use a new invite.**
- If browser cookies/storage were cleared, the old anonymous identity is gone.
  There is no secure v1 recovery based on game ID, player name, or invite URL.
  The UI must say this plainly and offer **Start as a new player** / return
  home, without implying a lost seat can be reclaimed.

## 9. Display-name model

Retain the existing two-level model:

- `profiles.display_name`: the current, global public name for future games.
- `game_players.display_name`: immutable snapshot at seat creation. Use it for
  game tables, results, history, and rematches.

This is the right model. Changing **Your name** affects a new game or future
join only; it never mutates a game in progress, past results, or an existing
rematch's copied snapshots.

Change `profiles.display_name` from `NOT NULL`/magic `Guest` to nullable.
The profile row can still be trigger-created; `NULL` is the only “name has not
been chosen” state. Validate/normalize names centrally in the profile service,
not only in the route. Duplicate names remain allowed and have no authorization
meaning.

## 10. Logout / reset identity recommendation

### V1 product choice: omit Logout

Do not show Logout in the landing header, game table, or primary navigation.
There is no account the player has consciously logged into, and ordinary
sign-out loses the only proof of ownership for private game seats on that
browser. A normal refresh/reconnect is safe precisely because the anonymous
session remains.

### Optional advanced safety control: Reset this player

If a reset is necessary (shared device, testing, or privacy), put it at the
bottom of `/settings`, not in everyday game navigation:

- Label: **Reset this player on this browser**.
- Explain: **This creates a new player. You will no longer be able to open your
  current private games from this browser. Games and seats are not deleted and
  cannot be recovered without the original browser session or a future linked
  account.**
- Require an explicit destructive confirmation, ideally typing `RESET` or a
  second confirmation. Show active/in-progress games before confirmation if
  available.
- Perform local sign-out then establish a new anonymous session. Do not delete
  `auth.users`, profile, games, or history as part of reset.

Do not retain the legacy global `signOut()` button. “Reset” accurately describes
the security consequence; “Log out” does not. A future formal account may add
an ordinary sign-out flow, with wording and recovery behavior appropriate to
that credential.

## 11. Future account-upgrade compatibility

Game ownership is already keyed to `auth.users.id`, which is the right durable
boundary. When accounts are introduced, offer an opt-in **Save your player
across devices** flow and link/upgrade the *current anonymous user* to magic
link, Google, Apple, or another provider using Supabase's supported identity
linking/upgrade path. The goal is to preserve the same Auth user ID, profile,
and `game_players` references.

Do not implement this in v1. Before shipping it, verify the exact Supabase
provider/linking semantics in the deployed version and test that the Auth UUID
does not change. Never silently replace an anonymous UUID with a newly-created
account UUID; that would strand memberships or require a privileged migration.

## 12. Routes

| Route | Purpose | Access behavior |
| --- | --- | --- |
| `/` | Landing: new game, paste invite, recent games, compact player control | Public entry; silently bootstraps a player |
| `/join/[invite]` | Invite acceptance | Public entry; resolves only the capability state and may claim an open seat |
| `/game/[gameId]` | Actual waiting room/game table/results | Participant-only after bootstrap; no invite acceptance here |
| `/history` | Current player's recent games | Auth identity required; anonymous device history in v1 |
| `/settings` | Change Your name; advanced Reset this player control | Auth identity required |

Do not add an account/login route to the v1 game journey. Remove the unused
starter `/protected` and `/auth/*` UI, or keep it inaccessible/unlinked until
an explicitly designed account-upgrade feature replaces it.

## 13. Client product state machine

Represent the entry experience with a discriminated state, not overlapping
`busy`, `authReady`, `name`, and `error` booleans. The game table retains its
separate server-projected game phase.

| State | Meaning and permitted transitions |
| --- | --- |
| `INITIALIZING_SESSION` | Restore/create anonymous Auth session. → `LOADING_PLAYER` or `SESSION_ERROR` |
| `LOADING_PLAYER` | Fetch own profile/bootstrap state. → `READY_UNNAMED`, `READY_NAMED`, or `SESSION_ERROR` |
| `READY_UNNAMED` | Identity exists; no display name. May open `NAMING` for create/join/settings. |
| `READY_NAMED` | Identity and name ready. May → `CREATING_GAME`, `RESOLVING_INVITE`, `LOADING_HISTORY`, or `RESET_CONFIRMATION`. |
| `NAMING` | Validating/saving a name with a continuation (`create`, `join`, or `settings`). → continuation state or recoverable `PROFILE_ERROR`. |
| `CREATING_GAME` | Creation request in flight. → `WAITING_FOR_OPPONENT` (route game) or recoverable error. |
| `RESOLVING_INVITE` | Server classifies invite. → `ALREADY_A_PLAYER`, `NEEDS_NAME_TO_JOIN`, `READY_TO_JOIN`, `GAME_FULL`, or `INVITE_UNAVAILABLE`. |
| `NEEDS_NAME_TO_JOIN` | Open invite plus unnamed player. → `NAMING` with join continuation. |
| `READY_TO_JOIN` | Open invite and named player; explicit Join enabled. → `JOINING_GAME`. |
| `JOINING_GAME` | Atomic join in flight; disable duplicate submissions. → `IN_GAME`, `GAME_FULL`, or recoverable error. |
| `WAITING_FOR_OPPONENT` | Creator's member-safe waiting projection. → `IN_GAME` after canonical refetch. |
| `IN_GAME` | Member-safe game projection; reconnect/refetch behavior is controlled by game state. |
| `RESET_CONFIRMATION` | Destructive confirmation. → `INITIALIZING_SESSION` after reset or back to ready. |
| `SESSION_ERROR` | Auth bootstrap failure; Retry transitions to `INITIALIZING_SESSION`. |

Errors are state-associated (for example, `PROFILE_ERROR` within `NAMING`) so
the app preserves the user's intent and never attempts a join with an unsaved
name.

## 14. Backend and API responsibilities

Keep request identity server-derived, service-role use server-only, and
canonical-state work in the existing trusted services.

| API / service | Responsibility |
| --- | --- |
| Browser session bootstrap (one implementation) | Restore or silently create anonymous Supabase session; never accepts a client user ID |
| `GET /api/me` (or `/api/player`) | Return own profile/name readiness and safe current-player metadata only |
| `POST /api/profile` | Validate/save name for `requireUserId()`; no client-selected profile ID |
| `POST /api/games` | Require named player; create game, creator seat, waiting state, and invite atomically |
| `GET/POST /api/invites/[token]` or named resolve/join endpoints | Resolve minimal invite state and atomically join; derive Auth ID/name and never expose an occupied seat |
| `GET /api/games/[gameId]` | Require membership then return safe projection; never resolve invites |
| Existing actions/rematch endpoints | Preserve current membership checks, engine authority, optimistic concurrency, and safe projection |
| `GET /api/history` | Query only current identity's memberships; return history summary, never other participants' private data |

The resolve endpoint must not make authorization decisions from `displayName`,
client `userId`, game ID embedded in a token, or an old client-side resolve
result. The join transaction rechecks every condition under lock.

## 15. Database implications

Retain `auth.users` references, `game_players` primary/unique constraints,
snapshot display names, canonical tables, versioning, and RLS.

Required changes:

- Make `profiles.display_name` nullable and make the new-user trigger insert
  `NULL`, not `Guest`. Preserve the 1--40 check as `display_name IS NULL OR
  char_length(display_name) BETWEEN 1 AND 40`.
- Add `games.invite_token_digest` (unique, non-null for new games), containing
  a cryptographic digest of a 128-bit-or-greater random token. Generate raw
  token server-side and return it only once to the creator/authorized invite
  presentation. Do not make it browser-readable through a general games query.
- Add lifecycle fields only if product needs explicit expiry/revocation, e.g.
  `invite_expires_at` and `invite_revoked_at`; otherwise a waiting game's status
  is enough for v1. Do not invent expiry without a product rule.
- Replace/retire the plaintext `invite_code` after a compatibility migration.
  Existing waiting games can remain joinable under their old code until they
  are filled/closed; new games use token digest. This avoids breaking sent
  links. Completed/full historical rows do not need an active invite.
- Add/use an index supporting history lookup by `game_players.user_id` joined
  to `games.last_activity_at` (the existing user/game index may need a revised
  ordering for the chosen query). This is a performance detail, not a new
  authority model.

No game-state, player-seat, score, or card schema needs redesign.

## 16. RLS and security implications

Preserve the following invariants:

- Membership is bound to `auth.uid()`/`auth.users.id`; a name is never an
  authorization credential.
- Invite possession lets a caller attempt to claim only an *open* seat. It
  never grants game read access, access to canonical state, or control of an
  existing seat.
- `GET /api/games/[gameId]`, game actions, rematch, history, Realtime
  subscription, and result access continue to require membership server-side
  and/or through RLS.
- The database uniqueness constraints and a locking RPC enforce exactly two
  seats and prohibit one Auth ID from occupying both.
- Resolve and join are server-side. The browser never receives a service/secret
  key, canonical state, future stock, raw game events, or an authorization
  decision based on client-provided user/name values.
- Keep RLS enabled on every application table, browser writes revoked, and
  canonical tables/events/actions unreadable by browser roles. Keep private
  Realtime topics member-scoped and broadcasts state-free.
- Treat invite resolution as a potential enumeration endpoint: use high
  entropy, rate limit it, return minimal information, and log only safe error
  codes/identifiers. A full invite can state “already has two players” but must
  disclose no participant or game information.

## 17. Failure-state behavior

| Situation | User experience | Server/security behavior |
| --- | --- | --- |
| Auth initialization or anonymous sign-in fails | “We couldn’t prepare your player. Try again.” Retry only. | No game/profile request without a JWT subject. |
| Profile save fails | Preserve typed name and intended create/join action; allow retry. | Do not create/join without a server-read valid profile name. |
| Invalid, expired, revoked, or nonexistent invite | “This invite is no longer available.” | Return no game/player/card data. |
| Invite is full | “This game already has two players.” Offer home. | No names, game state, or participant access. |
| Player opens own/reopened invite | “You’re already in this game.” Route to their game. | Verify existing membership by Auth ID; do not rejoin. |
| Same identity attempts second seat | Route to existing seat; if racing, show already-in-game outcome. | RPC/check plus `(game_id,user_id)` primary key rejects it. |
| Refresh during join | Resume via normal session; resolve/retry safely. | Join RPC lock/constraints make one outcome authoritative. |
| Double-click Join / concurrent final-seat claim | Button is pending; losing user sees full/unavailable. | The transaction rechecks waiting status and only one insert succeeds. |
| Lost anonymous identity | Explain original browser session is required; offer new-player start. | Never infer/recover membership from name, game URL, or invite. |
| Deliberate Reset this player | Explicit destructive confirmation; start a new player on success. | Old rows remain intact and inaccessible to new Auth ID. |
| Existing game URL under wrong identity | “This game is not available to this player.” | Return privacy-preserving not-found/no member projection. |
| Game changes while joining/playing | Refetch authoritative view; show retry where safe. | Existing transactional version/idempotency mechanisms remain final authority. |

## 18. Recommended UX terminology and copy

Use human terms that do not disclose implementation details:

| Context | Recommended copy |
| --- | --- |
| Name prompt | **What should we call you?** / label: **Your name** / button: **Continue** |
| Returning player | **Playing as Alex** / **Settings** |
| Landing actions | **New game**, **Join game**, **Recent games** |
| Waiting room | **Invite a player** / **Copy invite** / **Waiting for an opponent** |
| Join confirmation | **Join game** / “You’ll be seated as Alex.” |
| Own invite | **You’re already in this game.** |
| Full invite | **This game already has two players.** |
| Invalid invite | **This invite is no longer available.** |
| Lost identity | **This game belongs to a different player on this browser. Open it where you joined, or start a new game.** |
| Name change | **Change your name** / “This affects new games only.” |
| Reset | **Reset this player on this browser** / destructive explanation from section 10 |

Avoid: Anonymous user, guest account, authentication session, profile
initialized, login, logout, user ID, and “recover your seat” when no secure
recovery is possible.

## 19. Migration plan from the current implementation

1. **Document and test the invariants first.** Add coverage for all ownership,
   safe-projection, invite, and reset cases below before changing UX.
2. **Unify player bootstrap.** Select one anonymous-session utility, add a
   small authenticated bootstrap/profile read, and remove the unused duplicate
   route or make it the sole implementation. Do not change membership keys.
3. **Fix profile semantics.** Migrate `Guest` sentinel rows to `NULL` only when
   they are genuine untouched placeholders (avoid rewriting a user-chosen name
   of “Guest” without a migration decision). Make name readiness explicit and
   stop default-saving `Player`.
4. **Introduce secure invite tokens and APIs.** Add digest-backed token
   generation, minimal resolution, and locked idempotent join. Keep the current
   join RPC's seat constraints and atomic start. Support legacy waiting code
   links only for a deliberately bounded compatibility period.
5. **Separate routes/UI.** Build `/join/[invite]`, remove `?invite=` from
   `/game/[gameId]`, and give waiting members a copyable link. Make game route
   membership-only and give wrong-identity/lost-session states clear copy.
6. **Simplify navigation.** Replace the permanent name form with a compact
   player control, add `/history` and `/settings`, and delete/unlink legacy
   starter login/signup/protected/logout UI from the game product.
7. **Replace logout safely.** Remove ordinary guest Logout. If needed, ship the
   intentionally confirmed Reset control after its tests are in place.
8. **Verify live behavior.** Run SQL/RLS, unit, targeted E2E, lint, typecheck,
   and production build checks. Review deployed Supabase anonymous-sign-in,
   session persistence, rate limiting, and token handling before enabling the
   new invitation path.

## 20. Tests that should exist

### Unit and route tests

- First visit creates exactly one anonymous session; a returning session is
  reused and is never replaced by bootstrap.
- Bootstrap reports unnamed/named profile correctly; name normalization and
  validation are shared by profile, create, and join paths.
- Changing a profile name does not alter existing `game_players` snapshots,
  results, history, or rematch snapshots.
- Create rejects unnamed players, creates a creator seat/invite atomically, and
  returns the invite only to the authorized waiting creator.
- Invite resolution returns only `OPEN`, `ALREADY_A_PLAYER`, `FULL`, or generic
  unavailable data appropriate to the requester; it never serializes game
  state, names, IDs for non-members, or cards.
- Existing member opening an invite routes to the game; creator cannot claim
  seat 1; a third identity cannot join; a game ID URL alone grants no access.
- Two simultaneous joins and repeated/double-click joins yield exactly one
  second seat/start. Losing requests return safe full/unavailable responses.
- Game fetch/action/rematch/history reject wrong anonymous identities and
  preserve all current safe projection guarantees.
- Reset creates a different Auth ID, clears old browser access, does not delete
  old Auth/game data, and cannot reclaim a previous seat.

### SQL/RLS tests

- Keep current deny/read/membership tests and add that invite token digest is
  not selectable by browser roles or non-members.
- Verify member-safe invite display access, no direct browser calls to resolve/
  join RPCs if they are service-role-only, and all grants/revokes after new
  migrations.
- Verify constraints/RPC behavior for self-join, full game, concurrent seat
  claim, token expiry/revocation if introduced, and historical legacy invite
  compatibility.

### Playwright scenarios

- New player creates, copies `/join/[token]`, and another clean browser opens
  it, names itself only when needed, explicitly joins, and both play.
- Returning named browser is not prompted again; new game creates directly.
- Creator/rejoining participant opens the same invite and is routed to the
  existing game without duplicate membership.
- A third browser sees full with no names/card/table content.
- Refresh in waiting, immediately before/during join, and during play preserves
  seats and never exposes opponent cards.
- Clearing site data or using Reset produces the lost-identity explanation and
  cannot enter the old game even with the invite URL.
- Accessibility checks cover focus/error recovery in name prompt, join
  confirmation, full/unavailable states, copy invite, and reset confirmation.

## Summary of retained versus removed concepts

Retain anonymous Supabase Auth, profiles, immutable game-player name snapshots,
server membership checks, RLS, transaction-safe seat claim, canonical server
state, version/idempotency handling, and private Realtime authorization.

Remove the guest/profile/name sentinel ambiguity, query-string invitation,
landing-page-only join, routine anonymous Logout, duplicate session bootstrap,
and legacy account-starter surfaces from the v1 game journey. Add only the
small missing boundaries: current-player bootstrap, clean invite acceptance,
history, settings, and an optional deliberately destructive reset control.
