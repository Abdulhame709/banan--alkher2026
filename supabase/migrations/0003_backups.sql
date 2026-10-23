-- ---------------------------------------------------------------------------
-- Admin backups
--
-- Each backup is a JSON snapshot of the fund tables stored in a private
-- Supabase Storage bucket. Metadata lives in fund_backups so the admin can
-- list and re-download the last copies.
-- ---------------------------------------------------------------------------

create table if not exists public.fund_backups (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  storage_path text not null,
  size_bytes   bigint not null default 0,
  counts       jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- 0001 created a lighter version of this table; add the metadata column in
-- place so existing projects upgrade cleanly.
alter table public.fund_backups
  add column if not exists counts jsonb not null default '{}'::jsonb;

create index if not exists idx_fund_backups_created on public.fund_backups (created_at desc);

alter table public.fund_backups enable row level security;

drop policy if exists fund_backups_admin_select on public.fund_backups;
create policy fund_backups_admin_select
  on public.fund_backups for select to authenticated
  using (public.fund_is_admin());

-- Private bucket: only the Edge Function (service role) writes/reads objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fund-backups', 'fund-backups', false, 52428800, array['application/json'])
on conflict (id) do nothing;

-- Notify connected admins when a backup is created/deleted.
drop trigger if exists trg_emit_fund_backups on public.fund_backups;
create trigger trg_emit_fund_backups
  after insert or update or delete on public.fund_backups
  for each row execute function public.fund_emit_event();
