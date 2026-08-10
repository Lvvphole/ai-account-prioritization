\set ON_ERROR_STOP on
\pset pager off

create or replace function pg_temp.expect_true(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAIL  %', label;
  end if;
  raise notice 'PASS  %', label;
end;
$$;

create or replace function pg_temp.expect_throws(statement text, label text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'FAIL  %: expected statement to fail', label;
exception
  when others then
    if sqlerrm like 'FAIL  %: expected statement to fail' then
      raise;
    end if;
    raise notice 'PASS  %', label;
end;
$$;

reset role;

\echo '=== P4 qualification invocation write-ahead audit ==='

select pg_temp.expect_true(
  exists (select 1 from pg_roles where rolname = 'p4_audit_writer'),
  'dedicated P4 audit writer role exists');

select pg_temp.expect_true(
  has_function_privilege(
    'p4_audit_writer',
    'public.append_p4_qualification_invocation_audit(jsonb)',
    'EXECUTE'
  ),
  'P4 audit writer can execute only the append RPC boundary');

select pg_temp.expect_true(
  not has_function_privilege(
    'authenticated',
    'public.append_p4_qualification_invocation_audit(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.append_p4_qualification_invocation_audit(jsonb)',
    'EXECUTE'
  ),
  'browser roles cannot execute the P4 audit append RPC');

select pg_temp.expect_true(
  not has_table_privilege('p4_audit_writer', 'public.p4_qualification_invocation_audit', 'SELECT')
  and not has_table_privilege('p4_audit_writer', 'public.p4_qualification_invocation_audit', 'INSERT')
  and not has_table_privilege('p4_audit_writer', 'public.p4_qualification_invocation_audit', 'UPDATE')
  and not has_table_privilege('p4_audit_writer', 'public.p4_qualification_invocation_audit', 'DELETE'),
  'P4 audit writer has no direct table privileges');

select pg_temp.expect_true(
  (select relrowsecurity
     from pg_class
    where oid = 'public.p4_qualification_invocation_audit'::regclass),
  'P4 invocation audit table has RLS enabled');

set role p4_audit_writer;

select pg_temp.expect_true(
  public.append_p4_qualification_invocation_audit(
    jsonb_build_object(
      'kind', 'p4-provider-invocation-v2',
      'phase', 'started',
      'runId', '31400000001',
      'runAttempt', 1,
      'sequence', 1,
      'timestamp', '2026-08-10T19:00:00.000Z',
      'qualificationSourceSha', '66554636d6de2f9167ae7611448b3c17a41f542e',
      'controlRevision', '1111111111111111111111111111111111111111',
      'publisherRevision', '2222222222222222222222222222222222222222',
      'provider', 'anthropic',
      'model', 'claude-test',
      'requestBodyJson', '{"model":"claude-test","messages":[]}',
      'requestBodySha256', encode(
        digest(convert_to('{"model":"claude-test","messages":[]}', 'UTF8'), 'sha256'),
        'hex'
      )
    )
  ) ->> 'replayed' = 'false',
  'writer appends a validated started invocation');

select pg_temp.expect_true(
  public.append_p4_qualification_invocation_audit(
    jsonb_build_object(
      'kind', 'p4-provider-invocation-v2',
      'phase', 'started',
      'runId', '31400000001',
      'runAttempt', 1,
      'sequence', 1,
      'timestamp', '2026-08-10T19:00:00.000Z',
      'qualificationSourceSha', '66554636d6de2f9167ae7611448b3c17a41f542e',
      'controlRevision', '1111111111111111111111111111111111111111',
      'publisherRevision', '2222222222222222222222222222222222222222',
      'provider', 'anthropic',
      'model', 'claude-test',
      'requestBodyJson', '{"model":"claude-test","messages":[]}',
      'requestBodySha256', encode(
        digest(convert_to('{"model":"claude-test","messages":[]}', 'UTF8'), 'sha256'),
        'hex'
      )
    )
  ) ->> 'replayed' = 'true',
  'exact retry is idempotent');

select pg_temp.expect_true(
  public.append_p4_qualification_invocation_audit(
    jsonb_build_object(
      'kind', 'p4-provider-invocation-v2',
      'phase', 'completed',
      'runId', '31400000001',
      'runAttempt', 1,
      'sequence', 1,
      'timestamp', '2026-08-10T19:00:00.250Z',
      'qualificationSourceSha', '66554636d6de2f9167ae7611448b3c17a41f542e',
      'controlRevision', '1111111111111111111111111111111111111111',
      'publisherRevision', '2222222222222222222222222222222222222222',
      'provider', 'anthropic',
      'model', 'claude-test',
      'outcome', 'http_response',
      'httpStatus', 200,
      'durationMs', 250
    )
  ) ->> 'replayed' = 'false',
  'writer appends the matching completed invocation');

reset role;

select pg_temp.expect_true(
  (select count(*) = 2
     from public.p4_qualification_invocation_audit
    where run_id = '31400000001'
      and run_attempt = 1
      and invocation_sequence = 1),
  'started and completed records are both durable');

select pg_temp.expect_throws(
  $$set local role p4_audit_writer;
    select public.append_p4_qualification_invocation_audit(
      jsonb_build_object(
        'kind', 'p4-provider-invocation-v2',
        'phase', 'started',
        'runId', '31400000001',
        'runAttempt', 1,
        'sequence', 1,
        'timestamp', '2026-08-10T19:00:00.001Z',
        'qualificationSourceSha', '66554636d6de2f9167ae7611448b3c17a41f542e',
        'controlRevision', '1111111111111111111111111111111111111111',
        'publisherRevision', '2222222222222222222222222222222222222222',
        'provider', 'anthropic',
        'model', 'claude-test',
        'requestBodyJson', '{"model":"claude-test","messages":[]}',
        'requestBodySha256', encode(
          digest(convert_to('{"model":"claude-test","messages":[]}', 'UTF8'), 'sha256'),
          'hex'
        )
      )
    )$$,
  'same invocation identity cannot be rewritten with different evidence');

select pg_temp.expect_throws(
  $$update public.p4_qualification_invocation_audit
       set record = record || '{"tampered":true}'::jsonb
     where run_id = '31400000001'$$,
  'P4 audit rows cannot be updated');

select pg_temp.expect_throws(
  $$delete from public.p4_qualification_invocation_audit
     where run_id = '31400000001'$$,
  'P4 audit rows cannot be deleted');

\echo 'PASSED: P4 qualification invocation audit is least-privilege, idempotent, and append-only.'
