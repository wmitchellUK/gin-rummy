-- Single-player games use game participants rather than fake Auth accounts.
alter table public.games
  add column game_mode text not null default 'MULTIPLAYER'
    check (game_mode in ('MULTIPLAYER', 'SINGLE_PLAYER')),
  add column bot_profile text
    check (bot_profile is null or bot_profile = 'CASUAL_V1');

alter table public.games alter column invite_code drop not null;
alter table public.games add constraint games_bot_configuration_check check (
  (game_mode = 'MULTIPLAYER' and bot_profile is null)
  or (game_mode = 'SINGLE_PLAYER' and bot_profile = 'CASUAL_V1' and invite_code is null and invite_token_digest is null)
);

alter table public.game_players add column participant_id uuid;
alter table public.game_players add column player_kind text not null default 'HUMAN'
  check (player_kind in ('HUMAN', 'BOT'));
update public.game_players set participant_id = user_id where participant_id is null;

alter table public.game_players drop constraint game_players_pkey;
alter table public.game_players alter column user_id drop not null;
alter table public.game_players alter column participant_id set not null;
alter table public.game_players add primary key (game_id, participant_id);
create unique index game_players_human_user_idx on public.game_players(game_id, user_id) where user_id is not null;
alter table public.game_players add constraint game_players_identity_check check (
  (player_kind = 'HUMAN' and user_id is not null and participant_id = user_id)
  or (player_kind = 'BOT' and user_id is null)
);

create or replace function public.fill_human_participant_id()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.player_kind = 'HUMAN' and new.participant_id is null then new.participant_id := new.user_id; end if;
  return new;
end;
$$;
create trigger game_players_fill_human_participant
  before insert on public.game_players
  for each row execute function public.fill_human_participant_id();
revoke all on function public.fill_human_participant_id() from public, anon, authenticated;

alter table public.game_actions drop constraint game_actions_actor_id_fkey;
alter table public.game_actions add constraint game_actions_actor_participant_fkey
  foreign key (game_id, actor_id) references public.game_players(game_id, participant_id);

alter table public.game_events drop constraint game_events_recipient_user_id_fkey;
alter table public.game_events add constraint game_events_recipient_participant_fkey
  foreign key (game_id, recipient_user_id) references public.game_players(game_id, participant_id);

alter table public.game_results drop constraint game_results_winner_id_fkey;
alter table public.game_results drop constraint game_results_loser_id_fkey;
alter table public.game_results add constraint game_results_winner_participant_fkey
  foreign key (game_id, winner_id) references public.game_players(game_id, participant_id);
alter table public.game_results add constraint game_results_loser_participant_fkey
  foreign key (game_id, loser_id) references public.game_players(game_id, participant_id);

create or replace function public.create_bot_game(
  p_game_id uuid,
  p_bot_player_id uuid,
  p_creator_id uuid,
  p_display_name text,
  p_rules jsonb,
  p_next_state jsonb,
  p_events jsonb,
  p_source_game_id uuid default null
)
returns table(game_id uuid, version integer)
language plpgsql security invoker set search_path = public
as $$
declare
  v_source public.games%rowtype;
  v_existing_id uuid;
  v_event jsonb;
  v_action_id uuid := gen_random_uuid();
  v_index integer := 0;
begin
  if p_source_game_id is not null then
    select * into v_source from public.games where id = p_source_game_id for update;
    if not found or v_source.status <> 'COMPLETE' or v_source.game_mode <> 'SINGLE_PLAYER'
      or not exists (
        select 1 from public.game_players gp
        where gp.game_id = p_source_game_id and gp.user_id = p_creator_id and gp.player_kind = 'HUMAN'
      ) then
      raise exception 'REMATCH_UNAVAILABLE' using errcode = 'P0001';
    end if;
    select id into v_existing_id from public.games where source_game_id = p_source_game_id;
    if found then return query select v_existing_id, 1; return; end if;
  end if;

  if p_bot_player_id = p_creator_id
    or coalesce(p_next_state->>'gameId', '') <> p_game_id::text
    or coalesce((p_next_state->>'version')::integer, -1) <> 1
    or jsonb_typeof(p_events) <> 'array'
    or exists (select 1 from jsonb_array_elements(p_events) e where coalesce((e->>'stateVersion')::integer, -1) <> 1)
    or p_next_state->>'phase' = 'WAITING_FOR_PLAYER'
    or jsonb_array_length(p_next_state->'players') <> 2 then
    raise exception 'INVALID_BOT_GAME' using errcode = 'P0001';
  end if;

  insert into public.games(
    id, invite_code, invite_token_digest, status, rules, created_by, source_game_id,
    game_mode, bot_profile, started_at
  ) values (
    p_game_id, null, null, 'PLAYING', p_rules, p_creator_id, p_source_game_id,
    'SINGLE_PLAYER', 'CASUAL_V1', now()
  );
  insert into public.game_players(game_id, participant_id, user_id, player_kind, seat, display_name) values
    (p_game_id, p_creator_id, p_creator_id, 'HUMAN', 0, p_display_name),
    (p_game_id, p_bot_player_id, null, 'BOT', 1, 'Nia');
  insert into public.game_state(game_id, version, canonical_state) values (p_game_id, 1, p_next_state);
  insert into public.game_actions(action_id, game_id, actor_id, expected_version, action_type, accepted_version)
    values (v_action_id, p_game_id, p_creator_id, 0, 'START_GAME', 1);
  for v_event in select value from jsonb_array_elements(p_events) loop
    insert into public.game_events(game_id, state_version, action_id, event_index, event_type, visibility, recipient_user_id, payload)
      values (p_game_id, 1, v_action_id, v_index, v_event->>'type', coalesce(v_event->'visibility'->>'kind', 'SERVER_ONLY'),
        case when v_event->'visibility'->>'kind' = 'PLAYER' then (v_event->'visibility'->>'playerId')::uuid else null end,
        v_event);
    v_index := v_index + 1;
  end loop;
  return query select p_game_id, 1;
end;
$$;

revoke all on function public.create_bot_game(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_bot_game(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, uuid)
  to service_role;
