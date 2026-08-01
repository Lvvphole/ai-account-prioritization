-- Stand-in for the Supabase auth schema.
--
-- `auth.uid()` and `auth.role()` are Supabase's own definitions, not
-- approximations: they read the `request.jwt.claims` JSON GUC that PostgREST
-- sets per request, falling back to the legacy per-claim GUC. Using the real
-- bodies means the tests exercise the same resolution path production does,
-- including from inside a trigger.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$$;

-- Supabase provides these roles; RLS policies and grants reference them.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase grants SELECT on new public tables to anon and authenticated via
-- ALTER DEFAULT PRIVILEGES. Reproduced so the explicit revoke in 0013 is tested
-- against something it actually has to take away.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
