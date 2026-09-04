begin;
select plan(34);

select is(
  (select count(*) from public.card_art_settings),
  1::bigint,
  'the built-in singleton setting is seeded'
);
select ok(
  (select active_set_id is null and active_revision = 0 from public.card_art_settings where singleton),
  'the seeded setting selects built-in artwork'
);
select is(
  (select count(*) from pg_class where oid in ('public.card_art_sets'::regclass, 'public.card_art_settings'::regclass) and relrowsecurity),
  2::bigint,
  'RLS is enabled on both card-art tables'
);

select ok(not has_table_privilege('anon', 'public.card_art_sets', 'SELECT'), 'anonymous clients cannot read sets directly');
select ok(not has_table_privilege('anon', 'public.card_art_sets', 'INSERT'), 'anonymous clients cannot create sets directly');
select ok(not has_table_privilege('authenticated', 'public.card_art_sets', 'UPDATE'), 'authenticated clients cannot update sets directly');
select ok(not has_table_privilege('authenticated', 'public.card_art_settings', 'UPDATE'), 'authenticated clients cannot switch the active set directly');
select ok(has_table_privilege('service_role', 'public.card_art_sets', 'SELECT,INSERT,UPDATE,DELETE'), 'the service role can manage card-art sets');
select ok(has_table_privilege('service_role', 'public.card_art_settings', 'SELECT,INSERT,UPDATE,DELETE'), 'the service role can manage the singleton setting');

select ok(
  (select public from storage.buckets where id = 'card-art'),
  'the card-art asset bucket is public'
);

insert into storage.objects(bucket_id, name)
values ('card-art', 'sets/00000000-0000-4000-8000-000000000001/J-CLUBS/00000000-0000-4000-8000-000000000002.webp');

set local role anon;
select is(
  (select count(*) from storage.objects
   where bucket_id = 'card-art'
     and name = 'sets/00000000-0000-4000-8000-000000000001/J-CLUBS/00000000-0000-4000-8000-000000000002.webp'),
  1::bigint,
  'anonymous clients can read public card-art assets'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name) values ('card-art', 'browser-write.webp')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'anonymous clients cannot upload card-art assets'
);
reset role;

set local role authenticated;
select is(
  (select count(*) from storage.objects
   where bucket_id = 'card-art'
     and name = 'sets/00000000-0000-4000-8000-000000000001/J-CLUBS/00000000-0000-4000-8000-000000000002.webp'),
  1::bigint,
  'authenticated clients can read public card-art assets'
);
select is_empty(
  $$update storage.objects set metadata = '{"browser":"write"}'::jsonb where bucket_id = 'card-art' returning name$$,
  'authenticated clients cannot update card-art assets'
);
select throws_ok(
  $$delete from storage.objects where bucket_id = 'card-art'$$,
  '42501',
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'authenticated clients cannot delete card-art assets'
);
select ok(
  not has_function_privilege('authenticated', 'public.publish_and_activate_card_art_set(uuid,integer,integer)', 'EXECUTE'),
  'authenticated clients cannot publish and activate sets'
);
select ok(
  not has_function_privilege('authenticated', 'public.reset_card_art_to_builtin()', 'EXECUTE'),
  'authenticated clients cannot reset the active artwork'
);
reset role;

select throws_ok(
  $$insert into public.card_art_sets(name) values ('  Padded  ')$$,
  '23514',
  null,
  'set names must already be trimmed'
);
select throws_ok(
  $$insert into public.card_art_sets(name, draft_manifest) values ('Invalid manifest', '[]'::jsonb)$$,
  '23514',
  null,
  'draft manifests must be JSON objects'
);
select throws_ok(
  $$insert into public.card_art_sets(name, published_revision) values ('Invalid revision', -1)$$,
  '23514',
  null,
  'published revisions cannot be negative'
);

insert into public.card_art_sets(id, name, draft_manifest, draft_version)
values (
  '10000000-0000-4000-8000-000000000001',
  'Family portraits',
  '{"J:CLUBS":"sets/10000000-0000-4000-8000-000000000001/J-CLUBS/20000000-0000-4000-8000-000000000001.webp"}'::jsonb,
  1
);

select throws_ok(
  $$select * from public.publish_and_activate_card_art_set('10000000-0000-4000-8000-000000000001', 0, 0)$$,
  'P0001',
  'CARD_ART_ACTIVATION_CONFLICT',
  'activation rejects a stale draft version'
);

set local role service_role;
select is(
  (select active_revision from public.publish_and_activate_card_art_set('10000000-0000-4000-8000-000000000001', 1, 0)),
  1,
  'the first publication increments the revision'
);
reset role;

select is(
  (select published_manifest from public.card_art_sets where id = '10000000-0000-4000-8000-000000000001'),
  '{"J:CLUBS":"sets/10000000-0000-4000-8000-000000000001/J-CLUBS/20000000-0000-4000-8000-000000000001.webp"}'::jsonb,
  'activation snapshots the draft manifest'
);
select ok(
  (select active_set_id = '10000000-0000-4000-8000-000000000001' and active_revision = 1 from public.card_art_settings where singleton),
  'activation switches the global setting atomically'
);

update public.card_art_sets
set draft_manifest = '{"Q:HEARTS":"sets/10000000-0000-4000-8000-000000000001/Q-HEARTS/20000000-0000-4000-8000-000000000002.webp"}'::jsonb,
    draft_version = 2
where id = '10000000-0000-4000-8000-000000000001';

select is(
  (select published_manifest from public.card_art_sets where id = '10000000-0000-4000-8000-000000000001'),
  '{"J:CLUBS":"sets/10000000-0000-4000-8000-000000000001/J-CLUBS/20000000-0000-4000-8000-000000000001.webp"}'::jsonb,
  'changing a draft leaves its published snapshot intact'
);
select is(
  (select count(*) from storage.objects
   where bucket_id = 'card-art'
     and name = 'sets/00000000-0000-4000-8000-000000000001/J-CLUBS/00000000-0000-4000-8000-000000000002.webp'),
  1::bigint,
  'previously referenced immutable assets are retained when a draft changes'
);

select throws_ok(
  $$select * from public.publish_and_activate_card_art_set('10000000-0000-4000-8000-000000000001', 2, 0)$$,
  'P0001',
  'CARD_ART_ACTIVATION_CONFLICT',
  'activation rejects a stale published revision'
);

set local role service_role;
select is(
  (select active_revision from public.publish_and_activate_card_art_set('10000000-0000-4000-8000-000000000001', 2, 1)),
  2,
  'a later publication increments the revision again'
);
reset role;

select throws_ok(
  $$update public.card_art_sets set archived_at = now() where id = '10000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'CARD_ART_SET_ACTIVE',
  'the active set cannot be archived'
);

set local role service_role;
select is(
  (select active_revision from public.reset_card_art_to_builtin()),
  0,
  'the service role can restore built-in artwork'
);
reset role;

select ok(
  (select active_set_id is null and active_revision = 0 from public.card_art_settings where singleton),
  'built-in reset clears the active set and revision'
);
select lives_ok(
  $$update public.card_art_sets set archived_at = now() where id = '10000000-0000-4000-8000-000000000001'$$,
  'an inactive set can be archived'
);
select ok(
  not has_function_privilege('anon', 'public.publish_and_activate_card_art_set(uuid,integer,integer)', 'EXECUTE'),
  'anonymous clients cannot publish and activate sets'
);
select ok(
  not has_function_privilege('anon', 'public.reset_card_art_to_builtin()', 'EXECUTE'),
  'anonymous clients cannot reset the active artwork'
);

select * from finish();
rollback;
