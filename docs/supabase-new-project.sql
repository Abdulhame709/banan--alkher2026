-- ============================================================================
-- صندوق بنان الخير للبنيان
-- ملف إعداد قاعدة بيانات Supabase الجديدة
-- نفّذ هذا الملف مرة واحدة فقط في SQL Editor داخل المشروع الجديد.
-- ============================================================================


-- ===== 0001_init.sql =====
-- ---------------------------------------------------------------------------
-- 0001_init.sql — Supabase/PostgreSQL schema for the Banan Charity Fund.
--
-- Apply with the Supabase SQL editor or:
--   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
--
-- Auth model: Supabase Auth (auth.users). Profiles are created automatically
-- by a trigger; the first registered user becomes the administrator.
-- The API (Edge Function) uses the service role and enforces capabilities.
-- RLS is enabled as defence in depth and for client-side Realtime access to
-- each user's own notifications.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Fund settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.fund_settings (
  id                       text primary key,
  fund_name                text not null default 'صندوق بنان الخير للبنيان – الغدير – مقبنة – تعز',
  logo_url                 text,
  default_monthly_fee      numeric(14,2) not null default 1000 check (default_monthly_fee >= 0),
  currency                 text not null default 'ريال يمني',
  opening_balance          numeric(14,2) not null default 0,
  allow_self_approval_demo boolean not null default false,
  allow_signups            boolean not null default true,
  updated_at               timestamptz not null default now()
);
insert into public.fund_settings (id) values ('fund') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Members
-- ---------------------------------------------------------------------------
create table if not exists public.fund_members (
  id          uuid primary key default gen_random_uuid(),
  member_no   text not null unique,
  full_name   text not null,
  phone       text,
  address     text default 'الغدير - مقبنة - تعز',
  monthly_fee numeric(14,2) not null default 1000 check (monthly_fee >= 0),
  joined_on   date not null default current_date,
  active      boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_members_active on public.fund_members (active);
create index if not exists idx_members_name on public.fund_members (full_name);

-- ---------------------------------------------------------------------------
-- 3) User profiles (linked to Supabase Auth)
-- ---------------------------------------------------------------------------
create table if not exists public.fund_user_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null,
  email            text,
  phone            text,
  role             text not null default 'member'
                   check (role in ('admin','accountant','treasurer','board_member','member')),
  linked_member_id uuid references public.fund_members(id) on delete set null,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists idx_profiles_role on public.fund_user_profiles (role);
create index if not exists idx_profiles_member on public.fund_user_profiles (linked_member_id);

-- ---------------------------------------------------------------------------
-- 4) Monthly accruals / dues
-- ---------------------------------------------------------------------------
create table if not exists public.fund_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.fund_members(id) on delete cascade,
  due_month   date not null check (date_part('day', due_month) = 1),
  amount      numeric(14,2) not null default 1000 check (amount > 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status      text not null default 'unpaid' check (status in ('unpaid','partial','paid')),
  created_at  timestamptz not null default now(),
  unique (member_id, due_month),
  check (paid_amount <= amount)
);
create index if not exists idx_subscriptions_member on public.fund_subscriptions (member_id);
create index if not exists idx_subscriptions_month on public.fund_subscriptions (due_month);
create index if not exists idx_subscriptions_status on public.fund_subscriptions (status);

-- ---------------------------------------------------------------------------
-- 5) Receipts
-- ---------------------------------------------------------------------------
create table if not exists public.fund_receipts (
  id                 uuid primary key default gen_random_uuid(),
  receipt_no         integer not null unique,
  receipt_type       text not null check (receipt_type in ('subscription','donation','other')),
  member_id          uuid references public.fund_members(id) on delete set null,
  subscription_id    uuid references public.fund_subscriptions(id) on delete set null,
  donor_name         text,
  amount             numeric(14,2) not null check (amount > 0),
  payment_method     text not null default 'cash' check (payment_method in ('cash','bank_transfer')),
  is_restricted      boolean not null default false,
  restricted_purpose text,
  receipt_date       date not null default current_date,
  attachment_url     text,
  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_receipts_date on public.fund_receipts (receipt_date);
create index if not exists idx_receipts_member on public.fund_receipts (member_id);
create index if not exists idx_receipts_type on public.fund_receipts (receipt_type);
create index if not exists idx_receipts_subscription on public.fund_receipts (subscription_id);

-- ---------------------------------------------------------------------------
-- 6) Expense requests
-- ---------------------------------------------------------------------------
create table if not exists public.fund_expense_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_no          integer not null unique,
  category            text not null check (category in ('social_aid','charitable_aid','medical_aid','emergency_aid','operational')),
  beneficiary_name    text not null,
  beneficiary_phone   text,
  description         text not null,
  amount              numeric(14,2) not null check (amount > 0),
  requested_date      date not null default current_date,
  status              text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  approval_count      smallint not null default 0 check (approval_count between 0 and 2),
  payment_voucher_no  text unique,
  attachment_url      text,
  notes               text,
  created_by          uuid references auth.users(id) on delete set null,
  disbursed_by        uuid references auth.users(id) on delete set null,
  disbursed_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_expenses_status on public.fund_expense_requests (status);
create index if not exists idx_expenses_date on public.fund_expense_requests (requested_date);
create index if not exists idx_expenses_created on public.fund_expense_requests (created_at);

-- ---------------------------------------------------------------------------
-- 7) Dual approvals
-- ---------------------------------------------------------------------------
create table if not exists public.fund_expense_approvals (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.fund_expense_requests(id) on delete cascade,
  approver_id   uuid not null,
  approver_name text not null,
  approver_role text not null,
  decision      text not null check (decision in ('approved','rejected')),
  notes         text,
  created_at    timestamptz not null default now(),
  unique (request_id, approver_id)
);
create index if not exists idx_approvals_request on public.fund_expense_approvals (request_id);

-- ---------------------------------------------------------------------------
-- 8) Immutable audit log
-- ---------------------------------------------------------------------------
create table if not exists public.fund_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  entity_type text not null,
  entity_id   text,
  actor_id    uuid,
  actor_name  text,
  details     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created on public.fund_audit_logs (created_at);
create index if not exists idx_audit_entity on public.fund_audit_logs (entity_type, entity_id);
create index if not exists idx_audit_actor on public.fund_audit_logs (actor_id);

create or replace function public.fund_audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'سجل التدقيق غير قابل للتعديل أو الحذف';
end;
$$;

drop trigger if exists trg_audit_no_change on public.fund_audit_logs;
create trigger trg_audit_no_change
before update or delete on public.fund_audit_logs
for each row execute function public.fund_audit_immutable();

-- ---------------------------------------------------------------------------
-- Voucher sequences
-- ---------------------------------------------------------------------------
create table if not exists public.sequences (
  name  text primary key,
  value bigint not null default 0 check (value >= 0)
);
insert into public.sequences (name, value) values
  ('receipt', 0),
  ('expense_request', 0),
  ('payment_voucher', 0)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Bootstrap profile on Supabase Auth signup. First user = admin.
-- ---------------------------------------------------------------------------
create or replace function public.fund_bootstrap_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  display_name text;
begin
  select not exists (select 1 from public.fund_user_profiles) into first_user;

  display_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    split_part(coalesce(new.email, ''), '@', 1)
  );

  insert into public.fund_user_profiles (user_id, full_name, email, phone, role, active)
  values (
    new.id,
    case when first_user then 'مدير صندوق بنان الخير للبنيان' else display_name end,
    new.email,
    new.raw_user_meta_data->>'phone',
    case when first_user then 'admin' else 'member' end,
    true
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_bootstrap_user_profile on auth.users;
create trigger trg_bootstrap_user_profile
after insert on auth.users
for each row execute function public.fund_bootstrap_profile();

-- ---------------------------------------------------------------------------
-- Notifications / push / devices / backups
-- ---------------------------------------------------------------------------
create table if not exists public.fund_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  entity_type text,
  entity_id   text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.fund_notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread on public.fund_notifications (user_id) where read_at is null;

create table if not exists public.fund_push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_user on public.fund_push_subscriptions (user_id);

create table if not exists public.fund_device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  platform   text not null default 'android',
  created_at timestamptz not null default now()
);
create index if not exists idx_device_tokens_user on public.fund_device_tokens (user_id);

create table if not exists public.fund_backups (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  size_bytes   bigint not null default 0,
  storage_path text not null,
  counts       jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_backups_created on public.fund_backups (created_at desc);

-- ---------------------------------------------------------------------------
-- Member financial view (accrual — never cash)
-- ---------------------------------------------------------------------------
create or replace view public.v_member_financials as
select
  m.id,
  m.member_no,
  m.full_name,
  m.phone,
  m.address,
  m.monthly_fee,
  m.joined_on,
  m.active,
  m.notes,
  m.created_at,
  coalesce(sum(s.amount), 0)                          as total_accrued,
  coalesce(sum(s.paid_amount), 0)                     as total_paid,
  coalesce(sum(s.amount - s.paid_amount), 0)          as arrears,
  sum(case when s.status <> 'paid' then 1 else 0 end) as open_months,
  count(s.id)                                         as due_months
from public.fund_members m
left join public.fund_subscriptions s on s.member_id = m.id
group by m.id;

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------
create or replace function public.fund_current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.fund_user_profiles
   where user_id = auth.uid() and active
   limit 1
$$;

create or replace function public.fund_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fund_current_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere (deny by default)
-- ---------------------------------------------------------------------------
alter table public.fund_settings           enable row level security;
alter table public.fund_members            enable row level security;
alter table public.fund_user_profiles      enable row level security;
alter table public.fund_subscriptions      enable row level security;
alter table public.fund_receipts           enable row level security;
alter table public.fund_expense_requests   enable row level security;
alter table public.fund_expense_approvals  enable row level security;
alter table public.fund_audit_logs         enable row level security;
alter table public.sequences               enable row level security;
alter table public.fund_notifications      enable row level security;
alter table public.fund_push_subscriptions enable row level security;
alter table public.fund_device_tokens      enable row level security;
alter table public.fund_backups            enable row level security;

-- Minimal client policies. The API uses the service role and is unaffected.

drop policy if exists profiles_select_self_or_admin on public.fund_user_profiles;
create policy profiles_select_self_or_admin
  on public.fund_user_profiles for select to authenticated
  using (user_id = auth.uid() or public.fund_is_admin());

drop policy if exists notifications_select_own on public.fund_notifications;
create policy notifications_select_own
  on public.fund_notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.fund_notifications;
create policy notifications_update_own
  on public.fund_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_subscriptions_own on public.fund_push_subscriptions;
create policy push_subscriptions_own
  on public.fund_push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists device_tokens_own on public.fund_device_tokens;
create policy device_tokens_own
  on public.fund_device_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime for the notification bell (INSERT events are enough)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'fund_notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.fund_notifications';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket for attachments and backups (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fund-files', 'fund-files', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Server role permissions (the Edge Function connects with service_role,
-- which bypasses RLS; these grants are for completeness).
-- ---------------------------------------------------------------------------
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ===== 0002_realtime_events.sql =====
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

-- ===== 0003_backups.sql =====
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

-- ===== 0004_production_governance.sql =====
-- ---------------------------------------------------------------------------
-- 0004_production_governance.sql
--
-- Production governance upgrade:
--   * Secretary General / Fund Manager roles
--   * Signup approval workflow (new accounts start pending + inactive)
--   * Per-user permission overrides (JSONB)
--   * Hijri month metadata on monthly dues
--   * Ordered two-stage expense approvals
--   * Automatic-dues switch
--   * API rate-limit storage and keep-alive cron (when available)
-- ---------------------------------------------------------------------------

-- 1) Roles -----------------------------------------------------------------
alter table public.fund_user_profiles
  drop constraint if exists fund_user_profiles_role_check;
alter table public.fund_user_profiles
  add constraint fund_user_profiles_role_check
  check (role in (
    'admin', 'fund_manager', 'secretary_general', 'accountant',
    'treasurer', 'board_member', 'member'
  ));

-- 2) Signup approval + granular permissions --------------------------------
alter table public.fund_user_profiles
  add column if not exists approval_status text not null default 'approved';
alter table public.fund_user_profiles
  add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.fund_user_profiles
  add column if not exists approved_at timestamptz;
alter table public.fund_user_profiles
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table public.fund_user_profiles
  drop constraint if exists fund_user_profiles_approval_status_check;
alter table public.fund_user_profiles
  add constraint fund_user_profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

update public.fund_user_profiles
   set approval_status = case when active then 'approved' else 'rejected' end
 where approval_status is null or approval_status = 'approved';

create index if not exists idx_profiles_approval on public.fund_user_profiles (approval_status);

-- Existing demo board member becomes the first Secretary General so the new
-- approval chain has an eligible first approver. Production admins can change
-- this from the Users screen at any time.
update public.fund_user_profiles p
   set role = 'secretary_general'
  from auth.users u
 where u.id = p.user_id
   and u.email = 'board@banan.org'
   and p.role = 'board_member';

-- 3) Hijri month metadata on dues ------------------------------------------
alter table public.fund_subscriptions
  add column if not exists hijri_year smallint;
alter table public.fund_subscriptions
  add column if not exists hijri_month smallint;
alter table public.fund_subscriptions
  drop constraint if exists fund_subscriptions_due_month_check;
alter table public.fund_subscriptions
  drop constraint if exists fund_subscriptions_hijri_month_check;
alter table public.fund_subscriptions
  add constraint fund_subscriptions_hijri_month_check
  check (hijri_month is null or hijri_month between 1 and 12);
create index if not exists idx_subscriptions_hijri
  on public.fund_subscriptions (hijri_year, hijri_month);

-- 4) Ordered approval stages ------------------------------------------------
alter table public.fund_expense_approvals
  add column if not exists stage smallint not null default 1;
alter table public.fund_expense_approvals
  drop constraint if exists fund_expense_approvals_stage_check;
alter table public.fund_expense_approvals
  add constraint fund_expense_approvals_stage_check
  check (stage between 1 and 2);

with numbered as (
  select id,
         row_number() over (partition by request_id order by created_at, id) as rn
    from public.fund_expense_approvals
)
update public.fund_expense_approvals a
   set stage = least(numbered.rn, 2)::smallint
  from numbered
 where numbered.id = a.id;

alter table public.fund_expense_approvals
  drop constraint if exists fund_expense_approvals_request_id_stage_key;
alter table public.fund_expense_approvals
  add constraint fund_expense_approvals_request_id_stage_key
  unique (request_id, stage);

-- 5) Automatic monthly dues switch -----------------------------------------
alter table public.fund_settings
  add column if not exists auto_dues_enabled boolean not null default true;

-- 6) API rate limiting (Edge Function service role only) -------------------
create table if not exists public.fund_rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);
alter table public.fund_rate_limits enable row level security;

-- 7) Signup trigger --------------------------------------------------------
create or replace function public.fund_bootstrap_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  display_name text;
  new_profile_id uuid;
begin
  select not exists (select 1 from public.fund_user_profiles) into first_user;

  display_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    split_part(coalesce(new.email, ''), '@', 1)
  );

  insert into public.fund_user_profiles
    (user_id, full_name, email, phone, role, active, approval_status, permissions)
  values (
    new.id,
    case when first_user then 'مدير صندوق بنان الخير للبنيان' else display_name end,
    new.email,
    new.raw_user_meta_data->>'phone',
    case when first_user then 'admin' else 'member' end,
    first_user,
    case when first_user then 'approved' else 'pending' end,
    '{}'::jsonb
  )
  on conflict (user_id) do nothing
  returning user_id into new_profile_id;

  if new_profile_id is not null and not first_user then
    insert into public.fund_notifications
      (user_id, type, title, body, link, entity_type, entity_id)
    select p.user_id,
           'signup_pending',
           'طلب تسجيل جديد بانتظار الموافقة',
           'المستخدم ' || display_name || ' (' || coalesce(new.email, '') || ') طلب الانضمام إلى النظام.',
           '/users',
           'user',
           new.id::text
      from public.fund_user_profiles p
     where p.role = 'admin' and p.active = true and p.approval_status = 'approved';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bootstrap_user_profile on auth.users;
create trigger trg_bootstrap_user_profile
after insert on auth.users
for each row execute function public.fund_bootstrap_profile();

-- 8) Notifications: users may read and mark their own notifications through
-- the API only. Prevent a signed-in client from rewriting notification rows
-- directly through PostgREST.
drop policy if exists notifications_update_own on public.fund_notifications;
revoke update on public.fund_notifications from authenticated;
revoke insert on public.fund_notifications from authenticated;
revoke delete on public.fund_notifications from authenticated;

-- 9) Keep-alive cron: best effort. If pg_cron is unavailable the Edge Function
-- and GitHub Actions workflow still keep the project active.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'banan-keepalive',
      '17 3 * * *',
      'select 1'
    );
  end if;
exception when others then
  raise notice 'pg_cron keep-alive could not be scheduled: %', sqlerrm;
end $$;

-- 10) Make sure the service role can use the new table/columns.
grant all on public.fund_rate_limits to service_role;
