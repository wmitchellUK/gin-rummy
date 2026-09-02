-- Keep the action RPC compatible with an older application deployment during
-- rollout. New servers always send p_card_id for card actions, while an older
-- server may omit it. A supplied card remains validated and bound to the
-- receipt; null is accepted only as a legacy receipt without card binding.
create or replace function public.commit_game_action(
  p_action_id uuid,
  p_game_id uuid,
  p_actor_id uuid,
  p_expected_version integer,
  p_action_type text,
  p_next_state jsonb,
  p_status public.game_status,
  p_events jsonb,
  p_result jsonb default null,
  p_card_id text default null
)
returns table(outcome text, accepted_version integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing public.game_actions%rowtype;
  current_state public.game_state%rowtype;
  event jsonb;
  event_index integer := 0;
begin
  select * into existing from public.game_actions where action_id = p_action_id;
  if found then
    if existing.game_id <> p_game_id or existing.actor_id <> p_actor_id
      or existing.expected_version <> p_expected_version
      or existing.action_type <> p_action_type
      or (existing.card_id is not null and existing.card_id is distinct from p_card_id) then
      raise exception 'ACTION_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return query select 'IDEMPOTENT', existing.accepted_version;
    return;
  end if;

  select * into current_state from public.game_state where game_id = p_game_id for update;
  if not found then raise exception 'GAME_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into existing from public.game_actions where action_id = p_action_id;
  if found then
    if existing.game_id <> p_game_id or existing.actor_id <> p_actor_id
      or existing.expected_version <> p_expected_version
      or existing.action_type <> p_action_type
      or (existing.card_id is not null and existing.card_id is distinct from p_card_id) then
      raise exception 'ACTION_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return query select 'IDEMPOTENT', existing.accepted_version;
    return;
  end if;

  if current_state.version <> p_expected_version then
    return query select 'STALE', current_state.version;
    return;
  end if;
  if coalesce(p_next_state->>'gameId', '') <> p_game_id::text then
    raise exception 'INVALID_CANDIDATE_GAME' using errcode = 'P0001';
  end if;
  if coalesce((p_next_state->>'version')::integer, -1) <> p_expected_version + 1 then
    raise exception 'INVALID_CANDIDATE_VERSION' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'INVALID_EVENTS' using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_array_elements(p_events) e where coalesce((e->>'stateVersion')::integer, -1) <> p_expected_version + 1) then
    raise exception 'INVALID_EVENT_VERSION' using errcode = 'P0001';
  end if;
  if p_status = 'COMPLETE' and (p_result is null or jsonb_typeof(p_result) <> 'object') then
    raise exception 'MISSING_GAME_RESULT' using errcode = 'P0001';
  end if;
  if p_status <> 'COMPLETE' and p_result is not null then
    raise exception 'UNEXPECTED_GAME_RESULT' using errcode = 'P0001';
  end if;
  if p_card_id is not null and p_action_type not in ('DISCARD', 'KNOCK', 'GIN') then
    raise exception 'INVALID_ACTION_RECEIPT' using errcode = 'P0001';
  end if;

  update public.game_state set version = p_expected_version + 1, canonical_state = p_next_state, updated_at = now()
    where game_id = p_game_id;
  update public.games set status = p_status, last_activity_at = now(),
    started_at = case when p_status <> 'WAITING' then coalesce(started_at, now()) else started_at end,
    completed_at = case when p_status = 'COMPLETE' then coalesce(completed_at, now()) else completed_at end
    where id = p_game_id;
  insert into public.game_actions(action_id, game_id, actor_id, expected_version, action_type, card_id, accepted_version)
    values (p_action_id, p_game_id, p_actor_id, p_expected_version, p_action_type, p_card_id, p_expected_version + 1);
  for event in select value from jsonb_array_elements(p_events) loop
    insert into public.game_events(game_id, state_version, action_id, event_index, event_type, visibility, recipient_user_id, payload)
      values (p_game_id, p_expected_version + 1, p_action_id, event_index, event->>'type',
        coalesce(event->'visibility'->>'kind', 'SERVER_ONLY'),
        case when event->'visibility'->>'kind' = 'PLAYER' then (event->'visibility'->>'playerId')::uuid else null end,
        event);
    event_index := event_index + 1;
  end loop;
  if p_status = 'COMPLETE' and p_result is not null then
    insert into public.game_results(game_id, winner_id, loser_id, final_scores, completed_hands)
      values (p_game_id, (p_result->>'winnerId')::uuid, (p_result->>'loserId')::uuid,
        p_result->'finalScores', p_result->'completedHands')
      on conflict (game_id) do nothing;
  end if;
  return query select 'COMMITTED', p_expected_version + 1;
end;
$$;

revoke all on function public.commit_game_action(
  uuid, uuid, uuid, integer, text, jsonb, public.game_status, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.commit_game_action(
  uuid, uuid, uuid, integer, text, jsonb, public.game_status, jsonb, jsonb, text
) to service_role;
