\set ON_ERROR_STOP on
\pset pager off

-- Migration 0015: private ingestion buckets and retention policy.
--
-- Scope note. The storage schema here is a stand-in (see 00), so these
-- assertions prove the policy predicate and the retention table, not the
-- behaviour of the real Supabase storage service.

create or replace function pg_temp.expect_fail(sql text, label text)
returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'PASS  %  (blocked: %)', label, replace(sqlerrm, E'\n', ' ');
    return;
  end;
  raise exception 'FAIL  % was allowed but must be blocked', label;
end;
$$;

create or replace function pg_temp.expect_count(sql text, want bigint, label text)
returns void language plpgsql as $$
declare got bigint;
begin
  execute sql into got;
  if got is distinct from want then
    raise exception 'FAIL  %  expected %, got %', label, want, got;
  end if;
  raise notice 'PASS  %  (% rows)', label, got;
end;
$$;

\echo '=== buckets are private ==='

select pg_temp.expect_count(
  $$select count(*) from storage.buckets
     where id in ('ingestion-quarantine','ingestion-rejected','ingestion-reports')$$, 3,
  'all three ingestion buckets exist');

select pg_temp.expect_count(
  $$select count(*) from storage.buckets
     where id like 'ingestion-%' and public$$, 0,
  'no ingestion bucket is public');

\echo '=== retention is recorded as data ==='

select pg_temp.expect_count(
  $$select retention_days from public.storage_retention_policies
     where bucket = 'ingestion-quarantine'$$, 7,
  'raw uploads are kept 7 days');

select pg_temp.expect_count(
  $$select retention_days from public.storage_retention_policies
     where bucket = 'ingestion-rejected'$$, 30,
  'rejected-row reports are kept 30 days');

select pg_temp.expect_fail(
  $$insert into public.storage_retention_policies (bucket, retention_days)
    values ('some-other-bucket', 7)$$,
  'a retention row for an unknown bucket');

select pg_temp.expect_fail(
  $$insert into public.storage_retention_policies (bucket, retention_days)
    values ('ingestion-reports', 0)$$,
  'a zero-day retention window');

\echo '=== no browser role reaches a stored object ==='

-- Two objects, one per tenant, written as the owner before any role switch.
insert into storage.objects (bucket_id, name) values
  ('ingestion-quarantine',
   'aaaaaaaa-0000-0000-0000-000000000001/b0000000-0000-0000-0000-00000000000a/u1.csv'),
  ('ingestion-quarantine',
   'bbbbbbbb-0000-0000-0000-000000000002/b0000000-0000-0000-0000-00000000000b/u2.csv');

-- Section 16.1: the browser cannot list a workspace bucket. A workspace-scoped
-- read policy would satisfy tenancy and still permit enumeration, so there is
-- no policy at all and every role below sees nothing.
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select pg_temp.expect_count(
  $$select count(*) from storage.objects$$, 0,
  'a workspace admin cannot enumerate quarantined uploads');

select pg_temp.expect_fail(
  $$insert into storage.objects (bucket_id, name)
    values ('ingestion-quarantine',
            'aaaaaaaa-0000-0000-0000-000000000001/b0000000-0000-0000-0000-00000000000a/x.csv')$$,
  'a workspace admin writing an object directly');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select pg_temp.expect_count(
  $$select count(*) from storage.objects$$, 0,
  'a manager reads no raw uploads');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_count(
  $$select count(*) from storage.objects$$, 0,
  'a rep reads no raw uploads');

reset role;

-- The service role still reaches them, which is how signed URLs get minted.
select pg_temp.expect_count(
  $$select count(*) from storage.objects$$, 2,
  'the service context still sees both objects');
