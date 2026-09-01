create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  invite_code citext not null unique,
  status public.game_status not null default 'WAITING',
  rules jsonb not null,
  created_by uuid not null references auth.users(id),
  source_game_id uuid references public.games(id),
  rematch_requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_activity_at timestamptz not null default now()
);

create table public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  seat smallint not null check (seat in (0, 1)),
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (game_id, user_id),
  unique (game_id, seat)
);

create table public.game_state (
  game_id uuid primary key references public.games(id) on delete cascade,
  version integer not null check (version >= 0),
  canonical_state jsonb not null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(canonical_state) = 'object'),
  check ((canonical_state->>'version')::integer = version)
);

create table public.game_actions (
  action_id uuid primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  expected_version integer not null check (expected_version >= 0),
  action_type text not null,
  accepted_version integer not null check (accepted_version >= 0),
  created_at timestamptz not null default now()
);

create table public.game_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  state_version integer not null check (state_version >= 0),
  action_id uuid not null references public.game_actions(action_id),
  event_index smallint not null check (event_index >= 0),
  event_type text not null,
  visibility text not null check (visibility in ('PUBLIC', 'PLAYER', 'SERVER_ONLY')),
  recipient_user_id uuid references auth.users(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (action_id, event_index),
  check ((visibility = 'PLAYER') = (recipient_user_id is not null))
);

create table public.game_results (
  game_id uuid primary key references public.games(id) on delete cascade,
  winner_id uuid not null references auth.users(id),
  loser_id uuid not null references auth.users(id),
  final_scores jsonb not null,
  completed_hands jsonb not null,
  completed_at timestamptz not null default now(),
  check (winner_id <> loser_id)
);

create index game_actions_game_created_idx on public.game_actions(game_id, created_at desc);
create index game_events_game_version_id_idx on public.game_events(game_id, state_version, id);
create index game_players_user_game_idx on public.game_players(user_id, game_id);
create index games_last_activity_idx on public.games(last_activity_at desc);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
