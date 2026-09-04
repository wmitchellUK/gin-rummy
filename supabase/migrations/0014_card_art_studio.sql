create table public.card_art_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 80
  ),
  draft_manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(draft_manifest) = 'object'),
  draft_version integer not null default 0 check (draft_version >= 0),
  published_manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(published_manifest) = 'object'),
  published_revision integer not null default 0 check (published_revision >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.card_art_settings (
  singleton boolean primary key default true check (singleton),
  active_set_id uuid references public.card_art_sets(id) on delete restrict,
  active_revision integer not null default 0 check (active_revision >= 0),
  updated_at timestamptz not null default now(),
  check (
    (active_set_id is null and active_revision = 0)
    or (active_set_id is not null and active_revision > 0)
  )
);

insert into public.card_art_settings(singleton, active_set_id, active_revision)
values (true, null, 0);

create trigger card_art_sets_set_updated_at
  before update on public.card_art_sets
  for each row execute function public.set_updated_at();

create trigger card_art_settings_set_updated_at
  before update on public.card_art_settings
  for each row execute function public.set_updated_at();

alter table public.card_art_sets enable row level security;
alter table public.card_art_settings enable row level security;

revoke all on public.card_art_sets, public.card_art_settings from public, anon, authenticated;
grant select, insert, update, delete on public.card_art_sets, public.card_art_settings to service_role;

-- Public delivery is intentional. Uploads and mutations use the service role in
-- server routes; browser roles receive no write policy for this bucket.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('card-art', 'card-art', true, 10485760, array['image/webp']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy card_art_assets_public_read
on storage.objects for select
to anon, authenticated
using (bucket_id = 'card-art');

create or replace function public.reject_active_card_art_set_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null
    and new.archived_at is distinct from old.archived_at
    and exists (
      select 1
      from public.card_art_settings settings
      where settings.singleton
        and settings.active_set_id = old.id
    ) then
    raise exception 'CARD_ART_SET_ACTIVE' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger card_art_sets_reject_active_archive
  before update of archived_at on public.card_art_sets
  for each row execute function public.reject_active_card_art_set_archive();

create or replace function public.reject_invalid_active_card_art_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active_set_id is not null and not exists (
    select 1
    from public.card_art_sets art_set
    where art_set.id = new.active_set_id
      and art_set.archived_at is null
      and art_set.published_revision = new.active_revision
  ) then
    raise exception 'CARD_ART_ACTIVE_SETTING_INVALID' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger card_art_settings_validate_active_set
  before insert or update of active_set_id, active_revision on public.card_art_settings
  for each row execute function public.reject_invalid_active_card_art_setting();

create or replace function public.publish_and_activate_card_art_set(
  p_set_id uuid,
  p_expected_draft_version integer,
  p_expected_published_revision integer
)
returns table(active_set_id uuid, active_revision integer, active_manifest jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_settings public.card_art_settings%rowtype;
  selected_set public.card_art_sets%rowtype;
  next_revision integer;
begin
  select *
  into locked_settings
  from public.card_art_settings settings
  where settings.singleton
  for update;

  if not found then
    raise exception 'CARD_ART_SETTINGS_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into selected_set
  from public.card_art_sets art_set
  where art_set.id = p_set_id
  for update;

  if not found then
    raise exception 'CARD_ART_SET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if selected_set.archived_at is not null then
    raise exception 'CARD_ART_SET_ARCHIVED' using errcode = 'P0001';
  end if;

  if p_expected_draft_version < 0
    or p_expected_published_revision < 0
    or selected_set.draft_version <> p_expected_draft_version
    or selected_set.published_revision <> p_expected_published_revision then
    raise exception 'CARD_ART_ACTIVATION_CONFLICT' using errcode = 'P0001';
  end if;

  next_revision := selected_set.published_revision + 1;

  update public.card_art_sets
  set published_manifest = selected_set.draft_manifest,
      published_revision = next_revision
  where id = selected_set.id;

  update public.card_art_settings
  set active_set_id = selected_set.id,
      active_revision = next_revision
  where singleton;

  return query
  select selected_set.id, next_revision, selected_set.draft_manifest;
end;
$$;

create or replace function public.reset_card_art_to_builtin()
returns table(active_set_id uuid, active_revision integer, active_manifest jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.card_art_settings settings
  where settings.singleton
  for update;

  if not found then
    raise exception 'CARD_ART_SETTINGS_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.card_art_settings
  set active_set_id = null,
      active_revision = 0
  where singleton;

  return query
  select null::uuid, 0, '{}'::jsonb;
end;
$$;

revoke all on function public.reject_active_card_art_set_archive() from public, anon, authenticated;
revoke all on function public.reject_invalid_active_card_art_setting() from public, anon, authenticated;
revoke all on function public.publish_and_activate_card_art_set(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.reset_card_art_to_builtin() from public, anon, authenticated;

grant execute on function public.publish_and_activate_card_art_set(uuid, integer, integer) to service_role;
grant execute on function public.reset_card_art_to_builtin() to service_role;

comment on column public.card_art_sets.draft_manifest is
  'Slot-to-object-path draft. Object paths are immutable and retained after draft replacement so published revisions remain valid.';
