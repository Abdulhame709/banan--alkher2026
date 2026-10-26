-- Dashboard payload in one round trip.
--
-- The Edge Function used to make a dozen sequential queries for the dashboard.
-- Every query pays a transaction-pooler round trip, so the screen took several
-- seconds even with only 35 members. This function generates the current month
-- dues and returns the whole dashboard payload atomically.
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
        coalesce((select sum(amount) from fund_expense_requests where status = 'approved'), 0) as committed_pending
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

-- The dashboard function returns the full financial payload. It must only be
-- callable by the Edge Function's database role, never through PostgREST.
revoke all on function public.fund_dashboard_payload(boolean, integer, integer, date, text) from public;
revoke all on function public.fund_dashboard_payload(boolean, integer, integer, date, text) from anon;
revoke all on function public.fund_dashboard_payload(boolean, integer, integer, date, text) from authenticated;
grant execute on function public.fund_dashboard_payload(boolean, integer, integer, date, text) to postgres;
grant execute on function public.fund_dashboard_payload(boolean, integer, integer, date, text) to service_role;
