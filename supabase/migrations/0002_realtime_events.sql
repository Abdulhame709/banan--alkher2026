-- ---------------------------------------------------------------------------
-- Realtime change feed
--
-- The React app subscribes to INSERTs on fund_events and refreshes the current
-- page. Only tiny metadata is exposed (table, action, row id) so financial
-- tables never need to be published to Realtime/PostgREST directly.
-- ---------------------------------------------------------------------------

create table if not exists public.fund_events (
  id          bigint generated always as identity primary key,
  entity      text not null,
  action      text not null,
  entity_id   text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_fund_events_created on public.fund_events (created_at desc);

alter table public.fund_events enable row level security;

drop policy if exists fund_events_read_authenticated on public.fund_events;
create policy fund_events_read_authenticated
  on public.fund_events for select to authenticated
  using (true);

create or replace function public.fund_emit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_id text;
begin
  if TG_TABLE_NAME = 'fund_user_profiles' then
    v_entity_id := coalesce(new.user_id, old.user_id)::text;
  else
    v_entity_id := coalesce(new.id, old.id)::text;
  end if;

  insert into public.fund_events (entity, action, entity_id)
  values (TG_TABLE_NAME, lower(TG_OP), v_entity_id);

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'fund_members',
    'fund_subscriptions',
    'fund_receipts',
    'fund_expense_requests',
    'fund_expense_approvals',
    'fund_settings',
    'fund_user_profiles'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_emit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.fund_emit_event()',
      'trg_emit_' || t,
      t
    );
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'fund_events'
     ) then
    alter publication supabase_realtime add table public.fund_events;
  end if;
end $$;
