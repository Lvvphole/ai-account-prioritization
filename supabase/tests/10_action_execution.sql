\set ON_ERROR_STOP on
\pset pager off

-- Regression coverage for migration 0022. The only admitted in-app protected
-- executor is an exact-payload-approved CRM research-note write. Customer-facing
-- actions remain blocked because no external executor is configured.

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

create or replace function pg_temp.crm_note_recommendation()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', 'rec-action-execution-1',
    'runId', 'run-action-execution-1',
    'accountId', 'c2000000-0000-0000-0000-000000000001',
    'ownerId', '33333333-3333-3333-3333-333333333333',
    'score', 78,
    'rank', 1,
    'confidence', 0.91,
    'reasonCodes', jsonb_build_array('data_quality_blocked'),
    'reasonNarrative', 'Verified deterministic recommendation for protected execution testing.',
    'nextBestAction', jsonb_build_object(
      'type', 'log_research_note',
      'customerFacing', false,
      'crmWriteBack', true,
      'objective', 'Document verified account research before outreach.',
      'draft', 'Document the verified account facts and unresolved data-quality gaps before outreach.'
    ),
    'sourceSignals', jsonb_build_array(jsonb_build_object(
      'kind', 'account',
      'refId', 'c2000000-0000-0000-0000-000000000001',
      'description', 'Canonical account evidence.',
      'verified', true
    )),
    'verification', jsonb_build_object(
      'status', 'passed',
      'schemaValid', true,
      'guardrailsPassed', true,
      'sourceSignalsVerified', true,
      'permissionGranted', true,
      'failedGates', '[]'::jsonb,
      'checkedAt', '2026-08-07T15:30:00.000Z'
    ),
    -- Publication approval and exact-payload approval are distinct.
    'approvalStatus', 'approved',
    'published', true,
    'createdAt', '2026-08-07T15:30:00.000Z'
  );
$$;

reset role;

select pg_temp.expect_true(
  public.persist_published_recommendations(
    jsonb_build_array(pg_temp.crm_note_recommendation())
  ) = 1,
  'protected CRM-note recommendation is durably persisted');

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

\echo '=== direct CRM mutation cannot bypass the protected execution boundary ==='

select pg_temp.expect_fail(
  $$insert into public.activities (
      workspace_id,
      account_id,
      type,
      subject,
      body,
      occurred_at,
      created_by_id,
      verified
    ) values (
      'aaaaaaaa-0000-0000-0000-000000000001',
      'c2000000-0000-0000-0000-000000000001',
      'note',
      'Bypass attempt',
      'This direct write must not be accepted.',
      now(),
      '33333333-3333-3333-3333-333333333333',
      false
    )$$,
  'representative cannot bypass exact-payload approval with a direct activities insert');

\echo '=== pending approval blocks execution and creates no CRM note ==='

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.'
  ) ->> 'status' = 'BLOCKED',
  'protected CRM write is blocked before exact-payload approval');

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.'
  ) ->> 'resultCode' = 'APPROVAL_REQUIRED',
  'blocked execution reports the missing exact-payload approval');

select pg_temp.expect_true(
  (select count(*) = 0
     from public.activities
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and body = 'Document the verified account facts and unresolved data-quality gaps before outreach.'),
  'blocked execution creates no CRM activity');

\echo '=== approved exact payload executes once and verifies the CRM postcondition ==='

select pg_temp.expect_true(
  public.record_action_payload_decision(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.',
    'approved'
  ) ->> 'status' = 'approved',
  'representative approves the exact CRM-note payload');

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.'
  ) ->> 'status' = 'PASS',
  'approved CRM note reaches deterministic PASS');

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.'
  ) ->> 'resultCode' = 'CRM_NOTE_WRITTEN',
  'verified execution reports the concrete CRM-write result');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.activities
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and created_by_id = '33333333-3333-3333-3333-333333333333'
      and type = 'note'
      and body = 'Document the verified account facts and unresolved data-quality gaps before outreach.'
      and verified = false),
  'execution writes exactly one unverified research note to the canonical CRM activity store');

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.'
  ) ->> 'replayed' = 'true',
  'exact replay returns the idempotent prior result');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.activities
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and body = 'Document the verified account facts and unresolved data-quality gaps before outreach.'),
  'idempotent replay does not duplicate the CRM note');

reset role;

select pg_temp.expect_true(
  (select count(*) = 1
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and actor_id = '33333333-3333-3333-3333-333333333333'
      and action = 'protected_action_execution'
      and decision = 'allowed'
      and evidence ->> 'recommendationId' = 'rec-action-execution-1'
      and evidence ->> 'resultCode' = 'CRM_NOTE_WRITTEN'
      and char_length(evidence ->> 'payloadHash') = 64
      and char_length(evidence ->> 'idempotencyKey') = 64
      and evidence ? 'activityId'
      and not (evidence ? 'content')),
  'successful side effect has one durable idempotent audit record without raw payload duplication');

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

\echo '=== changed or rejected payloads cannot inherit execution authority ==='

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Changed research note content.'
  ) ->> 'resultCode' = 'APPROVAL_REQUIRED',
  'changed payload cannot reuse the earlier execution approval');

select pg_temp.expect_true(
  public.record_action_payload_decision(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Changed research note content.',
    'rejected'
  ) ->> 'status' = 'rejected',
  'changed payload can be explicitly rejected');

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Changed research note content.'
  ) ->> 'resultCode' = 'APPROVAL_REJECTED',
  'rejected payload remains blocked from execution');

\echo '=== customer-facing execution stays blocked without an external executor ==='

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?'
  ) ->> 'status' = 'BLOCKED',
  'approved customer-facing payload is not falsely reported as executed');

select pg_temp.expect_true(
  public.execute_approved_protected_action(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?'
  ) ->> 'resultCode' = 'EXTERNAL_EXECUTOR_NOT_CONFIGURED',
  'customer-facing action names the missing execution dependency');

\echo '=== tenant and current-owner authority are rechecked immediately before write ==='

select pg_temp.expect_fail(
  $$select public.execute_approved_protected_action(
      'bbbbbbbb-0000-0000-0000-000000000002',
      'rec-action-execution-1',
      'Document the verified account facts and unresolved data-quality gaps before outreach.'
    )$$,
  'representative cannot execute the recommendation in another workspace');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.execute_approved_protected_action(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1',
      'Document the verified account facts and unresolved data-quality gaps before outreach.'
    )$$,
  'another user cannot execute the representative recommendation');

reset role;

update public.accounts
   set owner_id = '44444444-4444-4444-4444-444444444444'
 where id = 'c2000000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.execute_approved_protected_action(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1',
      'Document the verified account facts and unresolved data-quality gaps before outreach.'
    )$$,
  'former owner loses execution authority immediately after reassignment');

reset role;

update public.accounts
   set owner_id = '33333333-3333-3333-3333-333333333333'
 where id = 'c2000000-0000-0000-0000-000000000001';
