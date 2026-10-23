-- ---------------------------------------------------------------------------
-- 001_init.sql — PostgreSQL schema for the Banan Charity Fund system.
--
-- Design notes:
--  * Money is numeric(14,2); the Node pg driver parses it to Number.
--  * Dates are date; timestamps are timestamptz; both are returned as ISO
--    strings by the driver (see server/db.js).
--  * Every table has RLS enabled with no public policies: only the server
--    connection (postgres role) can read/write. This blocks Supabase's
--    PostgREST anon/authenticated access unless policies are added later.
--  * Audit rows are append-only, enforced by a trigger.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Authentication identities (custom auth; the UI never sees raw passwords)
-- ---------------------------------------------------------------------------
create table if not exists auth_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  full_name     text not null,
  phone         text,
  created_at    timestamptz not null default now()
);
create unique index if not exists ux_auth_users_email on auth_users (lower(email));
create index if not exists idx_auth_users_created on auth_users (created_at);

-- ---------------------------------------------------------------------------
-- Sessions (hashed tokens only)
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  token_hash text primary key,
  user_id    uuid not null references auth_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip         text
);
create index if not exists idx_sessions_user on sessions (user_id);
create index if not exists idx_sessions_expires on sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 1) Fund settings (single row, id = 'fund')
-- ---------------------------------------------------------------------------
create table if not exists fund_settings (
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
insert into fund_settings (id) values ('fund') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Members
-- ---------------------------------------------------------------------------
create table if not exists fund_members (
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
create index if not exists idx_members_active on fund_members (active);
create index if not exists idx_members_name on fund_members (full_name);

-- ---------------------------------------------------------------------------
-- 3) User profiles & roles
-- ---------------------------------------------------------------------------
create table if not exists fund_user_profiles (
  user_id          uuid primary key references auth_users(id) on delete cascade,
  full_name        text not null,
  email            text,
  phone            text,
  role             text not null default 'member'
                   check (role in ('admin','accountant','treasurer','board_member','member')),
  linked_member_id uuid references fund_members(id) on delete set null,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists idx_profiles_role on fund_user_profiles (role);
create index if not exists idx_profiles_member on fund_user_profiles (linked_member_id);

-- ---------------------------------------------------------------------------
-- 4) Monthly accruals / dues
-- ---------------------------------------------------------------------------
create table if not exists fund_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references fund_members(id) on delete cascade,
  due_month   date not null check (date_part('day', due_month) = 1),
  amount      numeric(14,2) not null default 1000 check (amount > 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status      text not null default 'unpaid' check (status in ('unpaid','partial','paid')),
  created_at  timestamptz not null default now(),
  unique (member_id, due_month),
  check (paid_amount <= amount)
);
create index if not exists idx_subscriptions_member on fund_subscriptions (member_id);
create index if not exists idx_subscriptions_month on fund_subscriptions (due_month);
create index if not exists idx_subscriptions_status on fund_subscriptions (status);

-- ---------------------------------------------------------------------------
-- 5) Receipt vouchers (subscriptions, donations, other income)
-- ---------------------------------------------------------------------------
create table if not exists fund_receipts (
  id                 uuid primary key default gen_random_uuid(),
  receipt_no         integer not null unique,
  receipt_type       text not null check (receipt_type in ('subscription','donation','other')),
  member_id          uuid references fund_members(id) on delete set null,
  subscription_id    uuid references fund_subscriptions(id) on delete set null,
  donor_name         text,
  amount             numeric(14,2) not null check (amount > 0),
  payment_method     text not null default 'cash' check (payment_method in ('cash','bank_transfer')),
  is_restricted      boolean not null default false,
  restricted_purpose text,
  receipt_date       date not null default current_date,
  attachment_url     text,
  notes              text,
  created_by         uuid references auth_users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_receipts_date on fund_receipts (receipt_date);
create index if not exists idx_receipts_member on fund_receipts (member_id);
create index if not exists idx_receipts_type on fund_receipts (receipt_type);
create index if not exists idx_receipts_subscription on fund_receipts (subscription_id);

-- ---------------------------------------------------------------------------
-- 6) Expense / aid requests
-- ---------------------------------------------------------------------------
create table if not exists fund_expense_requests (
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
  created_by          uuid references auth_users(id) on delete set null,
  disbursed_by        uuid references auth_users(id) on delete set null,
  disbursed_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_expenses_status on fund_expense_requests (status);
create index if not exists idx_expenses_date on fund_expense_requests (requested_date);
create index if not exists idx_expenses_created on fund_expense_requests (created_at);

-- ---------------------------------------------------------------------------
-- 7) Independent dual-approval records
--    unique(request_id, approver_id): nobody can approve the same request twice.
-- ---------------------------------------------------------------------------
create table if not exists fund_expense_approvals (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references fund_expense_requests(id) on delete cascade,
  approver_id   uuid not null,
  approver_name text not null,
  approver_role text not null,
  decision      text not null check (decision in ('approved','rejected')),
  notes         text,
  created_at    timestamptz not null default now(),
  unique (request_id, approver_id)
);
create index if not exists idx_approvals_request on fund_expense_approvals (request_id);

-- ---------------------------------------------------------------------------
-- 8) Immutable audit trail
-- ---------------------------------------------------------------------------
create table if not exists fund_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  entity_type text not null,
  entity_id   text,
  actor_id    uuid,
  actor_name  text,
  details     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created on fund_audit_logs (created_at);
create index if not exists idx_audit_entity on fund_audit_logs (entity_type, entity_id);
create index if not exists idx_audit_actor on fund_audit_logs (actor_id);

create or replace function fund_audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'سجل التدقيق غير قابل للتعديل أو الحذف';
end;
$$;

drop trigger if exists trg_audit_no_change on fund_audit_logs;
create trigger trg_audit_no_change
before update or delete on fund_audit_logs
for each row execute function fund_audit_immutable();

-- ---------------------------------------------------------------------------
-- Voucher number sequences (atomic increments)
-- ---------------------------------------------------------------------------
create table if not exists sequences (
  name  text primary key,
  value bigint not null default 0 check (value >= 0)
);
insert into sequences (name, value) values
  ('receipt', 0),
  ('expense_request', 0),
  ('payment_voucher', 0)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Auto-bootstrap profile: the first registered identity becomes the admin.
-- ---------------------------------------------------------------------------
create or replace function fund_bootstrap_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from fund_user_profiles) into first_user;

  insert into fund_user_profiles (user_id, full_name, email, phone, role, active)
  values (
    new.id,
    case when first_user then 'مدير صندوق بنان الخير للبنيان' else new.full_name end,
    new.email,
    new.phone,
    case when first_user then 'admin' else 'member' end,
    true
  );
  return new;
end;
$$;

drop trigger if exists trg_bootstrap_user_profile on auth_users;
create trigger trg_bootstrap_user_profile
after insert on auth_users
for each row execute function fund_bootstrap_profile();

-- ---------------------------------------------------------------------------
-- Notifications & push subscriptions
-- ---------------------------------------------------------------------------
create table if not exists fund_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth_users(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  entity_type text,
  entity_id   text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_user on fund_notifications (user_id, created_at desc);
create index if not exists idx_notifications_unread on fund_notifications (user_id) where read_at is null;

create table if not exists fund_push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth_users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_user on fund_push_subscriptions (user_id);

create table if not exists fund_device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth_users(id) on delete cascade,
  token      text not null unique,
  platform   text not null default 'android',
  created_at timestamptz not null default now()
);
create index if not exists idx_device_tokens_user on fund_device_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Backups metadata (files live in object storage / local disk)
-- ---------------------------------------------------------------------------
create table if not exists fund_backups (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  size_bytes   bigint not null default 0,
  storage_path text not null,
  created_by   uuid references auth_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_backups_created on fund_backups (created_at desc);

-- ---------------------------------------------------------------------------
-- Derived member financial position (accrual view — never cash)
-- ---------------------------------------------------------------------------
create or replace view v_member_financials as
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
from fund_members m
left join fund_subscriptions s on s.member_id = m.id
group by m.id;

-- ---------------------------------------------------------------------------
-- Defence in depth: block PostgREST/anon access. The server connects with a
-- privileged role and is unaffected. Add explicit policies only if the mobile
-- client ever talks to Supabase directly.
-- ---------------------------------------------------------------------------
alter table auth_users              enable row level security;
alter table sessions                enable row level security;
alter table fund_settings           enable row level security;
alter table fund_members            enable row level security;
alter table fund_user_profiles      enable row level security;
alter table fund_subscriptions      enable row level security;
alter table fund_receipts           enable row level security;
alter table fund_expense_requests   enable row level security;
alter table fund_expense_approvals  enable row level security;
alter table fund_audit_logs         enable row level security;
alter table sequences               enable row level security;
alter table fund_notifications      enable row level security;
alter table fund_push_subscriptions enable row level security;
alter table fund_device_tokens      enable row level security;
alter table fund_backups            enable row level security;
