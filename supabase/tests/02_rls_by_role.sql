\set ON_ERROR_STOP on
\pset pager off

-- RLS verification. Every query runs as the `authenticated` role with a JWT
-- subject set, exactly as PostgREST would run it.

create or replace function pg_temp.expect_count(sql text, want bigint, label text)
returns void language plpgsql as $$
declare got bigint;
begin
  execute sql into got;
  if got is distinct from want then
    raise exception 'FAIL  %  expected % rows, got %', label, want, got;
  end if;
  raise notice 'PASS  %  (% rows)', label, got;
end;
$$;

-- An UPDATE or DELETE that RLS hides simply affects no rows; it raises nothing.
-- Asserting "an exception was thrown" would pass for the wrong reason, so this
-- checks that nothing changed.
create or replace function pg_temp.expect_no_effect(sql text, label text)
returns void language plpgsql as $$
declare affected bigint;
begin
  begin
    execute sql;
    get diagnostics affected = row_count;
  exception when others then
    raise notice 'PASS  %  (blocked: %)', label, replace(sqlerrm, E'\n', ' ');
    return;
  end;
  if affected <> 0 then
    raise exception 'FAIL  % changed % row(s)', label, affected;
  end if;
  raise notice 'PASS  %  (0 rows affected)', label;
end;
$$;

create or replace function pg_temp.expect_denied(sql text, label text)
returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'PASS  %  (blocked: %)', label, replace(sqlerrm, E'\n', ' ');
    return;
  end;
  raise exception 'FAIL  % was allowed but must be denied', label;
end;
$$;

-- Credential metadata for tenant A, inserted as the owner before any role
-- switch so the read tests below have something they could have leaked.
insert into public.source_credentials
  (workspace_id, source_id, credential_type, provider_ref, fingerprint)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
        'hmac_signing_secret', 'vault://tenant-a/csv', 'a1b2c3d4e5f60718');

-- A published mapping and a staged row, so the manager read tests below are
-- denials of data that exists rather than of an empty table.
insert into public.source_field_mappings
  (workspace_id, mapping_version_id, object_type, source_field, canonical_field, disposition, transform)
values ('aaaaaaaa-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a',
        'account', 'Account Name', 'name', 'mapped', 'trim');

insert into public.staged_records
  (workspace_id, batch_id, mapping_version_id, object_type, external_id, row_hash,
   disposition, normalized_payload, field_trust)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c',
        '30000000-0000-0000-0000-00000000000a', 'account', 'EXT-1', repeat('c', 64),
        'ready', '{"name": "Northwind"}'::jsonb, '{"name": "verified_structured"}'::jsonb);

\echo '=== admin in tenant A ==='
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select pg_temp.expect_count(
  $$select count(*) from public.data_sources$$, 1,
  'admin A sees only tenant A sources');

select pg_temp.expect_count(
  $$select count(*) from public.ingestion_batches$$, 2,
  'admin A sees tenant A batches');

select pg_temp.expect_denied(
  $$select count(*) from public.source_credentials$$,
  'admin A reading credential metadata');

select pg_temp.expect_count(
  $$select count(*) from public.staged_records$$, 1,
  'admin A sees tenant A staged records');

select pg_temp.expect_count(
  $$select count(*) from public.trigger_definitions$$, 1,
  'admin A sees tenant A triggers');

reset role;

\echo '=== admin in tenant B ==='
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select pg_temp.expect_count(
  $$select count(*) from public.data_sources
     where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 0,
  'admin B cannot read tenant A sources');

select pg_temp.expect_count(
  $$select count(*) from public.ingestion_batches$$, 0,
  'admin B cannot read tenant A batches');

select pg_temp.expect_count(
  $$select count(*) from public.domain_events$$, 0,
  'admin B cannot read tenant A events');

select pg_temp.expect_count(
  $$select count(*) from public.trigger_executions$$, 0,
  'admin B cannot read tenant A executions');

-- A write aimed at another tenant is refused by the policy, not silently
-- accepted into the wrong workspace.
select pg_temp.expect_denied(
  $$insert into public.data_sources
      (workspace_id, name, provider, kind, owner_label, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Injected', 'manual_csv', 'csv',
            'attacker', '44444444-4444-4444-4444-444444444444')$$,
  'admin B writing into tenant A');

reset role;

\echo '=== manager in tenant A ==='
set role authenticated;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select pg_temp.expect_count(
  $$select count(*) from public.data_sources$$, 1,
  'manager reads source health');

select pg_temp.expect_count(
  $$select count(*) from public.import_commits$$, 1,
  'manager reads committed imports');

select pg_temp.expect_count(
  $$select count(*) from public.trigger_executions$$, 1,
  'manager reads trigger executions');

select pg_temp.expect_count(
  $$select count(*) from public.ingestion_findings$$, 1,
  'manager reads quarantine findings');

select pg_temp.expect_count(
  $$select count(*) from public.staged_records$$, 0,
  'manager cannot read staged payloads');

select pg_temp.expect_count(
  $$select count(*) from public.import_approvals$$, 0,
  'manager cannot read approvals');

select pg_temp.expect_count(
  $$select count(*) from public.source_field_mappings$$, 0,
  'manager cannot read field mappings');

select pg_temp.expect_denied(
  $$insert into public.data_sources
      (workspace_id, name, provider, kind, owner_label, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Manager source', 'manual_csv', 'csv',
            'manager', '22222222-2222-2222-2222-222222222222')$$,
  'manager connecting a source');

select pg_temp.expect_no_effect(
  $$update public.trigger_definitions set state = 'paused'
     where id = '70000000-0000-0000-0000-00000000000a'$$,
  'manager editing a trigger');

select pg_temp.expect_no_effect(
  $$update public.ingestion_findings set disposition = 'ignored_with_reason',
        reviewed_by = '22222222-2222-2222-2222-222222222222',
        resolution_reason = 'not a problem'
     where id = 'f0000000-0000-0000-0000-00000000000a'$$,
  'manager resolving a finding');

select pg_temp.expect_no_effect(
  $$delete from public.data_sources
     where id = 'd0000000-0000-0000-0000-00000000000a'$$,
  'manager deleting a source');

reset role;

\echo '=== rep in tenant A ==='
set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_count(
  $$select count(*) from public.data_sources$$, 0,
  'rep sees no sources');

select pg_temp.expect_no_effect(
  $$update public.data_sources set state = 'paused'
     where id = 'd0000000-0000-0000-0000-00000000000a'$$,
  'rep pausing a source');

select pg_temp.expect_count(
  $$select count(*) from public.ingestion_batches$$, 0,
  'rep sees no batches');

select pg_temp.expect_count(
  $$select count(*) from public.ingestion_findings$$, 0,
  'rep sees no quarantine');

select pg_temp.expect_count(
  $$select count(*) from public.trigger_definitions$$, 0,
  'rep sees no triggers');

select pg_temp.expect_denied(
  $$select count(*) from public.source_credentials$$,
  'rep reading credential metadata');

reset role;

\echo '=== anonymous ==='
set role anon;
select pg_temp.expect_denied(
  $$select count(*) from public.data_sources$$,
  'anonymous reading the control plane');
reset role;
