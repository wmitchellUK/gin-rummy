create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.game_status as enum ('WAITING', 'PLAYING', 'HAND_COMPLETE', 'COMPLETE');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
