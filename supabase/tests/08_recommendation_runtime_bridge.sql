\set ON_ERROR_STOP on
\pset pager off

-- Regression coverage for migration 0020. The earlier migration tests seed two
-- workspaces and users. This test adds only the canonical accounts needed for
-- the runtime publication boundary.

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

create or replace function pg_temp.recommendation(
  runtime_id text,
  account_id uuid,
  owner_id uuid,
  run_id text,
  rank_value integer,
  score_value numeric
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', runtime_id,
    'runId', run_id,
    'accountId', account_id::text,
    'ownerId', owner_id::text,
    'score', score_value,
    'rank', rank_value,
    'confidence', 0.9,
    'reasonCodes', jsonb_build_array('strategic_tier_account'),
    'reasonNarrative', 'Verified deterministic recommendation.',
    'nextBestAction', jsonb_build_object(
      'type', 'no_action_hold',
      'customerFacing', false,
      'crmWriteBack', false,
      'objective', 'Hold until the next verified signal.'
    ),
    'sourceSignals', jsonb_build_array(jsonb_build_object(
      'kind', 'account',
      'refId', account_id::text,
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
      'checkedAt', '2026-08-07T10:00:00.000Z'
    ),
    'approvalStatus', 'not_required',
    'published', true,
    'createdAt', '2026-08-07T10:00:00.000Z'
  );
$$;

insert into public.accounts (
  id, workspace_id, name, owner_id, tier, lifecycle_stage, open_pipeline_usd,
  intent_signals, data_quality_flags
) values
  ('c2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Runtime Bridge A', '33333333-3333-3333-3333-333333333333', 'strategic',
   'open_opportunity', 100000, array[]::text[], array[]::text[]),
  ('c2000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Runtime Bridge B', '33333333-3333-3333-3333-333333333333', 'strategic',
   'open_opportunity', 50000, array[]::text[], array[]::text[])
on conflict (id) do nothing;

\echo '=== durable verified publication ==='

select pg_temp.expect_true(
  public.persist_published_recommendations(jsonb_build_array(
    pg_temp.recommendation(
      'rec-bridge-1',
      'c2000000-0000-0000-0000-000000000001',
      '33333333-3333-3333-3333-333333333333',
      'run-bridge-1', 1, 70
    )
  )) = 1,
  'verified published recommendation persists');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.recommendations
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and runtime_recommendation_id = 'rec-bridge-1'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and owner_id = '33333333-3333-3333-3333-333333333333'
      and run_id = 'run-bridge-1'
      and score = 70
      and rank = 1
      and published = true
      and verification ->> 'status' = 'passed'),
  'persisted row preserves authority fields and canonical workspace');

select pg_temp.expect_true(
  (select count(*) = 1
     from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'
      and action = 'persist_recommendation'
      and evidence ->> 'recommendationId' = 'rec-bridge-1'),
  'successful persistence creates workspace-bound audit evidence');

\echo '=== replay idempotency ==='

select pg_temp.expect_true(
  public.persist_published_recommendations(jsonb_build_array(
    pg_temp.recommendation(
      'rec-bridge-1',
      'c2000000-0000-0000-0000-000000000001',
      '33333333-3333-3333-3333-333333333333',
      'run-bridge-1', 1, 70
    )
  )) = 1,
  'exact replay succeeds');

select pg_temp.expect_true(
  (select count(*) = 1 from public.recommendations
    where runtime_recommendation_id = 'rec-bridge-1'),
  'exact replay does not duplicate recommendation');

select pg_temp.expect_true(
  (select count(*) = 1 from public.audit_evidence
    where action = 'persist_recommendation'
      and evidence ->> 'recommendationId' = 'rec-bridge-1'),
  'exact replay does not duplicate persistence audit');

select pg_temp.expect_fail(
  $$select public.persist_published_recommendations(jsonb_build_array(
      pg_temp.recommendation(
        'rec-bridge-1',
        'c2000000-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333',
        'run-bridge-1', 1, 71
      )
    ))$$,
  'divergent replay with the same runtime id');

select pg_temp.expect_true(
  (select score = 70 from public.recommendations
    where runtime_recommendation_id = 'rec-bridge-1'),
  'divergent replay leaves original row unchanged');

\echo '=== authority and verification fail closed ==='

select pg_temp.expect_fail(
  $$select public.persist_published_recommendations(jsonb_build_array(
      pg_temp.recommendation(
        'rec-owner-mismatch',
        'c2000000-0000-0000-0000-000000000001',
        '44444444-4444-4444-4444-444444444444',
        'run-owner-mismatch', 1, 60
      )
    ))$$,
  'owner that differs from canonical account owner');

select pg_temp.expect_fail(
  $$select public.persist_published_recommendations(jsonb_build_array(
      jsonb_set(
        pg_temp.recommendation(
          'rec-unverified',
          'c2000000-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333',
          'run-unverified', 1, 60
        ),
        '{verification,status}', '"failed"'::jsonb, false
      )
    ))$$,
  'recommendation that did not pass verification');

select pg_temp.expect_fail(
  $$select public.persist_published_recommendations(jsonb_build_array(
      pg_temp.recommendation(
        'rec-cross-a',
        'c2000000-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333',
        'run-cross-workspace', 1, 80
      ),
      pg_temp.recommendation(
        'rec-cross-b',
        'c2000000-0000-0000-0000-000000000002',
        '33333333-3333-3333-3333-333333333333',
        'run-cross-workspace', 2, 70
      )
    ))$$,
  'one ranked set spanning two workspaces');

select pg_temp.expect_true(
  (select count(*) = 0 from public.recommendations
    where runtime_recommendation_id in ('rec-cross-a', 'rec-cross-b')),
  'cross-workspace failure rolls back partial persistence');

\echo '=== runtime audit workspace binding ==='

select pg_temp.expect_true(
  public.append_runtime_audit_evidence(jsonb_build_object(
    'runId', 'run-audit-bridge',
    'accountId', 'c2000000-0000-0000-0000-000000000001',
    'actorId', 'orchestrator',
    'action', 'runtime_bridge_test',
    'decision', 'allowed',
    'reason', 'Test workspace derivation.',
    'evidence', '{}'::jsonb,
    'occurredAt', '2026-08-07T10:00:00.000Z'
  )) is not null,
  'runtime audit RPC writes a durable row');

select pg_temp.expect_true(
  (select count(*) = 1 from public.audit_evidence
    where run_id = 'run-audit-bridge'
      and workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and account_id = 'c2000000-0000-0000-0000-000000000001'),
  'runtime audit derives workspace from canonical account');

\echo '=== service-only write boundary and RLS read boundary ==='

set role authenticated;
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.expect_fail(
  $$select public.persist_published_recommendations('[]'::jsonb)$$,
  'authenticated user cannot execute recommendation persistence RPC');

select pg_temp.expect_true(
  (select count(*) = 1 from public.recommendations
    where runtime_recommendation_id = 'rec-bridge-1'),
  'owning representative can read persisted recommendation through RLS');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select pg_temp.expect_true(
  (select count(*) = 0 from public.recommendations
    where runtime_recommendation_id = 'rec-bridge-1'),
  'other workspace cannot read persisted recommendation');

reset role;
