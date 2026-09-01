create or replace function public.request_rematch(p_game_id uuid, p_user_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.status <> 'COMPLETE'
    or not exists (select 1 from public.game_players where game_id = p_game_id and user_id = p_user_id) then
    raise exception 'REMATCH_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_game.rematch_requested_by is not null and v_game.rematch_requested_by <> p_user_id then
    raise exception 'REMATCH_UNAVAILABLE' using errcode = 'P0001';
  end if;
  update public.games set rematch_requested_by = p_user_id, last_activity_at = now() where id = p_game_id;
end;
$$;

create or replace function public.accept_rematch(
  p_game_id uuid, p_user_id uuid, p_new_game_id uuid, p_invite_code citext, p_next_state jsonb, p_events jsonb
)
returns table(game_id uuid, version integer)
language plpgsql security invoker set search_path = public
as $$
declare v_game public.games%rowtype; v_player record; v_action_id uuid := gen_random_uuid(); v_event jsonb; v_index integer := 0;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.status <> 'COMPLETE' or v_game.rematch_requested_by is null or v_game.rematch_requested_by = p_user_id
    or not exists (select 1 from public.game_players where game_id = p_game_id and user_id = p_user_id) then
    raise exception 'REMATCH_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if coalesce(p_next_state->>'gameId', '') <> p_new_game_id::text or coalesce((p_next_state->>'version')::integer, -1) <> 1
    or jsonb_typeof(p_events) <> 'array'
    or exists (select 1 from jsonb_array_elements(p_events) e where coalesce((e->>'stateVersion')::integer, -1) <> 1) then
    raise exception 'REMATCH_UNAVAILABLE' using errcode = 'P0001';
  end if;
  insert into public.games(id, invite_code, status, rules, created_by, source_game_id, started_at)
    values (p_new_game_id, p_invite_code, 'PLAYING', v_game.rules, p_user_id, p_game_id, now());
  for v_player in select user_id, seat, display_name from public.game_players where game_id = p_game_id order by seat loop
    insert into public.game_players(game_id, user_id, seat, display_name) values (p_new_game_id, v_player.user_id, v_player.seat, v_player.display_name);
  end loop;
  insert into public.game_state(game_id, version, canonical_state) values (p_new_game_id, 1, p_next_state);
  insert into public.game_actions(action_id, game_id, actor_id, expected_version, action_type, accepted_version)
    values (v_action_id, p_new_game_id, p_user_id, 0, 'START_GAME', 1);
  for v_event in select value from jsonb_array_elements(p_events) loop
    insert into public.game_events(game_id, state_version, action_id, event_index, event_type, visibility, recipient_user_id, payload)
      values (p_new_game_id, 1, v_action_id, v_index, v_event->>'type', coalesce(v_event->'visibility'->>'kind', 'SERVER_ONLY'),
        case when v_event->'visibility'->>'kind' = 'PLAYER' then (v_event->'visibility'->>'playerId')::uuid else null end, v_event);
    v_index := v_index + 1;
  end loop;
  return query select p_new_game_id, 1;
end;
$$;

revoke all on function public.request_rematch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_rematch(uuid, uuid, uuid, citext, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.request_rematch(uuid, uuid) to service_role;
grant execute on function public.accept_rematch(uuid, uuid, uuid, citext, jsonb, jsonb) to service_role;
