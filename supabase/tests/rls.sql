begin;
select plan(19);

-- Seed as postgres; individual assertions switch to authenticated and set auth.uid().
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.test', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.games(id, invite_code, invite_token_digest, status, rules, created_by)
values ('20000000-0000-4000-8000-000000000001', 'RLS00001', repeat('b', 64), 'WAITING', '{"knockThreshold":10,"ginBonus":25,"undercutBonus":25,"matchTarget":100}', '10000000-0000-4000-8000-000000000001');
insert into public.game_players(game_id, user_id, seat, display_name) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 0, 'A'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 1, 'B');
insert into public.game_state(game_id, version, canonical_state) values
  ('20000000-0000-4000-8000-000000000001', 0, '{"version":0,"stock":[{"id":"A:CLUBS"}],"players":[]}');
insert into public.game_actions(action_id, game_id, actor_id, expected_version, action_type, accepted_version)
values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 0, 'TEST', 0);
insert into public.game_events(game_id, state_version, action_id, event_index, event_type, visibility, payload)
values ('20000000-0000-4000-8000-000000000001', 0, '30000000-0000-4000-8000-000000000001', 0, 'PRIVATE_STOCK_CARD_RECEIVED', 'SERVER_ONLY', '{"card":{"id":"A:CLUBS"}}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.games), 1::bigint, 'a member can read game metadata');
select throws_ok('select invite_code from public.games', '42501', 'permission denied for table games', 'members cannot read legacy invite codes');
select throws_ok('select invite_token_digest from public.games', '42501', 'permission denied for table games', 'members cannot read invite token digests');
select is((select count(*) from public.game_players), 1::bigint, 'a member can read only their own seat');
select is((select count(*) from public.profiles), 1::bigint, 'a user can read only their profile');
select throws_ok('select * from public.game_state', '42501', 'permission denied for table game_state', 'canonical checkpoint is denied');
select throws_ok('select * from public.game_events', '42501', 'permission denied for table game_events', 'event audit stream is denied');
select throws_ok('select * from public.game_actions', '42501', 'permission denied for table game_actions', 'idempotency receipts are denied');
select throws_ok($$insert into public.game_players(game_id, user_id, seat, display_name) values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 1, 'C')$$, '42501', 'permission denied for table game_players', 'browser writes are denied');
select throws_ok($$update public.profiles set display_name = 'Forged' where id = '10000000-0000-4000-8000-000000000001'$$, '42501', 'permission denied for table profiles', 'authenticated users cannot directly change profiles');
select throws_ok($$update public.games set status = 'COMPLETE' where id = '20000000-0000-4000-8000-000000000001'$$, '42501', 'permission denied for table games', 'authenticated users cannot alter scores or lifecycle metadata');
select throws_ok($$update public.game_state set canonical_state = '{"version":0,"stock":[]}' where game_id = '20000000-0000-4000-8000-000000000001'$$, '42501', 'permission denied for table game_state', 'authenticated users cannot overwrite canonical state');
select throws_ok($$select public.commit_game_action('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0,'TEST','{"version":1}'::jsonb,'PLAYING','[]'::jsonb,null,null)$$, '42501', 'permission denied for function commit_game_action', 'commit RPC is denied to authenticated users');

select is((
  select count(*) from unnest(array[
    'public.commit_game_action(uuid,uuid,uuid,integer,text,jsonb,public.game_status,jsonb,jsonb,text)',
    'public.create_waiting_game(citext,uuid,text,jsonb)',
    'public.create_waiting_game(citext,text,uuid,text,jsonb)',
    'public.join_game_and_start(citext,uuid,text,jsonb,jsonb)',
    'public.join_game_and_start_with_invite_token(text,uuid,text,jsonb,jsonb)',
    'public.request_rematch(uuid,uuid)',
    'public.accept_rematch(uuid,uuid,uuid,citext,jsonb,jsonb)',
    'public.set_updated_at()',
    'public.handle_new_user()',
    'public.reject_game_rule_changes()'
  ]) signature
  where has_function_privilege('authenticated', signature, 'EXECUTE')
), 0::bigint, 'authenticated users cannot execute any internal database function');

select is((
  select count(*) from unnest(array[
    'public.commit_game_action(uuid,uuid,uuid,integer,text,jsonb,public.game_status,jsonb,jsonb,text)',
    'public.create_waiting_game(citext,uuid,text,jsonb)',
    'public.create_waiting_game(citext,text,uuid,text,jsonb)',
    'public.join_game_and_start(citext,uuid,text,jsonb,jsonb)',
    'public.join_game_and_start_with_invite_token(text,uuid,text,jsonb,jsonb)',
    'public.request_rematch(uuid,uuid)',
    'public.accept_rematch(uuid,uuid,uuid,citext,jsonb,jsonb)'
  ]) signature
  where has_function_privilege('anon', signature, 'EXECUTE')
), 0::bigint, 'anonymous clients cannot execute any server RPC');

select is((
  select count(*) from pg_class
  where oid in (
    'public.profiles'::regclass, 'public.games'::regclass, 'public.game_players'::regclass,
    'public.game_state'::regclass, 'public.game_actions'::regclass,
    'public.game_events'::regclass, 'public.game_results'::regclass
  ) and relrowsecurity
), 7::bigint, 'RLS remains enabled on every application table');

select is((
  select count(*) from pg_policies
  where schemaname = 'realtime' and tablename = 'messages'
    and policyname = 'game members can receive private game channels'
    and cmd = 'SELECT' and roles = array['authenticated']::name[]
    and qual like '%realtime.topic()%'
    and qual like '%gp.game_id%'
    and qual like '%gp.user_id = auth.uid()%'
    and qual not like '%split_part%'
), 1::bigint, 'realtime receive policy requires an exact member-owned game topic');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.games), 0::bigint, 'non-member cannot read game metadata');
select is((select count(*) from public.game_results), 0::bigint, 'non-member cannot read results');

select * from finish();
rollback;
