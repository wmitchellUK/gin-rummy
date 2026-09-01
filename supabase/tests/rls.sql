begin;
select plan(10);

-- Seed as postgres; individual assertions switch to authenticated and set auth.uid().
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.games(id, invite_code, status, rules, created_by)
values ('20000000-0000-4000-8000-000000000001', 'RLS00001', 'WAITING', '{"knockThreshold":10,"ginBonus":25,"undercutBonus":25,"matchTarget":100}', '10000000-0000-4000-8000-000000000001');
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
select is((select count(*) from public.game_players), 1::bigint, 'a member can read only their own seat');
select is((select count(*) from public.profiles), 1::bigint, 'a user can read only their profile');
select throws_ok('select * from public.game_state', '42501', 'permission denied for table game_state', 'canonical checkpoint is denied');
select throws_ok('select * from public.game_events', '42501', 'permission denied for table game_events', 'event audit stream is denied');
select throws_ok('select * from public.game_actions', '42501', 'permission denied for table game_actions', 'idempotency receipts are denied');
select throws_ok($$insert into public.game_players(game_id, user_id, seat, display_name) values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 1, 'C')$$, '42501', 'permission denied for table game_players', 'browser writes are denied');
select throws_ok($$select public.commit_game_action('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0,'TEST','{"version":1}'::jsonb,'PLAYING','[]'::jsonb,null)$$, '42501', 'permission denied for function commit_game_action', 'commit RPC is denied to authenticated users');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.games), 0::bigint, 'non-member cannot read game metadata');
select is((select count(*) from public.game_results), 0::bigint, 'non-member cannot read results');

select * from finish();
rollback;
