-- Rules are captured when the game is created.  Lifecycle commits may update
-- status/timestamps, but no later operation may silently change the rules of a
-- game already in progress.
create or replace function public.reject_game_rule_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rules is distinct from old.rules then
    raise exception 'GAME_RULES_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger games_rules_immutable
  before update of rules on public.games
  for each row execute function public.reject_game_rule_changes();

-- A private Realtime topic has one exact, member-scoped name.  Matching the
-- whole topic (rather than only its second colon-separated part) avoids
-- authorizing arbitrary topic suffixes.
drop policy if exists "game members can receive private game channels" on realtime.messages;
create policy "game members can receive private game channels"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.game_players gp
    where realtime.topic() = 'game:' || gp.game_id::text
      and gp.user_id = auth.uid()
  )
);

-- These helpers are trigger-only / server-only implementation details.  The
-- table/RPC grants are already restricted in earlier migrations; explicit
-- function revokes keep new database roles from reaching these entry points.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.reject_game_rule_changes() from public, anon, authenticated;
