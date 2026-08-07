\set ON_ERROR_STOP on
\pset pager off

-- Regression coverage for the 0023 authority-lock repair. The pre-lock executor
-- must not remain callable by representatives; the public execution surface is
-- the locking wrapper only.

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

create or replace function pg_temp.expect_true(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAIL  %', label;
  end if;
  raise notice 'PASS  %', label;
end;
$$;

reset role;

select pg_temp.expect_true(
  not has_function_privilege(
    'authenticated',
    'public.execute_approved_protected_action_unlocked(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated representatives cannot call the pre-lock executor directly');

select pg_temp.expect_true(
  has_function_privilege(
    'authenticated',
    'public.execute_approved_protected_action(uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated execution authority is exposed only through the locking wrapper');

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.execute_approved_protected_action_unlocked(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1',
      'Document the verified account facts and unresolved data-quality gaps before outreach.'
    )$$,
  'representative cannot bypass the authority-lock wrapper');

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.'
  ) ->> 'status' = 'PASS',
  'locking wrapper preserves the verified idempotent execution result');

reset role;
