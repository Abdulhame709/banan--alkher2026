-- ---------------------------------------------------------------------------
-- 0007_keepalive.sql
--
-- A tiny, safe endpoint that external uptime monitors can call to keep the
-- free Supabase project from being paused after seven days without activity.
-- The Edge Function /health?db=1 already touches PostgreSQL, but this RPC is
-- useful for monitors that can only call the Supabase REST API.
-- ---------------------------------------------------------------------------

create table if not exists public.fund_keepalive (
  id         smallint primary key default 1 check (id = 1),
  pinged_at  timestamptz not null default now(),
  note       text
);

insert into public.fund_keepalive (id, note)
values (1, 'keep-alive heartbeat')
on conflict (id) do nothing;

alter table public.fund_keepalive enable row level security;
revoke all on public.fund_keepalive from anon, authenticated;

create or replace function public.ping_keepalive()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fund_keepalive
     set pinged_at = now()
   where id = 1;
  return (select pinged_at from public.fund_keepalive where id = 1);
end;
$$;

revoke all on function public.ping_keepalive() from public;
grant execute on function public.ping_keepalive() to anon, authenticated;

comment on table public.fund_keepalive is
  'Heartbeat table used by external uptime monitors to keep the free Supabase project active.';
