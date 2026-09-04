# Gin Rummy v1 Architecture

## Scope and primary decisions

This is a Next.js 16.3.3 App Router application deployed on Vercel. Supabase provides
anonymous Auth, Postgres, and Realtime. Postgres is the durable source of truth.

The pure TypeScript engine in src/game is the only rules authority. Trusted server code
invokes it with canonical state and a trusted action. Browsers submit intent only; they
cannot submit a deck, dealer, score, result, canonical state, or state transition.

Card Studio is a separate presentation subsystem with a deliberately public prototype
editor. PostgreSQL remains authoritative for its active published manifest, while the
game engine, canonical game records, action RPCs, and player-safe projections have no
card-art fields or dependencies. Open games resolve the current global presentation at
render time instead of snapshotting artwork into game state.

V1 signs visitors in anonymously before they create, join, or open a game. Each guest
therefore has a genuine auth.users.id UUID without email/password friction. Supabase's
SSR cookie/browser storage retains the session. Any future account-linking flow must
link the anonymous identity rather than replace it, preserving game membership.

## Trust boundary

~~~
Browser
  authenticated intent + expected version + actionId
       |
       v
Next.js route handler
  authenticate / membership / parse / secure randomness / pure engine / projection
       |
       v
server-only service-role Supabase client and transactional RPC
  lock + version check + canonical state + events + action receipt
       |
       +--> private Realtime { gameId, version } notification
       v
Postgres
~~~

The public Supabase URL and anonymous key may exist in browser code. The service-role
key exists only in server modules and is never public.

The Card Studio boundary is narrower: browser code calls same-origin `/api/card-art`
routes and renders returned public asset URLs. Route handlers pass mutations through
`requireCardArtEditor`, then server-only services use the privileged repository. The
prototype guard intentionally allows every caller; administrator authentication later
replaces that one guard without moving credentials into the browser or changing the
route, service, repository, or UI boundaries. Browser code never receives a service
credential, imports the privileged repository, or writes to Supabase Storage directly.

game_state.canonical_state contains both hands, the complete stock order, and all other
canonical cards. game_events.payload can contain hidden draw/deal facts. Neither is
readable, writable, or subscribed to by browser clients. Server logs use game IDs,
versions, and error codes instead of serializing canonical state.

## Data model

Use UUIDs and timestamptz; generate IDs in Postgres except caller-provided action
idempotency UUIDs. Enable citext so invite codes are case-insensitively unique.

### profiles

| Column | Purpose |
| --- | --- |
| id uuid primary key references auth.users(id) on delete cascade | Supabase user identity |
| display_name text not null | normalized server-side, 1–40 characters |
| created_at, updated_at timestamptz not null | audit fields |

A narrow security-definer trigger creates a placeholder profile for each new Auth user.
The create/join/profile APIs set the validated name. Game membership keeps a display
name snapshot, so profile edits never rewrite game history.

### games

| Column | Purpose |
| --- | --- |
| id uuid primary key | URL game identifier |
| invite_code citext null unique | short private invite code; null for single-player |
| status game_status not null | WAITING, PLAYING, HAND_COMPLETE, or COMPLETE |
| rules jsonb not null | immutable, validated GameRules snapshot |
| created_by uuid not null references auth.users(id) | creator |
| source_game_id uuid null references games(id) | accepted-rematch origin; unique when present |
| rematch_requested_by uuid null references auth.users(id) | completed-game request state |
| game_mode text not null | MULTIPLAYER or SINGLE_PLAYER |
| bot_profile text null | CASUAL_V1 only for Naia games |
| lifecycle timestamps | created_at, started_at, completed_at, last_activity_at |

game_status is a PostgreSQL enum. Its values are a query/history index updated in the
same transaction as canonical state; engine phase and scores remain authoritative.

### game_players

| Column | Purpose |
| --- | --- |
| game_id uuid not null references games(id) on delete cascade | game |
| participant_id uuid not null | stable engine player identity |
| user_id uuid null references auth.users(id) | authenticated seat owner for humans; null for bots |
| player_kind text not null | HUMAN or BOT |
| seat smallint not null check (seat in (0, 1)) | stable two-player seat |
| display_name text not null | name at join time |
| joined_at, last_seen_at timestamptz not null | history and advisory presence |

Primary key: (game_id, participant_id). A unique (game_id, seat) makes a third player
impossible, and a partial unique (game_id, user_id) prevents a human taking both seats.
last_seen_at is never used to decide turns, outcomes, or forfeits. Existing human
participants are backfilled with `participant_id = user_id`; `HUMAN` rows retain a
required Auth user, while `BOT` rows require `user_id is null`. Action actors, private
event recipients, and results reference the game participant rather than `auth.users`,
so Naia never needs a fake account. Browser membership and RLS continue to use the
human row's `user_id`.

### game_state

| Column | Purpose |
| --- | --- |
| game_id uuid primary key references games(id) on delete cascade | one checkpoint per game |
| version integer not null check (version >= 0) | optimistic-concurrency token |
| canonical_state jsonb not null | exact serialized engine GameState |
| updated_at timestamptz not null | checkpoint time |

The server validates full engine invariants before each write. SQL checks basic shape
and embedded-version consistency, but does not reimplement game rules.

### game_actions

This is the server-only durable idempotency receipt.

| Column | Purpose |
| --- | --- |
| action_id uuid primary key | caller-generated idempotency UUID |
| game_id uuid not null references games(id) on delete cascade | action game |
| actor_id uuid not null references auth.users(id) | request identity |
| expected_version integer not null | received version |
| action_type text not null | allow-listed action kind |
| card_id text null | discard/knock/gin card bound to this receipt |
| accepted_version integer not null | version committed by this action |
| created_at timestamptz not null | receipt time |

Add index (game_id, created_at desc). A retry returns a fresh, authorized projection
of current state, not a stored projection. Reuse of an action ID with another game,
actor, expected version, action type, or card is an error.

### game_events

The immutable engine-event audit stream; browser code never queries it.

| Column | Purpose |
| --- | --- |
| id bigint generated always as identity primary key | global event order |
| game_id uuid not null references games(id) on delete cascade | game |
| state_version integer not null | resulting version |
| action_id uuid not null references game_actions(action_id) | causal action |
| event_index smallint not null | order within action |
| event_type text not null | engine event name |
| visibility text not null | PUBLIC, PLAYER, or SERVER_ONLY |
| recipient_user_id uuid null | required for PLAYER, otherwise null |
| payload jsonb not null | serialized engine event |
| created_at timestamptz not null | audit time |

Constrain (action_id, event_index) unique and index (game_id, state_version, id).
Visibility is trusted-code metadata, not a browser access grant. Private stock-draw
events remain database-private.

### game_results

One row is inserted only when a match completes.

| Column | Purpose |
| --- | --- |
| game_id uuid primary key references games(id) on delete cascade | completed game |
| winner_id, loser_id uuid not null references auth.users(id) | participants |
| final_scores jsonb not null | immutable score map |
| completed_hands jsonb not null | engine GameResult.completedHands |
| completed_at timestamptz not null | history ordering |

Completed hand detail is persisted because it is safe to reveal to participants after
scoring. The engine's cancelled hand result contains no hands.

### card_art_sets

This presentation-only table stores named mutable drafts and immutable published
snapshots. Names are trimmed, 1–80 characters, and intentionally non-unique.

| Column | Purpose |
| --- | --- |
| id uuid primary key | set identifier and randomized asset-path namespace |
| name text not null | display name; uniqueness is not required |
| draft_manifest jsonb not null | partial `FaceCardSlot` to immutable Storage object-path map |
| draft_version integer not null | optimistic-concurrency token for slot mutations |
| published_manifest jsonb not null | last atomically published draft snapshot |
| published_revision integer not null | monotonic cache and publication revision |
| archived_at timestamptz null | read-only archive marker |
| created_at, updated_at timestamptz not null | audit fields |

Draft replacement updates `draft_manifest` and `draft_version` only. It does not delete
superseded processed objects because an older published snapshot may still reference
them. Archived rows remain available for audit and cannot be edited or activated.

### card_art_settings

The singleton row contains `active_set_id` and `active_revision`. A null set with
revision zero means the built-in design; a custom set requires a positive revision that
matches the referenced set's published revision. Database triggers reject an archived
or mismatched active target and reject archiving the active set. The activation RPC
locks both settings and the selected set, checks the supplied draft and published
versions, copies the draft to the published snapshot, increments the revision, and
changes the global selection atomically. Reset locks settings and restores the built-in
selection.

### Card-art Storage

The public `card-art` bucket contains processed 600×900 WebP assets only. Objects use
immutable randomized paths under `sets/<set-id>/<slot>/<uuid>.webp`. Anonymous and
authenticated roles may read objects, because artwork must render in public games, but
they have no insert, update, or delete policy. All writes pass through the server-only
repository using the service credential. Superseded processed assets stay readable if
their randomized URL is known; asset garbage collection is out of scope.

## Migrations and transactional persistence

Create ordered migrations under supabase/migrations/:

1. 0001_extensions_and_types.sql enables pgcrypto and citext, defines game_status, and
   provides shared timestamp support.
2. 0002_game_tables.sql creates tables, foreign keys, constraints, and indexes.
3. 0003_profiles_trigger.sql creates the narrowly-scoped Auth profile trigger.
4. 0004_rls.sql enables RLS, revokes broad grants, and installs policies.
5. 0005_commit_game_action.sql defines the server-only commit RPC.
6. 0006_realtime.sql defines private-channel authorization policies.
7. 0007 through 0013 refine lifecycle, invite, action, and rematch behavior.
8. 0014_card_art_studio.sql adds the presentation-only Card Studio tables, Storage
   policy, archive guards, and atomic activation/reset RPCs.

commit_game_action is a plpgsql RPC callable only by the server service_role. It receives
an engine-validated candidate state, derived game metadata and optional result, plus
ordered engine events. In one transaction it:

1. Looks up action_id. For the exact same actor and action payload, returns its accepted
   version without applying again; it rejects conflicting reuse.
2. Locks the game_state row with SELECT FOR UPDATE.
3. Compares database version to p_expected_version; returns a typed stale outcome with
   no writes on mismatch.
4. Checks candidate state version equals expected + 1 and event versions agree.
5. Updates canonical state and game lifecycle index; inserts receipt/events; upserts
   game_results only when complete.
6. Returns COMMITTED with the resulting version.

The RPC is SECURITY INVOKER, not a user-callable SECURITY DEFINER function. Revoke
execute from public, anon, and authenticated; grant only to service_role. A user-JWT
RPC accepting next_state would let a browser forge results even if it verified
membership.

Creation, join-and-start, and accepted-rematch creation use separate transaction-safe
RPCs. Join locks the game, confirms it is waiting, inserts seat 1, creates the initial
canonical state/deal/events, and changes status atomically. No sequence of unrelated
Supabase calls substitutes for a transaction.

Rematch acceptance locks the completed source game and returns its existing rematch on
a retry. A partial unique index on source_game_id prevents concurrent trusted callers
from creating more than one accepted rematch for the same game.

If two requests load the same version and apply the engine in memory, only one commit
can lock and update it. The loser discards its candidate, refetches a projection, and
receives a stale response.

## RLS and grants

Enable RLS on every application table and revoke default table grants. Anonymous
Supabase users are in the authenticated role after anonymous sign-in.

| Table | Browser reads | Browser writes |
| --- | --- | --- |
| profiles | own row only | none; use server API |
| games | games where caller is a member | none |
| game_players | own seat only | none |
| game_results | completed games where caller is a member | none |
| game_state | deny all | deny all |
| game_events | deny all | deny all |
| game_actions | deny all | deny all |

The membership predicate used for safe game/result reads is:

~~~sql
exists (
  select 1 from public.game_players gp
  where gp.game_id = games.id
    and gp.user_id = auth.uid()
)
~~~

Absence of a policy is intentional for canonical tables and all browser writes. Even
metadata writes are server-only, avoiding lifecycle corruption and forged history.

Use private Supabase Broadcast/Presence channels named game:<game-id>. The
realtime.messages SELECT policy permits a subscription only when realtime.topic()
identifies a game having a game_players row for auth.uid(). There is no
authenticated-client INSERT policy; server code broadcasts using service credentials.
Use the exact Realtime policy helper syntax supported by the deployed Supabase version.

Invite resolution is server-only. A non-member cannot query by invite code; a full or
invalid invite gets a generic safe response. A share URL is an invitation to take an
open seat, never a credential that reveals an existing player's private cards.

Card Studio tables likewise grant no browser-role access. Public asset reads are the
only direct Supabase access added for artwork. The editor's public prototype posture is
implemented in the server guard, not by granting database or Storage mutations to
anonymous clients.

## API boundaries

Route handlers orchestrate authentication, repository access, engine execution, and
projection. They are not a second rules engine.

| Endpoint | Responsibility |
| --- | --- |
| POST /api/session/anonymous | establish anonymous session if none exists |
| POST /api/profile | validate/save display name |
| POST /api/games | create waiting game and creator seat |
| POST /api/games with `SINGLE_PLAYER` | atomically create, seat, deal, and start a match against Naia |
| POST /api/games/join | resolve invite, atomically claim seat/start game |
| GET /api/games/[gameId] | membership check and fresh player projection |
| POST /api/games/[gameId]/actions | authoritative action application |
| POST /api/games/[gameId]/bot-action | version-check and commit exactly one pending Naia action |
| GET /api/history | member-safe summaries, newest first |
| POST /api/games/[gameId]/rematch | request/accept/decline; acceptance creates new game |

Card-art route handlers form a separate presentation API:

| Endpoint | Responsibility |
| --- | --- |
| GET /api/card-art | return the active published manifest or built-in selection |
| GET /api/card-art/sets?includeArchived=true | list editor-facing sets and versions |
| POST /api/card-art/sets | create a named empty draft |
| PATCH /api/card-art/sets/[setId] | rename or archive a non-archived, non-active set |
| POST /api/card-art/sets/[setId]/slots/[slot] | validate, process, upload, and version a cropped draft image |
| DELETE /api/card-art/sets/[setId]/slots/[slot] | remove a draft slot using its expected version |
| POST /api/card-art/sets/[setId]/activate | atomically publish and globally activate the expected draft/revision |
| POST /api/card-art/default/activate | restore the built-in global design |

The shared public manifest contract is:

~~~ts
type FaceCardRank = "J" | "Q" | "K";
type FaceCardSuit = "CLUBS" | "DIAMONDS" | "HEARTS" | "SPADES";
type FaceCardSlot = `${FaceCardRank}:${FaceCardSuit}`;

type ActiveCardArtManifest = {
  source: "BUILT_IN" | "CUSTOM";
  setId: string | null;
  setName: string | null;
  revision: number;
  manifest: Partial<Record<FaceCardSlot, string>>;
};
~~~

Set create/rename/archive and slot mutation responses return the current set record,
including the new `draftVersion`. Activation returns the published `revision` and full
active manifest shown above. Clients use these returned versions in later writes;
draft and activation conflicts return stable HTTP 409 error codes and never overwrite
the caller's current editor state.

### Image ingestion

The upload request reaches a Next.js route as multipart form data and is held only long
enough for server processing. The server rejects input over 10 MB, SVG and unsupported
formats, malformed/undecodable files, crops outside the normalized image, and images
over 40 million pixels. Sharp auto-orients JPEG, PNG, or WebP input, applies the locked
2:3 crop, resizes to 600×900, and encodes WebP at quality 85 without copying source
metadata. Only that resulting buffer is uploaded; the original is never persisted.

The action body is conceptually:

~~~ts
type ActionRequest = {
  expectedVersion: number;
  action: {
    actionId: string; // UUID idempotency key
    type: ClientActionType;
    cardId?: string; // only on discard, knock, and gin intents
  };
};
~~~

POST /api/games/[gameId]/actions follows this sequence:

1. Read the Supabase session and require an authenticated (including anonymous) user.
2. Verify membership and map its Auth user ID to the engine player/seat.
3. Strictly parse a discriminated allow-list. Reject trusted-only fields including
   actorId, deck, dealer, score, state, and deal plan.
4. Load canonical state server-side and verify request version. Create a secure deal
   plan only for trusted start/deal transitions.
5. Convert the intent to a trusted GameAction and call pure applyAction.
6. Atomically persist success with commit_game_action.
7. Broadcast only { type: GAME_CHANGED, gameId, version } to the private channel.
8. Return the requesting player's fresh projection.

A stale RPC result returns HTTP 409 with a safe error code and current projection.
Engine/input errors return stable 4xx codes without hidden card information. No response
contains canonical JSON or raw persisted event payloads.

## Single-player orchestration

`src/bot` has no framework, database, clock, or ambient-randomness dependency. Its
`BotObservation` contains Naia's hand, rules, stock count, current public discard, and a
short window of public actions. It never contains the human hand or stock order. The
casual strategy ranks deadwood and meld potential, applies limited defensive memory,
and samples among nearby candidates using an injected random source.

The browser is only a wakeup clock. A projected `botActionPending` schedules a POST
after a brief delay; the endpoint reloads canonical state, verifies mode, participant,
phase, and expected version, chooses one intent, applies the engine, and commits through
the existing optimistic-concurrency RPC. The returned safe projection may schedule the
next phase. Multiple tabs, refreshes, and retries are safe because only one same-version
candidate can commit. If no browser is open, a single-player game pauses until resumed.

## Player-safe state projection

src/server/game-projection.ts is the only serializer from GameState to browser data.
React code consumes PlayerGameView, never GameState.

A projection includes public game identity/version/phase/rules, public scores, stock
count, public discard pile, dealer/turn status, and the caller's hand and legal
controls. It includes only opponent name, seat, score, and card count. It includes the
opening up-card and pass facts when public.

During active play, the projection derives every rule-valid meld candidate from the
caller's own hand. The browser may use those candidates for private, cosmetic grouping
feedback, but it never submits display order or inferred scoring state.

During the caller's active discard decision, the projection also derives an outcome for
each legal discard candidate: minimum post-discard deadwood and whether that candidate
permits knock or gin. These outcomes are omitted for the non-active player and contain
no opponent or stock information; the server still validates the submitted declaration
against canonical state.

After an engine-scored hand, it includes engine-permitted revealed hands, melds,
deadwood, layoffs, declaration, score, and next-hand readiness. A cancelled result
includes its reason and scores but neither hand. Game-complete data is projected to a
typed, named score and completed-hand summary rather than returning canonical state.

A projection never includes an opponent current hand, opponent private stock draw,
future stock/deck order, deal plan, raw event, raw action, or canonical JSON.
legalControls helps UI rendering only; server validation remains authoritative.

## Realtime and reconnect

The game page always calls GET /api/games/[gameId] before enabling controls, then
subscribes to its private channel. A GAME_CHANGED message is only a refetch hint. The
client debounces fetches, replaces local data solely with a returned projection, and
ignores out-of-order versions. Realtime never sends game state or cards.

Presence on that private channel is advisory UI state for online/offline status. It can
show a disconnected opponent and disable actions that require both players, but never
auto-forfeits or decides game rules.

Refresh, missed notification, WebSocket loss, browser restart, and reconnect all
recover by fetching the authoritative projection. While locally disconnected, preserve
the last view as visibly non-authoritative and disable actions. Retrying a possibly
accepted request reuses actionId; the receipt makes it safe. A stale action discards the
pending intent and uses the returned projection.

Guest seat recovery requires retained anonymous-session/browser storage. A share URL
can join a waiting invite but cannot recover a lost guest private seat.

## Card-art polling and rendering

`CardArtProvider` is outside the canonical game-data provider. While the document is
visible, it fetches `GET /api/card-art` immediately and every five seconds with
`no-store`; it stops the interval and aborts an in-flight request while hidden, then
refreshes immediately when visibility returns. Request identity and abort checks prevent
an older response from replacing a newer one. A transient network, HTTP, or malformed
response preserves the last successful manifest.

Published object URLs carry the active revision as `?v=<revision>`, so a newly
published snapshot changes the browser cache key. `CardFace` consults only the partial
presentation manifest for J/Q/K. It keeps code-rendered ranks, suits, card stock,
markers, and accessibility names, and layers uploaded art directly over the cream stock
and beneath a separate ornamental frame. Alpha is preserved in processed WebP assets so
transparent portrait cutouts reveal the card stock; opaque artwork remains compatible. Absent
or failed images reveal the built-in court design underneath. The same renderer is used for the local hand, public discard, and
completed-hand cards only after `PlayerGameView` already permits those cards to be
visible. It never expands what the projection reveals.

## Card-art isolation invariants

- Service and legacy service-role environment variables are referenced only by the
  `server-only` Supabase administrator module (with test runners checking configuration
  only); they are never imported or serialized by client components.
- Card-art database and Storage mutations are reachable only through server routes and
  service-role repository calls. Public Storage policy grants reads, never raw writes.
- The upload pipeline persists only the processed WebP buffer. No original upload path,
  blob, or metadata is stored.
- Service checks, the activation RPC, the active-settings validation trigger, and the
  active-archive trigger prevent archived sets from becoming active and active sets
  from being archived, even if the UI guard is bypassed.
- No card-art identifier, revision, manifest, URL, or binary appears in `GameState`,
  `game_state.canonical_state`, engine events/actions, or `PlayerGameView`. Artwork is
  optional presentation data fetched independently of the game API.

## Source layout

~~~
src/
  app/
    page.tsx
    game/[gameId]/page.tsx
    history/page.tsx
    api/
      session/anonymous/route.ts
      profile/route.ts
      games/route.ts
      games/join/route.ts
      games/[gameId]/route.ts
      games/[gameId]/actions/route.ts
      games/[gameId]/rematch/route.ts
      history/route.ts
  game/                         # pure engine specified in GAME_ENGINE.md
  server/
    auth.ts                     # request identity and membership
    supabase-admin.ts           # server-only service-role client
    game-repository.ts          # canonical load and RPC adapters
    game-action-service.ts      # engine/commit orchestration
    game-input.ts               # strict intent parser
    game-projection.ts          # PlayerGameView serializer
    realtime.ts                 # safe broadcast/presence helpers
  lib/supabase/
    browser.ts                  # public-key browser client
    server.ts                   # cookie-aware user-scoped server client
  components/game/              # consumes PlayerGameView only
supabase/
  migrations/
  tests/                        # SQL/RLS integration tests
~~~

Server modules import server-only. Client components must not import server modules,
canonical database types, or game-state types. Share request/view DTOs through a
dependency-free module when needed.

Card Studio follows that split in the root `app/api/card-art` and `app/card-studio`
routes, `src/server/card-art-*` services, `src/shared/card-art.ts` contracts,
`components/card-studio`, and the presentation-only card-art provider/renderer under
`components/game`.

## Environment

~~~dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
~~~

Vercel supplies these separately for Preview and Production. The service role key is
never committed, logged, sent to the browser, or added to a public environment variable.
Configure Supabase Auth site/redirect URLs for Vercel and local development before any
future account-linking flow.

## Testing strategy

The Vitest engine suite in GAME_ENGINE.md is the base. Add:

- Route/service tests for anonymous identity, membership, strict payload parsing,
  server-only secure deal plans, stable errors, and absence of canonical state.
- Projection contract tests for both seats across every phase. Recursively assert hidden
  card IDs are absent, scored results reveal only allowed data, and cancelled results
  reveal no hands.
- Local Supabase/Postgres RPC tests proving only one same-version action commits; state,
  events, receipt, metadata, and result are all committed or all absent; retries are
  idempotent; and conflicting action IDs fail.
- SQL RLS tests using user A, user B, and non-member C. Verify safe metadata access,
  deNaial of canonical/event/action reads and writes, deNaial of commit RPC execution,
  and private Realtime subscription authorization.
- Targeted Playwright flows for anonymous create/join, full-game rejection, stale double
  submission, refresh in each product state, retry/reconnect, and network-response
  checks for private-card leakage.
- Card Studio unit/component tests for slot and manifest validation, draft/published
  isolation, Sharp decoding and sanitization, polling/visibility/stale responses,
  optimistic conflict recovery, accessible crop/activation workflows, and image
  fallback. pgTAP covers grants, RLS, Storage policy, atomic activation, version
  conflicts, archive guards, and built-in reset. One two-context Playwright flow checks
  shared published portraits without revealing either opponent hand.

Run targeted tests during implementation. At major milestones run npm test, npm run
lint, and npm run build.
