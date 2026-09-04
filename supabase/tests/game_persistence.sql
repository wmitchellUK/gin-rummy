begin;
select plan(24);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'creator@example.test', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'joiner@example.test', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());

select lives_ok($$select public.create_waiting_game('JOIN0001', repeat('a', 64), '50000000-0000-4000-8000-000000000001', 'Creator', '{"knockThreshold":10,"ginBonus":25,"undercutBonus":25,"matchTarget":100}'::jsonb)$$, 'creation with an invite digest is atomic');
select is((select count(*) from public.games where invite_code = 'JOIN0001'), 1::bigint, 'game was created');
select is((select invite_token_digest from public.games where invite_code = 'JOIN0001'), repeat('a', 64), 'only the invite digest is stored');
select is((select count(*) from public.game_players gp join public.games g on g.id = gp.game_id where g.invite_code = 'JOIN0001'), 1::bigint, 'creator received seat zero');
select lives_ok($$with g as (select id from public.games where invite_code = 'JOIN0001') select public.join_game_and_start_with_invite_token(repeat('a', 64), '50000000-0000-4000-8000-000000000002', 'Joiner', jsonb_build_object('gameId', (select id::text from g), 'version', 1), '[]'::jsonb)$$, 'digest-backed join claims the open seat atomically');
select is((select count(*) from public.game_players gp join public.games g on g.id = gp.game_id where g.invite_code = 'JOIN0001'), 2::bigint, 'joiner received the only second seat');

-- The following verifies the commit lock/version contract. A test harness running
-- with service credentials supplies engine-validated state; pgtap does not run the engine.
insert into public.games(id, invite_code, status, rules, created_by)
values ('60000000-0000-4000-8000-000000000001', 'COMMIT01', 'PLAYING', '{}', '50000000-0000-4000-8000-000000000001');
insert into public.game_players(game_id, user_id, seat, display_name) values
 ('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0,'Creator'),
 ('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',1,'Joiner');
insert into public.game_state(game_id, version, canonical_state) values ('60000000-0000-4000-8000-000000000001', 0, '{"version":0}');
select is((select accepted_version from public.commit_game_action('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0,'DRAW_STOCK','{"gameId":"60000000-0000-4000-8000-000000000001","version":1}'::jsonb,'PLAYING','[{"type":"INITIAL_UPCARD_PASSED","stateVersion":1,"playerId":"50000000-0000-4000-8000-000000000001","visibility":{"kind":"PUBLIC"}}]'::jsonb,null)), 1, 'first same-version action commits');
select is((select outcome from public.commit_game_action('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0,'DRAW_STOCK','{"gameId":"60000000-0000-4000-8000-000000000001","version":1}'::jsonb,'PLAYING','[{"type":"INITIAL_UPCARD_PASSED","stateVersion":1,"playerId":"50000000-0000-4000-8000-000000000001","visibility":{"kind":"PUBLIC"}}]'::jsonb,null)), 'IDEMPOTENT', 'an exact action retry is idempotent');
select throws_ok($$select public.commit_game_action('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0,'DRAW_DISCARD','{"gameId":"60000000-0000-4000-8000-000000000001","version":1}'::jsonb,'PLAYING','[]'::jsonb,null)$$, 'P0001', 'ACTION_ID_CONFLICT', 'an action id cannot be replayed with another action type');
select is((select outcome from public.commit_game_action('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',0,'DRAW_STOCK','{"gameId":"60000000-0000-4000-8000-000000000001","version":1}'::jsonb,'PLAYING','[]'::jsonb,null)), 'STALE', 'second same-version action is stale');
select is((select version from public.game_state where game_id = '60000000-0000-4000-8000-000000000001'), 1, 'only one action changed the checkpoint');

select is((select accepted_version from public.commit_game_action('70000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,'DISCARD','{"gameId":"60000000-0000-4000-8000-000000000001","version":2}'::jsonb,'PLAYING','[]'::jsonb,null,'A:CLUBS')), 2, 'a card action stores its complete receipt');
select throws_ok($$select public.commit_game_action('70000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,'DISCARD','{"gameId":"60000000-0000-4000-8000-000000000001","version":2}'::jsonb,'PLAYING','[]'::jsonb,null,'K:SPADES')$$, 'P0001', 'ACTION_ID_CONFLICT', 'an action id cannot be replayed with another card');
select is((select accepted_version from public.commit_game_action('70000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',2,'DISCARD','{"gameId":"60000000-0000-4000-8000-000000000001","version":3}'::jsonb,'PLAYING','[]'::jsonb,null)), 3, 'legacy card actions remain available during application rollout');

-- Repeated/concurrent rematch acceptance used to create an unlimited number of
-- canonical games from one request. The source row lock and unique index make
-- acceptance idempotent even though each HTTP request proposes a fresh UUID.
insert into public.games(id, invite_code, status, rules, created_by, rematch_requested_by)
values ('80000000-0000-4000-8000-000000000001', 'REMATCH1', 'COMPLETE', '{}', '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001');
insert into public.game_players(game_id, user_id, seat, display_name) values
 ('80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0,'Creator'),
 ('80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',1,'Joiner');
insert into public.game_state(game_id, version, canonical_state)
values ('80000000-0000-4000-8000-000000000001', 7, '{"version":7}');

select is((select game_id from public.accept_rematch(
  '80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000002','REMATCH2',
  '{"gameId":"80000000-0000-4000-8000-000000000002","version":1}'::jsonb,'[]'::jsonb
)), '80000000-0000-4000-8000-000000000002'::uuid, 'the first rematch acceptance creates a game');
select is((select game_id from public.accept_rematch(
  '80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000003','REMATCH3',
  '{"gameId":"80000000-0000-4000-8000-000000000003","version":1}'::jsonb,'[]'::jsonb
)), '80000000-0000-4000-8000-000000000002'::uuid, 'a repeated acceptance returns the existing rematch');
select is((select count(*) from public.games where source_game_id = '80000000-0000-4000-8000-000000000001'), 1::bigint, 'only one rematch exists per source game');
select is((select count(*) from public.games where id = '80000000-0000-4000-8000-000000000003'), 0::bigint, 'the repeated acceptance does not create its proposed game');

select lives_ok($$select public.create_bot_game(
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000001',
  'Creator',
  '{"knockThreshold":10,"ginBonus":25,"undercutBonus":25,"matchTarget":100}'::jsonb,
  '{"gameId":"90000000-0000-4000-8000-000000000001","version":1,"phase":"OPENING_NON_DEALER","players":[{"id":"50000000-0000-4000-8000-000000000001"},{"id":"90000000-0000-4000-8000-000000000002"}]}'::jsonb,
  '[]'::jsonb,
  null
)$$, 'single-player creation is atomic without a bot Auth user');
select is((select game_mode from public.games where id = '90000000-0000-4000-8000-000000000001'), 'SINGLE_PLAYER', 'single-player mode is recorded');
select is((select count(*) from public.game_players where game_id = '90000000-0000-4000-8000-000000000001'), 2::bigint, 'single-player game has two participants');
select is((select count(*) from public.game_players where game_id = '90000000-0000-4000-8000-000000000001' and player_kind = 'BOT' and user_id is null and display_name = 'Naia'), 1::bigint, 'Naia is a non-auth bot participant');
select is((select count(*) from auth.users where id = '90000000-0000-4000-8000-000000000002'), 0::bigint, 'creating Naia does not create an Auth account');
select is((select count(*) from public.game_actions where game_id = '90000000-0000-4000-8000-000000000001' and actor_id = '50000000-0000-4000-8000-000000000001'), 1::bigint, 'the trusted start receipt belongs to the human participant');

select * from finish();
rollback;
