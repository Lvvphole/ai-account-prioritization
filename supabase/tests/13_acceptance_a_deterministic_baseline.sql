\set ON_ERROR_STOP on
\pset pager off

-- Acceptance A closes the deterministic production-shaped spine after the
-- behavioral migration suites have exercised ingestion, recommendation
-- persistence, RLS reads, exact-payload approval, protected execution, and
-- durable follow-up capture. This suite verifies that those durable stages form
-- one authority-preserving representative path.

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

\echo '=== Acceptance A durable authority continuity ==='

select pg_temp.expect_true(
  (select count(*) = 1
     from public.accounts
    where id = 'c2000000-0000-0000-0000-000000000001'
      and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and owner_id = '33333333-3333-3333-3333-333333333333'),
  'canonical account remains bound to the authorized workspace and representative');

select pg_temp.expect_true(
  (select score = 78
      and rank = 1
      and confidence = 0.91
      and reason_codes = array['data_quality_blocked']::text[]
      and next_best_action ->> 'type' = 'log_research_note'
      and next_best_action ->> 'crmWriteBack' = 'true'
      and approval_status = 'approved'::public.approval_status
      and published = true
      and verification ->> 'status' = 'passed'
     from public.recommendations
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and runtime_recommendation_id = 'rec-action-execution-1'),
  'persisted recommendation authority survives approval, execution, and follow-up unchanged');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and action = 'persist_recommendation'
      and evidence ->> 'recommendationId' = 'rec-action-execution-1'),
  'durable recommendation persistence has audit evidence');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and actor_id = '33333333-3333-3333-3333-333333333333'
      and action = 'action_payload_approval'
      and decision = 'approved'
      and evidence ->> 'recommendationId' = 'rec-action-execution-1'
      and char_length(evidence ->> 'payloadHash') = 64),
  'exact visible payload approval is durable and payload-bound');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and actor_id = '33333333-3333-3333-3333-333333333333'
      and action = 'protected_action_execution'
      and decision = 'allowed'
      and evidence ->> 'recommendationId' = 'rec-action-execution-1'
      and evidence ->> 'resultCode' = 'CRM_NOTE_WRITTEN'),
  'approved protected execution has one durable verified result');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.activities
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and created_by_id = '33333333-3333-3333-3333-333333333333'
      and type = 'note'
      and body = 'Document the verified account facts and unresolved data-quality gaps before outreach.'),
  'protected execution produced exactly one canonical CRM activity');

select pg_temp.expect_true(
  (select count(*) = 3
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and actor_id = '33333333-3333-3333-3333-333333333333'
      and action = 'recommendation_followup'
      and evidence ->> 'recommendationId' = 'rec-action-execution-1'
      and evidence ->> 'contractVersion' = 'recommendation-followup/v1'),
  'feedback, known outcome, and explicit unknown are durable versioned follow-up evidence');

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_true(
  (select count(*) = 1
     from public.recommendations
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and runtime_recommendation_id = 'rec-action-execution-1'),
  'authorized representative can read the persisted recommendation through RLS');

select pg_temp.expect_true(
  public.get_action_payload_approval_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'Document the verified account facts and unresolved data-quality gaps before outreach.'
  ) ->> 'status' = 'approved',
  'representative reads the durable approval for the exact visible payload');

select pg_temp.expect_true(
  public.get_recommendation_followup_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1'
  ) ->> 'code' = 'unknown',
  'representative reads the deterministic latest durable follow-up state');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select pg_temp.expect_true(
  (select count(*) = 0
     from public.recommendations
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and runtime_recommendation_id = 'rec-action-execution-1'),
  'another user cannot read the representative recommendation through RLS');

reset role;

\echo 'PASSED: Acceptance A durable production-spine continuity.'
