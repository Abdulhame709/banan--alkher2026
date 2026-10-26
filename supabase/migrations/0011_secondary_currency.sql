-- ---------------------------------------------------------------------------
-- 0011_secondary_currency.sql — optional second currency with a manual rate.
--
-- The fund keeps all accounting amounts in the primary currency (currency).
-- A second currency (default: Saudi Riyal) can be shown next to amounts for
-- reference. exchange_rate is how many primary-currency units equal ONE unit
-- of the secondary currency (for example 400 means 1 SAR = 400 YER).
-- ---------------------------------------------------------------------------

alter table public.fund_settings
  add column if not exists secondary_currency text not null default 'ريال سعودي',
  add column if not exists exchange_rate      numeric(14, 4) not null default 0,
  add column if not exists secondary_enabled  boolean not null default false;

do $$
begin
  alter table public.fund_settings
    add constraint fund_settings_exchange_rate_nonnegative
    check (exchange_rate >= 0);
exception
  when duplicate_object then null;
end $$;

comment on column public.fund_settings.secondary_currency is
  'اسم العملة الثانية المعروضة للمرجعية (مثال: ريال سعودي)';
comment on column public.fund_settings.exchange_rate is
  'كم وحدة من العملة الأساسية تساوي وحدة واحدة من العملة الثانية';
comment on column public.fund_settings.secondary_enabled is
  'إظهار المبالغ بالعملة الثانية بجانب العملة الأساسية';
