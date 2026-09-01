create or replace function public.create_waiting_game(
  p_invite_code citext, p_creator_id uuid, p_display_name text, p_rules jsonb
)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare v_game_id uuid := gen_random_uuid();
begin
  insert into public.games(id, invite_code, status, rules, created_by)
    values (v_game_id, p_invite_code, 'WAITING', p_rules, p_creator_id);
  insert into public.game_players(game_id, user_id, seat, display_name)
    values (v_game_id, p_creator_id, 0, p_display_name);
  insert into public.game_state(game_id, version, canonical_state)
    values (v_game_id, 0, jsonb_build_object(
      'gameId', v_game_id::text, 'version', 0, 'rules', p_rules,
      'players', jsonb_build_array(jsonb_build_object('id', p_creator_id::text, 'hand', '[]'::jsonb, 'matchScore', 0)),
      'handNumber', 0, 'dealerId', null, 'stock', '[]'::jsonb, 'discardPile', '[]'::jsonb,
      'handHistory', '[]'::jsonb, 'phase', 'WAITING_FOR_PLAYER'
    ));
  return v_game_id;
end;
$$;

create or replace function public.join_game_and_start(
  p_invite_code citext, p_user_id uuid, p_display_name text, p_next_state jsonb, p_events jsonb
)
returns table(game_id uuid, version integer)
language plpgsql security invoker set search_path = public
as $$
declare v_game public.games%rowtype; v_action_id uuid := gen_random_uuid(); v_event jsonb; v_index integer := 0;
begin
  select * into v_game from public.games where invite_code = p_invite_code for update;
  if not found or v_game.status <> 'WAITING' then raise exception 'INVITE_UNAVAILABLE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.game_players where game_players.game_id = v_game.id and user_id = p_user_id) then
    raise exception 'INVITE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if coalesce((p_next_state->>'gameId'), '') <> v_game.id::text or coalesce((p_next_state->>'version')::integer, -1) <> 1 then
    raise exception 'INVALID_CANDIDATE_STATE' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_events) <> 'array' or exists (select 1 from jsonb_array_elements(p_events) e where coalesce((e->>'stateVersion')::integer, -1) <> 1) then
    raise exception 'INVALID_EVENTS' using errcode = 'P0001';
  end if;
  insert into public.game_players(game_id, user_id, seat, display_name) values (v_game.id, p_user_id, 1, p_display_name);
  update public.game_state as checkpoint
    set version = 1, canonical_state = p_next_state, updated_at = now()
    where checkpoint.game_id = v_game.id and checkpoint.version = 0;
  if not found then raise exception 'STALE_JOIN' using errcode = 'P0001'; end if;
  update public.games set status = 'PLAYING', started_at = now(), last_activity_at = now() where id = v_game.id;
  insert into public.game_actions(action_id, game_id, actor_id, expected_version, action_type, accepted_version)
    values(v_action_id, v_game.id, p_user_id, 0, 'START_GAME', 1);
  for v_event in select value from jsonb_array_elements(p_events) loop
    insert into public.game_events(game_id, state_version, action_id, event_index, event_type, visibility, recipient_user_id, payload)
      values (v_game.id, 1, v_action_id, v_index, v_event->>'type', coalesce(v_event->'visibility'->>'kind', 'SERVER_ONLY'),
      case when v_event->'visibility'->>'kind' = 'PLAYER' then (v_event->'visibility'->>'playerId')::uuid else null end, v_event);
    v_index := v_index + 1;
  end loop;
  return query select v_game.id, 1;
end;
$$;

revoke all on function public.create_waiting_game(citext, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.join_game_and_start(citext, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_waiting_game(citext, uuid, text, jsonb) to service_role;
grant execute on function public.join_game_and_start(citext, uuid, text, jsonb, jsonb) to service_role;
