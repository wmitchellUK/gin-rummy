begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'creator@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'joiner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

select lives_ok($$select public.create_waiting_game('JOIN0001', '50000000-0000-4000-8000-000000000001', 'Creator', '{"knockThreshold":10,"ginBonus":25,"undercutBonus":25,"matchTarget":100}'::jsonb)$$, 'creation is atomic');
select is((select count(*) from public.games where invite_code = 'JOIN0001'), 1::bigint, 'game was created');
select is((select count(*) from public.game_players gp join public.games g on g.id = gp.game_id where g.invite_code = 'JOIN0001'), 1::bigint, 'creator received seat zero');
select lives_ok($$with g as (select id from public.games where invite_code = 'JOIN0001') select public.join_game_and_start('JOIN0001', '50000000-0000-4000-8000-000000000002', 'Joiner', jsonb_build_object('gameId', (select id::text from g), 'version', 1), '[]'::jsonb)$$, 'join claims the open seat atomically');
select is((select count(*) from public.game_players gp join public.games g on g.id = gp.game_id where g.invite_code = 'JOIN0001'), 2::bigint, 'joiner received the only second seat');

-- The following verifies the commit lock/version contract. A test harness running
-- with service credentials supplies engine-validated state; pgtap does not run the engine.
insert into public.games(id, invite_code, status, rules, created_by)
values ('60000000-0000-4000-8000-000000000001', 'COMMIT01', 'PLAYING', '{}', '50000000-0000-4000-8000-000000000001');
insert into public.game_players(game_id, user_id, seat, display_name) values
 ('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0,'Creator'),
 ('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',1,'Joiner');
insert into public.game_state(game_id, version, canonical_state) values ('60000000-0000-4000-8000-000000000001', 0, '{"version":0}');
select is((select accepted_version from public.commit_game_action('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',0,'DRAW_STOCK','{"gameId":"60000000-0000-4000-8000-000000000001","version":1}'::jsonb,'PLAYING','[]'::jsonb,null)), 1, 'first same-version action commits');
select is((select outcome from public.commit_game_action('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',0,'DRAW_STOCK','{"gameId":"60000000-0000-4000-8000-000000000001","version":1}'::jsonb,'PLAYING','[]'::jsonb,null)), 'STALE', 'second same-version action is stale');
select is((select version from public.game_state where game_id = '60000000-0000-4000-8000-000000000001'), 1, 'only one action changed the checkpoint');

select * from finish();
rollback;
