-- Track how a single receipt is distributed across several monthly dues.
-- A subscription receipt may now cover multiple months (for example 5,000 for
-- five past months). The receipt keeps the total, while this table records the
-- exact amount applied to each subscription so deletion can reverse it safely.

create table if not exists public.fund_receipt_allocations (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.fund_receipts(id) on delete cascade,
  subscription_id uuid not null references public.fund_subscriptions(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  created_at      timestamptz not null default now(),
  unique (receipt_id, subscription_id)
);

create index if not exists idx_receipt_allocations_receipt
  on public.fund_receipt_allocations (receipt_id);
create index if not exists idx_receipt_allocations_subscription
  on public.fund_receipt_allocations (subscription_id);

alter table public.fund_receipt_allocations enable row level security;

-- The Edge Function uses the service role, which bypasses RLS. No direct
-- anon/authenticated access is needed for allocation rows.
