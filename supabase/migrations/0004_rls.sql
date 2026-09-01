alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_state enable row level security;
alter table public.game_actions enable row level security;
alter table public.game_events enable row level security;
alter table public.game_results enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
create policy games_read_member on public.games for select to authenticated using (
  exists (select 1 from public.game_players gp where gp.game_id = games.id and gp.user_id = auth.uid())
);
create policy game_players_read_own on public.game_players for select to authenticated using (user_id = auth.uid());
create policy game_results_read_member on public.game_results for select to authenticated using (
  exists (select 1 from public.game_players gp where gp.game_id = game_results.game_id and gp.user_id = auth.uid())
);

grant select on public.profiles, public.games, public.game_players, public.game_results to authenticated;
