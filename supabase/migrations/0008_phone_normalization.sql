-- ---------------------------------------------------------------------------
-- 0008_phone_normalization.sql
--
-- Accept the same Yemeni phone number written as 777123456, 0777123456,
-- +967 777 123 456 or 00967 777 123 456. Normalization is shared by the
-- database index and the Edge Function so duplicates cannot be created by
-- changing the country-code format.
-- ---------------------------------------------------------------------------

create or replace function public.normalize_phone(value text)
returns text
language sql
immutable
as $$
  with digits as (
    select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') as value
  )
  select case
    when value like '00967%' then substring(value from 6)
    when length(value) > 9 and value like '967%' then substring(value from 4)
    when length(value) > 9 and value like '0%' then substring(value from 2)
    else value
  end
  from digits;
$$;

comment on function public.normalize_phone(text) is
  'Normalizes Yemeni phone numbers by removing punctuation, 00967, 967 and leading zero.';

drop index if exists public.idx_profiles_phone_login_unique;

create unique index idx_profiles_phone_login_unique
  on public.fund_user_profiles (public.normalize_phone(phone))
  where phone_login_enabled = true
    and phone is not null
    and public.normalize_phone(phone) <> '';
