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
