# Gin Rummy v1 Architecture

## Scope and primary decisions

This is a Next.js 16.3.3 App Router application deployed on Vercel. Supabase provides
anonymous Auth, Postgres, and Realtime. Postgres is the durable source of truth.

The pure TypeScript engine in src/game is the only rules authority. Trusted server code
invokes it with canonical state and a trusted action. Browsers submit intent only; they
cannot submit a deck, dealer, score, result, canonical state, or state transition.

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
| invite_code citext not null unique | short, human-entered private invite code |
| status game_status not null | WAITING, PLAYING, HAND_COMPLETE, or COMPLETE |
| rules jsonb not null | immutable, validated GameRules snapshot |
| created_by uuid not null references auth.users(id) | creator |
| source_game_id uuid null references games(id) | accepted-rematch origin; unique when present |
| rematch_requested_by uuid null references auth.users(id) | completed-game request state |
| lifecycle timestamps | created_at, started_at, completed_at, last_activity_at |

game_status is a PostgreSQL enum. Its values are a query/history index updated in the
same transaction as canonical state; engine phase and scores remain authoritative.

### game_players

| Column | Purpose |
| --- | --- |
| game_id uuid not null references games(id) on delete cascade | game |
| user_id uuid not null references auth.users(id) | authenticated seat owner |
| seat smallint not null check (seat in (0, 1)) | stable two-player seat |
| display_name text not null | name at join time |
| joined_at, last_seen_at timestamptz not null | history and advisory presence |

Primary key: (game_id, user_id). A unique (game_id, seat) makes a third player
impossible; the primary key prevents a user taking both seats. last_seen_at is never
used to decide turns, outcomes, or forfeits.

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

## Migrations and transactional persistence

Create ordered migrations under supabase/migrations/:

1. 0001_extensions_and_types.sql enables pgcrypto and citext, defines game_status, and
   provides shared timestamp support.
2. 0002_game_tables.sql creates tables, foreign keys, constraints, and indexes.
3. 0003_profiles_trigger.sql creates the narrowly-scoped Auth profile trigger.
4. 0004_rls.sql enables RLS, revokes broad grants, and installs policies.
5. 0005_commit_game_action.sql defines the server-only commit RPC.
6. 0006_realtime.sql defines private-channel authorization policies.

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

## API boundaries

Route handlers orchestrate authentication, repository access, engine execution, and
projection. They are not a second rules engine.

| Endpoint | Responsibility |
| --- | --- |
| POST /api/session/anonymous | establish anonymous session if none exists |
| POST /api/profile | validate/save display name |
| POST /api/games | create waiting game and creator seat |
| POST /api/games/join | resolve invite, atomically claim seat/start game |
| GET /api/games/[gameId] | membership check and fresh player projection |
| POST /api/games/[gameId]/actions | authoritative action application |
| GET /api/history | member-safe summaries, newest first |
| POST /api/games/[gameId]/rematch | request/accept/decline; acceptance creates new game |

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

## Player-safe state projection

src/server/game-projection.ts is the only serializer from GameState to browser data.
React code consumes PlayerGameView, never GameState.

A projection includes public game identity/version/phase/rules, public scores, stock
count, public discard pile, dealer/turn status, and the caller's sorted hand and legal
controls. It includes only opponent name, seat, score, and card count. It includes the
opening up-card and pass facts when public.

After an engine-scored hand, it includes engine-permitted revealed hands, melds,
deadwood, layoffs, declaration, and score. A cancelled result includes its reason and
scores but neither hand. Game-complete data is likewise participant-safe.

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
  denial of canonical/event/action reads and writes, denial of commit RPC execution,
  and private Realtime subscription authorization.
- Targeted Playwright flows for anonymous create/join, full-game rejection, stale double
  submission, refresh in each product state, retry/reconnect, and network-response
  checks for private-card leakage.

Run targeted tests during implementation. At major milestones run npm test, npm run
lint, and npm run build.
