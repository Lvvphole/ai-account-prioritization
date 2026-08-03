\set ON_ERROR_STOP on
\pset pager off

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

create or replace function pg_temp.expect_ok(sql text, label text)
returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'PASS  %', label;
end;
$$;

\echo '=== capability temporal authority ==='

set role service_role;

select pg_temp.expect_fail(
  $$insert into public.account_source_capabilities
      (account_id, workspace_id, source, capabilities, mapping_version, observed_at)
    values ('90000000-0000-0000-0000-0000000000b2',
            'bbbbbbbb-0000-0000-0000-000000000002',
            'salesforce', '{}'::jsonb, 'account-v1',
            statement_timestamp() + interval '1 day')$$,
  'future capability observation is rejected before durable authority');

select pg_temp.expect_ok(
  $$insert into public.account_source_capabilities
      (account_id, workspace_id, source, capabilities, mapping_version, observed_at)
    values ('90000000-0000-0000-0000-0000000000b2',
            'bbbbbbbb-0000-0000-0000-000000000002',
            'salesforce', '{}'::jsonb, 'account-v1',
            statement_timestamp() - interval '1 minute')$$,
  'correctly dated capability observation remains admissible after rejected future input');

select pg_temp.expect_fail(
  $$update public.account_source_capabilities
       set observed_at = observed_at - interval '1 minute'
     where account_id = '90000000-0000-0000-0000-0000000000b2'$$,
  'current capability authority cannot move backward');

select pg_temp.expect_fail(
  $$update public.account_source_capabilities
       set capabilities = '{"contacts":true}'::jsonb
     where account_id = '90000000-0000-0000-0000-0000000000b2'$$,
  'equal-time replay cannot replace authoritative content');

select pg_temp.expect_ok(
  $$update public.account_source_capabilities
       set capabilities = '{"contacts":true}'::jsonb,
           observed_at = statement_timestamp()
     where account_id = '90000000-0000-0000-0000-0000000000b2'$$,
  'newer correctly dated capability evidence can replace current authority');

reset role;
