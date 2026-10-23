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
