\set ON_ERROR_STOP on
\pset pager off

-- Regression coverage for migration 0024. Phase 6 follow-up is append-only audit
-- evidence tied to the current representative, recommendation, run, account and
-- workspace. It must be idempotent for exact retries, reject stale updates, and
-- never mutate protected recommendation authority.

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
  has_function_privilege(
    'authenticated',
    'public.get_recommendation_followup_state(uuid,text)',
    'EXECUTE'
  ),
  'authenticated representatives can read their bounded follow-up state');

select pg_temp.expect_true(
  has_function_privilege(
    'authenticated',
    'public.record_recommendation_followup(uuid,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated representatives can record bounded follow-up through the RPC only');

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_true(
  public.get_recommendation_followup_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1'
  ) ->> 'status' = 'none',
  'follow-up state starts explicit and empty');

select pg_temp.expect_true(
  public.record_recommendation_followup(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'feedback',
    'accepted',
    null
  ) ->> 'replayed' = 'false',
  'representative can durably record bounded recommendation feedback');

select pg_temp.expect_true(
  public.record_recommendation_followup(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'feedback',
    'accepted',
    null
  ) ->> 'replayed' = 'true',
  'exact retry replays the prior durable event instead of duplicating it');

select pg_temp.expect_true(
  public.get_recommendation_followup_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1'
  ) ->> 'code' = 'accepted',
  'read-back returns the durable feedback event');

select pg_temp.expect_fail(
  $$select public.record_recommendation_followup(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1',
      'outcome',
      'meeting_booked',
      null
    )$$,
  'stale client state cannot overwrite a newer follow-up event');

select pg_temp.expect_true(
  public.record_recommendation_followup(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'outcome',
    'meeting_booked',
    (public.get_recommendation_followup_state(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1'
    ) ->> 'eventId')::uuid
  ) ->> 'code' = 'meeting_booked',
  'representative can durably record a bounded known outcome after current-state confirmation');

select pg_temp.expect_true(
  public.get_recommendation_followup_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1'
  ) ->> 'kind' = 'outcome',
  'latest-state retrieval deterministically selects the newest follow-up event');

select pg_temp.expect_true(
  public.record_recommendation_followup(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1',
    'unknown',
    'unknown',
    (public.get_recommendation_followup_state(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1'
    ) ->> 'eventId')::uuid
  ) ->> 'kind' = 'unknown',
  'representative can explicitly record that the outcome is not known');

select pg_temp.expect_true(
  public.get_recommendation_followup_state(
    'aaaaaaaa-0000-0000-0000-000000000001',
    'rec-action-execution-1'
  ) ->> 'code' = 'unknown',
  'explicit unknown is durable and becomes the deterministic latest state');

select pg_temp.expect_fail(
  $$select public.record_recommendation_followup(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1',
      'outcome',
      'made_up_outcome',
      null
    )$$,
  'outcome vocabulary fails closed at the database boundary');

reset role;

select pg_temp.expect_true(
  (select count(*) = 3
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and actor_id = '33333333-3333-3333-3333-333333333333'
      and action = 'recommendation_followup'
      and evidence ->> 'recommendationId' = 'rec-action-execution-1'),
  'feedback, known outcome and explicit unknown are three append-only durable events');

select pg_temp.expect_true(
  (select bool_and(
      char_length(evidence ->> 'idempotencyKey') = 64
      and evidence ->> 'contractVersion' = 'recommendation-followup/v1'
      and evidence ->> 'provenance' = 'authenticated_representative'
      and not (evidence ? 'content')
      and not (evidence ? 'draft')
    )
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and actor_id = '33333333-3333-3333-3333-333333333333'
      and action = 'recommendation_followup'),
  'follow-up audit evidence carries contract version and deterministic provenance without raw action payload duplication');

select pg_temp.expect_true(
  (select score = 78
      and rank = 1
      and reason_codes = array['data_quality_blocked']::text[]
      and next_best_action ->> 'type' = 'log_research_note'
      and approval_status = 'approved'::public.approval_status
      and published = true
     from public.recommendations
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and runtime_recommendation_id = 'rec-action-execution-1'),
  'follow-up capture does not mutate protected recommendation authority fields');

set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.record_recommendation_followup(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1',
      'feedback',
      'rejected',
      null
    )$$,
  'another user cannot write follow-up for the representative recommendation');

reset role;

update public.accounts
   set owner_id = '44444444-4444-4444-4444-444444444444'
 where id = 'c2000000-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.get_recommendation_followup_state(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1'
    )$$,
  'former owner immediately loses follow-up read authority after reassignment');

select pg_temp.expect_fail(
  $$select public.record_recommendation_followup(
      'aaaaaaaa-0000-0000-0000-000000000001',
      'rec-action-execution-1',
      'feedback',
      'edited',
      null
    )$$,
  'former owner immediately loses follow-up write authority after reassignment');

reset role;

update public.accounts
   set owner_id = '33333333-3333-3333-3333-333333333333'
 where id = 'c2000000-0000-0000-0000-000000000001';
