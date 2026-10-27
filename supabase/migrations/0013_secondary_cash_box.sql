-- ---------------------------------------------------------------------------
-- 0013_secondary_cash_box.sql — independent second cash box (Saudi Riyal).
--
-- The fund keeps its main cash box in the primary currency (YER). This
-- migration adds a second, physically separate cash box in the secondary
-- currency (SAR by default). The only link between the two boxes is an
-- explicit transfer:
--
--   to_secondary : the main box pays amount_primary and the second box
--                  receives amount_secondary.
--   to_primary   : the second box pays amount_secondary and the main box
--                  receives amount_primary.
--
-- The second box balance is NEVER added to the main fund total. It has its
-- own opening balance and its own report. The main cash position only records
-- the value that actually left/entered the main box.
-- ---------------------------------------------------------------------------

alter table public.fund_settings
  add column if not exists secondary_box_enabled     boolean not null default true,
  add column if not exists secondary_opening_balance numeric(14, 2) not null default 0;

do $$
begin
  alter table public.fund_settings
    add constraint fund_settings_secondary_opening_nonnegative
    check (secondary_opening_balance >= 0);
exception
  when duplicate_object then null;
end $$;

comment on column public.fund_settings.secondary_box_enabled is
  'تفعيل الخزينة النقدية الثانية (منفصلة تماماً عن الصندوق الرئيسي)';
comment on column public.fund_settings.secondary_opening_balance is
  'الرصيد الافتتاحي للخزينة الثانية بعملتها (مثال: ريال سعودي) — لا يضاف إلى رصيد الصندوق الرئيسي';

-- ---------------------------------------------------------------------------
-- Transfer voucher sequence
-- ---------------------------------------------------------------------------
insert into public.sequences (name, value) values ('cash_transfer', 0)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Cash transfers between the main box and the second box
-- ---------------------------------------------------------------------------
create table if not exists public.fund_cash_transfers (
  id               uuid primary key default gen_random_uuid(),
  transfer_no      bigint not null,
  direction        text not null check (direction in ('to_secondary', 'to_primary')),
  amount_primary   numeric(14, 2) not null check (amount_primary > 0),
  amount_secondary numeric(14, 2) not null check (amount_secondary > 0),
  rate             numeric(14, 4) not null check (rate > 0),
  transfer_date    date not null default ((now() at time zone 'Asia/Aden')::date),
  notes            text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint fund_cash_transfers_no_unique unique (transfer_no)
);

create index if not exists idx_cash_transfers_date
  on public.fund_cash_transfers (transfer_date desc, transfer_no desc);
create index if not exists idx_cash_transfers_direction
  on public.fund_cash_transfers (direction);

alter table public.fund_cash_transfers enable row level security;

grant select, insert, update, delete on public.fund_cash_transfers to service_role;

comment on table public.fund_cash_transfers is
  'حركات التحويل بين الصندوق الرئيسي والخزينة الثانية — الرصيد الثاني لا يضاف إلى إجمالي الصندوق';
comment on column public.fund_cash_transfers.direction is
  'to_secondary: من الصندوق الرئيسي إلى الخزينة الثانية — to_primary: من الخزينة الثانية إلى الصندوق الرئيسي';
comment on column public.fund_cash_transfers.amount_primary is
  'المبلغ بالعملة الأساسية الذي تحرك من/إلى الصندوق الرئيسي';
comment on column public.fund_cash_transfers.amount_secondary is
  'المبلغ بالعملة الثانية الذي تحرك من/إلى الخزينة الثانية';
comment on column public.fund_cash_transfers.rate is
  'سعر الصرف المستخدم وقت التحويل: كم وحدة من العملة الأساسية تساوي وحدة من العملة الثانية';

-- ---------------------------------------------------------------------------
-- Dashboard payload: net transfers in the main position + second box summary.
-- The signature is unchanged so existing grants keep working.
-- ---------------------------------------------------------------------------
create or replace function public.fund_dashboard_payload(
  p_auto_dues boolean,
  p_hijri_year integer,
  p_hijri_month integer,
  p_due_month date,
  p_today_month text
) returns jsonb
language plpgsql
set search_path = public
as $$
begin
  if coalesce(p_auto_dues, false)
     and coalesce((select auto_dues_enabled from fund_settings where id = 'fund'), false) then
    insert into fund_subscriptions
      (member_id, due_month, hijri_year, hijri_month, amount, paid_amount, status)
    select
      m.id,
      p_due_month,
      p_hijri_year,
      p_hijri_month,
      trunc(m.monthly_fee)::int,
      0,
      'unpaid'
    from fund_members m
    where m.active = true
      and m.monthly_fee > 0
      and not exists (
        select 1
        from fund_subscriptions s
        where s.member_id = m.id
          and (
            s.due_month = p_due_month
            or (s.hijri_year = p_hijri_year and s.hijri_month = p_hijri_month)
          )
      )
      and not exists (
        select 1
        from fund_subscription_exclusions x
        where x.member_id = m.id
          and x.hijri_year = p_hijri_year
          and x.hijri_month = p_hijri_month
      )
    on conflict (member_id, due_month) do nothing;

    update fund_subscriptions s
    set hijri_year = p_hijri_year,
        hijri_month = p_hijri_month
    where s.hijri_year is null
      and s.due_month = p_due_month;
  end if;

  return (
    with position as (
      select
        coalesce((select opening_balance from fund_settings where id = 'fund'), 0) as opening_balance,
        coalesce((select sum(amount) from fund_receipts), 0) as total_receipts,
        coalesce((select sum(amount) from fund_expense_requests where status = 'paid'), 0) as total_paid_expenses,
        coalesce((select sum(amount) from fund_expense_requests where status = 'approved'), 0) as committed_pending,
        coalesce((select sum(case when direction = 'to_primary' then amount_primary else -amount_primary end)
                  from fund_cash_transfers), 0) as transfers_net,
        coalesce((select sum(amount_primary) from fund_cash_transfers
                  where direction = 'to_primary'), 0) as transfers_in,
        coalesce((select sum(amount_primary) from fund_cash_transfers
                  where direction = 'to_secondary'), 0) as transfers_out
    ),
    secondary_box as (
      select
        opening_balance,
        net_movements,
        total_in,
        total_out,
        transfer_count,
        round(opening_balance + net_movements, 2) as balance
      from (
        select
          coalesce((select secondary_opening_balance from fund_settings where id = 'fund'), 0) as opening_balance,
          coalesce(sum(case when direction = 'to_secondary' then amount_secondary
                            else -amount_secondary end), 0) as net_movements,
          coalesce(sum(case when direction = 'to_secondary' then amount_secondary else 0 end), 0) as total_in,
          coalesce(sum(case when direction = 'to_primary' then amount_secondary else 0 end), 0) as total_out,
          count(*) as transfer_count
        from fund_cash_transfers
      ) totals
    ),
    arrears as (
      select
        coalesce(sum(amount - paid_amount), 0) as total_arrears,
        coalesce(sum(case when status <> 'paid' then 1 else 0 end), 0) as open_months,
        coalesce(sum(amount), 0) as total_accrued,
        coalesce(sum(paid_amount), 0) as total_collected,
        count(distinct case when status <> 'paid' then member_id end) as members_in_arrears
      from fund_subscriptions
    ),
    revenue as (
      select receipt_type, is_restricted, coalesce(sum(amount), 0) as total
      from fund_receipts
      group by receipt_type, is_restricted
    ),
    expenses_by_category as (
      select category, coalesce(sum(amount), 0) as total, count(*) as count
      from fund_expense_requests
      where status = 'paid'
      group by category
      order by total desc
    ),
    pending as (
      select e.*, p.full_name as created_by_name
      from fund_expense_requests e
      left join fund_user_profiles p on p.user_id = e.created_by
      where e.status = 'pending'
      order by e.created_at desc
      limit 6
    ),
    pending_summary as (
      select
        count(*) as count,
        coalesce(sum(amount), 0) as total,
        coalesce(max(extract(day from now() - created_at)), 0) as max_days
      from fund_expense_requests
      where status = 'pending'
    ),
    recent_receipts as (
      select
        r.id, r.receipt_no, r.receipt_type, r.amount, r.receipt_date,
        coalesce(m.full_name, r.donor_name, 'متبرع') as party,
        r.is_restricted
      from fund_receipts r
      left join fund_members m on m.id = r.member_id
      order by r.receipt_date desc, r.receipt_no desc
      limit 6
    ),
    approved as (
      select
        e.id, e.request_no, e.beneficiary_name, e.amount, e.category, e.approval_count
      from fund_expense_requests e
      where e.status = 'approved'
      order by e.created_at asc
      limit 5
    ),
    member_stats as (
      select
        count(*) as total,
        coalesce(sum(case when active then 1 else 0 end), 0) as active,
        coalesce(sum(case when to_char(joined_on, 'YYYY-MM') = p_today_month then 1 else 0 end), 0) as new_this_month
      from fund_members
    ),
    receipt_trend as (
      select to_char(receipt_date, 'YYYY-MM') as month, coalesce(sum(amount), 0) as total
      from fund_receipts
      group by month
    ),
    expense_trend as (
      select
        to_char(disbursed_at at time zone 'Asia/Aden', 'YYYY-MM') as month,
        coalesce(sum(amount), 0) as total
      from fund_expense_requests
      where status = 'paid'
      group by month
    )
    select jsonb_build_object(
      'settings', (select to_jsonb(s) from fund_settings s where s.id = 'fund'),
      'position', (select to_jsonb(p) from position p),
      'secondary_box', (select to_jsonb(b) from secondary_box b),
      'arrears', (select to_jsonb(a) from arrears a),
      'revenue', (select coalesce(jsonb_agg(r), '[]'::jsonb) from revenue r),
      'expenses_by_category', (select coalesce(jsonb_agg(e), '[]'::jsonb) from expenses_by_category e),
      'pending', (select coalesce(jsonb_agg(p), '[]'::jsonb) from pending p),
      'pending_summary', (select to_jsonb(s) from pending_summary s),
      'recent_receipts', (select coalesce(jsonb_agg(r), '[]'::jsonb) from recent_receipts r),
      'approved', (select coalesce(jsonb_agg(a), '[]'::jsonb) from approved a),
      'member_stats', (select to_jsonb(m) from member_stats m),
      'receipt_trend', (select coalesce(jsonb_agg(r), '[]'::jsonb) from receipt_trend r),
      'expense_trend', (select coalesce(jsonb_agg(e), '[]'::jsonb) from expense_trend e)
    )
  );
end;
$$;

revoke all on function public.fund_dashboard_payload(boolean, integer, integer, date, text) from public;
revoke all on function public.fund_dashboard_payload(boolean, integer, integer, date, text) from anon;
revoke all on function public.fund_dashboard_payload(boolean, integer, integer, date, text) from authenticated;
grant execute on function public.fund_dashboard_payload(boolean, integer, integer, date, text) to postgres;
grant execute on function public.fund_dashboard_payload(boolean, integer, integer, date, text) to service_role;
