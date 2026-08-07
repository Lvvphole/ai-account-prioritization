\set ON_ERROR_STOP on
\pset pager off

-- Regression coverage for migration 0021. Approval is a durable decision about
-- one exact visible payload. The decision does not execute a send or CRM write.

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

create or replace function pg_temp.protected_recommendation()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', 'rec-action-approval-1',
    'runId', 'run-action-approval-1',
    'accountId', 'c2000000-0000-0000-0000-000000000001',
    'ownerId', '33333333-3333-3333-3333-333333333333',
    'score', 82,
    'rank', 1,
    'confidence', 0.94,
    'reasonCodes', jsonb_build_array('strategic_tier_account'),
    'reasonNarrative', 'Verified deterministic recommendation for approval testing.',
    'nextBestAction', jsonb_build_object(
      'type', 'send_email',
      'customerFacing', true,
      'crmWriteBack', false,
      'objective', 'Confirm the customer priority and agree on the next conversation.',
      'draft', 'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?'
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
      'checkedAt', '2026-08-07T14:00:00.000Z'
    ),
    -- Publication approval predates and is distinct from exact-payload approval.
    'approvalStatus', 'approved',
    'published', true,
    'createdAt', '2026-08-07T14:00:00.000Z'
  );
$$;

select pg_temp.expect_true(
  public.persist_published_recommendations(
    jsonb_build_array(pg_temp.protected_recommendation())
  ) = 1,
  'protected recommendation is durably available for representative review');

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

\echo '=== exact visible payload starts pending ==='

select pg_temp.expect_true(
  public.get_action_payload_approval_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?'
  ) ->> 'status' = 'pending_approval',
  'protected payload has no approval before the representative decides');

\echo '=== exact visible payload approval is durable ==='

select pg_temp.expect_true(
  public.record_action_payload_decision(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?',
    'approved'
  ) ->> 'status' = 'approved',
  'representative can approve the exact visible payload');

select pg_temp.expect_true(
  public.get_action_payload_approval_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?'
  ) ->> 'status' = 'approved',
  'same exact payload resolves to its durable approval');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and actor_id = '33333333-3333-3333-3333-333333333333'
      and action = 'action_payload_approval'
      and decision = 'approved'
      and evidence ->> 'recommendationId' = 'rec-action-approval-1'
      and char_length(evidence ->> 'payloadHash') = 64
      and not (evidence ? 'content')),
  'approval audit stores the binding hash without duplicating visible customer content');

\echo '=== changed content invalidates prior approval ==='

select pg_temp.expect_true(
  public.get_action_payload_approval_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm a different next step?'
  ) ->> 'status' = 'pending_approval',
  'changed payload does not reuse approval from earlier content');

select pg_temp.expect_true(
  public.record_action_payload_decision(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm a different next step?',
    'rejected'
  ) ->> 'status' = 'rejected',
  'representative can reject a changed exact payload');

select pg_temp.expect_true(
  public.get_action_payload_approval_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-approval-1',
    'Subject: Next conversation' || E'\n\n' || 'Can we confirm a different next step?'
  ) ->> 'status' = 'rejected',
  'rejection is durable for that exact payload');

select pg_temp.expect_fail(
  $$select public.record_action_payload_decision(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-approval-1',
      'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?',
      'rejected'
    )$$,
  'an immutable approval cannot be rewritten as rejection');

select pg_temp.expect_fail(
  $$select public.record_action_payload_decision(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-approval-1',
      'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?',
      'pending_approval'
    )$$,
  'only explicit approve or reject decisions are accepted');

\echo '=== tenant and current-owner scope fail closed ==='

select pg_temp.expect_fail(
  $$select public.get_action_payload_approval_state(
      'bbbbbbbb-0000-0000-0000-000000000002',
      'rec-action-approval-1',
      'Subject: Next conversation'
    )$$,
  'representative cannot move an approval request to another workspace');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.get_action_payload_approval_state(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-approval-1',
      'Subject: Next conversation'
    )$$,
  'another user cannot approve the representative recommendation');

reset role;

-- Ownership is rechecked against the canonical account at decision time. A
-- published historical recommendation cannot preserve approval authority after
-- reassignment.
update public.accounts
   set owner_id = '44444444-4444-4444-4444-444444444444'
 where id = 'c2000000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.get_action_payload_approval_state(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-approval-1',
      'Subject: Next conversation' || E'\n\n' || 'Can we confirm the priority and next step?'
    )$$,
  'former owner loses payload-approval authority immediately after reassignment');

reset role;
update public.accounts
   set owner_id = '33333333-3333-3333-3333-333333333333'
 where id = 'c2000000-0000-0000-0000-000000000001';
