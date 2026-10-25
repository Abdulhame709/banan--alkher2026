-- ---------------------------------------------------------------------------
-- 0005_bulk_import_signing.sql
--
-- Operational upgrades:
--   * Remember manually deleted monthly dues so the automatic generator does
--     not recreate them on the next page load.
--   * Multiple attachments per receipt / expense request.
--   * Electronic signatures and public QR verification tokens.
--   * Reminder log for WhatsApp / SMS follow-ups.
--   * Configurable smart-alert thresholds.
-- ---------------------------------------------------------------------------

-- 1) Deleted-dues exclusions -------------------------------------------------
create table if not exists public.fund_subscription_exclusions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.fund_members(id) on delete cascade,
  hijri_year  smallint not null,
  hijri_month smallint not null check (hijri_month between 1 and 12),
  reason      text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (member_id, hijri_year, hijri_month)
);
create index if not exists idx_subscription_exclusions_month
  on public.fund_subscription_exclusions (hijri_year, hijri_month);
create index if not exists idx_subscription_exclusions_member
  on public.fund_subscription_exclusions (member_id);

alter table public.fund_subscription_exclusions enable row level security;
grant all on public.fund_subscription_exclusions to service_role;

-- 2) Multiple attachments ----------------------------------------------------
create table if not exists public.fund_attachments (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in ('receipt', 'expense')),
  entity_id     uuid not null,
  file_name     text not null,
  original_name text,
  mime_type     text,
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_attachments_entity
  on public.fund_attachments (entity_type, entity_id);
create index if not exists idx_attachments_file
  on public.fund_attachments (file_name);

alter table public.fund_attachments enable row level security;
grant all on public.fund_attachments to service_role;

-- 3) Electronic signatures + public verification ------------------------------
alter table public.fund_receipts
  add column if not exists verify_token uuid not null default gen_random_uuid();
alter table public.fund_receipts
  add column if not exists signed_by_name text;
alter table public.fund_receipts
  add column if not exists signed_by_id uuid references auth.users(id) on delete set null;
alter table public.fund_receipts
  add column if not exists signed_at timestamptz;
alter table public.fund_receipts
  add column if not exists signature_data text;

alter table public.fund_expense_requests
  add column if not exists verify_token uuid not null default gen_random_uuid();
alter table public.fund_expense_requests
  add column if not exists signed_by_name text;
alter table public.fund_expense_requests
  add column if not exists signed_by_id uuid references auth.users(id) on delete set null;
alter table public.fund_expense_requests
  add column if not exists signed_at timestamptz;
alter table public.fund_expense_requests
  add column if not exists signature_data text;

create unique index if not exists idx_receipts_verify_token
  on public.fund_receipts (verify_token);
create unique index if not exists idx_expenses_verify_token
  on public.fund_expense_requests (verify_token);

-- 4) Reminder log ------------------------------------------------------------
create table if not exists public.fund_reminder_logs (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.fund_members(id) on delete cascade,
  channel     text not null check (channel in ('whatsapp', 'sms')),
  message     text not null,
  sent_by     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_reminder_logs_member
  on public.fund_reminder_logs (member_id, created_at desc);
create index if not exists idx_reminder_logs_created
  on public.fund_reminder_logs (created_at desc);

alter table public.fund_reminder_logs enable row level security;
grant all on public.fund_reminder_logs to service_role;

-- 5) Smart-alert settings ----------------------------------------------------
alter table public.fund_settings
  add column if not exists cash_alert_threshold numeric(14,2) not null default 0
    check (cash_alert_threshold >= 0);
alter table public.fund_settings
  add column if not exists commitment_alert_percent smallint not null default 80
    check (commitment_alert_percent between 1 and 100);
alter table public.fund_settings
  add column if not exists approval_alert_days smallint not null default 3
    check (approval_alert_days between 1 and 30);
alter table public.fund_settings
  add column if not exists reminder_day smallint not null default 25
    check (reminder_day between 1 and 31);

-- 6) Keep service-role access complete --------------------------------------
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
