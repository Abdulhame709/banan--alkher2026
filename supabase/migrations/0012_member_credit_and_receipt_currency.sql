-- ---------------------------------------------------------------------------
-- 0012_member_credit_and_receipt_currency.sql
--
-- 1) Overpayments on subscription receipts are no longer rejected. The excess
--    is recorded as a member credit (advance) and applied automatically to the
--    oldest unpaid dues, including dues generated for future months.
-- 2) Receipts may be entered in the secondary currency (for example Saudi
--    Riyal). Accounting stays in the primary currency; the original entry
--    amount, currency and rate are kept for printing and audit.
-- ---------------------------------------------------------------------------

alter table public.fund_receipts
  add column if not exists entry_currency text,
  add column if not exists entry_amount   numeric(14, 2),
  add column if not exists entry_rate     numeric(14, 4);

comment on column public.fund_receipts.entry_currency is
  'العملة التي أدخل بها المستخدم مبلغ السند (عملة الأساس أو العملة الثانية)';
comment on column public.fund_receipts.entry_amount is
  'المبلغ كما أدخله المستخدم بعملة الإدخال قبل التحويل إلى العملة الأساسية';
comment on column public.fund_receipts.entry_rate is
  'سعر الصرف المستخدم عند الإدخال: كم وحدة من العملة الأساسية تساوي وحدة من عملة الإدخال';

-- ---------------------------------------------------------------------------
-- Member credit ledger
--
-- amount is signed:
--   advance = positive credit created by an overpaid receipt
--   apply   = negative amount consumed to settle a monthly due
-- The balance is simply sum(amount) for the member.
-- ---------------------------------------------------------------------------
create table if not exists public.fund_member_credit_ledger (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.fund_members(id) on delete cascade,
  receipt_id       uuid references public.fund_receipts(id) on delete restrict,
  subscription_id  uuid references public.fund_subscriptions(id) on delete restrict,
  source_credit_id uuid references public.fund_member_credit_ledger(id) on delete restrict,
  kind             text not null check (kind in ('advance', 'apply')),
  amount           numeric(14, 2) not null check (amount <> 0),
  note             text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint fund_member_credit_kind_amount check (
    (kind = 'advance' and amount > 0 and receipt_id is not null)
    or
    (kind = 'apply' and amount < 0 and subscription_id is not null and source_credit_id is not null)
  )
);

create index if not exists idx_member_credit_member
  on public.fund_member_credit_ledger (member_id, created_at);
create index if not exists idx_member_credit_receipt
  on public.fund_member_credit_ledger (receipt_id);
create index if not exists idx_member_credit_subscription
  on public.fund_member_credit_ledger (subscription_id);
create index if not exists idx_member_credit_source
  on public.fund_member_credit_ledger (source_credit_id);

alter table public.fund_member_credit_ledger enable row level security;

comment on table public.fund_member_credit_ledger is
  'سجل الرصيد الدائن للأعضاء: إيداع فائض سند، وخصم عند سداد استحقاق شهري';

-- ---------------------------------------------------------------------------
-- Apply available member credit to the oldest unpaid dues (FIFO).
-- Returns the total amount applied. Safe to call repeatedly.
-- ---------------------------------------------------------------------------
create or replace function public.apply_member_credits(
  p_member_id uuid,
  p_created_by uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_advance   record;
  v_due       record;
  v_remaining numeric(14, 2);
  v_take      numeric(14, 2);
  v_applied   numeric(14, 2) := 0;
begin
  -- Serialize credit application for the same member.
  perform 1 from public.fund_members where id = p_member_id for update;
  if not found then
    return 0;
  end if;

  for v_advance in
    select l.id,
           l.amount + coalesce(sum(a.amount), 0) as remaining
      from public.fund_member_credit_ledger l
      left join public.fund_member_credit_ledger a
        on a.source_credit_id = l.id and a.kind = 'apply'
     where l.member_id = p_member_id
       and l.kind = 'advance'
     group by l.id, l.amount, l.created_at
    having l.amount + coalesce(sum(a.amount), 0) > 0
     order by l.created_at asc, l.id asc
  loop
    v_remaining := v_advance.remaining;

    for v_due in
      select s.id, s.amount, s.paid_amount
        from public.fund_subscriptions s
       where s.member_id = p_member_id
         and s.status <> 'paid'
         and s.paid_amount < s.amount
       order by s.due_month asc, s.created_at asc
       for update
    loop
      exit when v_remaining <= 0;

      v_take := least(v_remaining, v_due.amount - v_due.paid_amount);
      if v_take > 0 then
        update public.fund_subscriptions
           set paid_amount = paid_amount + v_take,
               status = case
                 when paid_amount + v_take >= amount then 'paid'
                 else 'partial'
               end
         where id = v_due.id;

        insert into public.fund_member_credit_ledger
          (member_id, subscription_id, source_credit_id, kind, amount, note, created_by)
        values
          (p_member_id, v_due.id, v_advance.id, 'apply', -v_take,
           'تطبيق رصيد دائن على استحقاق شهري', p_created_by);

        v_remaining := v_remaining - v_take;
        v_applied := v_applied + v_take;
      end if;
    end loop;
  end loop;

  return v_applied;
end;
$$;

revoke all on function public.apply_member_credits(uuid, uuid) from public;
grant execute on function public.apply_member_credits(uuid, uuid) to postgres;
grant execute on function public.apply_member_credits(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Expose the net credit balance on the member financial view.
-- create or replace view only allows appending columns at the end.
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
  count(s.id)                                         as due_months,
  coalesce((
    select sum(l.amount)
      from public.fund_member_credit_ledger l
     where l.member_id = m.id
  ), 0)                                               as advance_balance
from public.fund_members m
left join public.fund_subscriptions s on s.member_id = m.id
group by m.id;

comment on column public.v_member_financials.advance_balance is
  'صافي الرصيد الدائن للعضو المتاح لسداد الأشهر القادمة';
