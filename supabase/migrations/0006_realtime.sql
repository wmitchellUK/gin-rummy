-- Private Broadcast/Presence channel authorization. The server sends broadcasts
-- using service_role; there is intentionally no authenticated INSERT policy.
create policy "game members can receive private game channels"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.game_players gp
    where gp.game_id::text = split_part(realtime.topic(), ':', 2)
      and gp.user_id = auth.uid()
  )
);
