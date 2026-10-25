-- ---------------------------------------------------------------------------
-- 0006_phone_login.sql
--
-- Allow an administrator to authorize login with a phone number instead of an
-- email address. The API resolves the phone to the linked Auth account and
-- exchanges the password server-side, so the email is never exposed to the
-- browser during phone login.
-- ---------------------------------------------------------------------------

alter table public.fund_user_profiles
  add column if not exists phone_login_enabled boolean not null default false;

-- A phone number used for login must identify exactly one account. Normalize
-- spaces, dashes and country-code punctuation before enforcing uniqueness.
create unique index if not exists idx_profiles_phone_login_unique
  on public.fund_user_profiles (
    regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
  )
  where phone_login_enabled = true
    and phone is not null
    and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') <> '';
