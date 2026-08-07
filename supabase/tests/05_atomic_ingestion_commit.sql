\set ON_ERROR_STOP on
\pset pager off

-- Production Spine Unit 1 regression suite.
-- The preceding suites create Tenant A, two Tenant A administrators, the manual
-- CSV source, and its published mapping. This suite verifies the new server-side
-- approval/commit seam against that same workspace.

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

create or replace function pg_temp.expect_true(ok boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAIL  %', label;
  end if;
  raise notice 'PASS  %', label;
end;
$$;

-- Keep a one-record import below the 10 percent second-approval threshold. The
-- rows are ordinary operational facts and are isolated from the ids used below.
insert into public.accounts (workspace_id, name, owner_id, tier, lifecycle_stage)
select 'aaaaaaaa-0000-0000-0000-000000000001',
       'Unit 1 threshold fixture ' || n,
       '11111111-1111-1111-1111-111111111111',
       'smb',
       'prospect'
  from generate_series(1, 20) as n;

\echo '=== Unit 1: one approved account import commits atomically ==='

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, ready_rows)
values
  ('b0000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Unit 1 account import',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id,
   source_row_number, row_hash, disposition, normalized_payload, field_trust)
values
  ('50000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-ACCOUNT-001', 2, repeat('e', 64), 'ready',
   '{"externalId":"UNIT1-ACCOUNT-001","name":"Unit One Customer","ownerId":"11111111-1111-1111-1111-111111111111","tier":"enterprise","lifecycleStage":"open_opportunity","openPipelineUsd":25000}'::jsonb,
   '{"externalId":"unverified_structured","name":"unverified_structured","ownerId":"unverified_structured","tier":"unverified_structured","lifecycleStage":"unverified_structured","openPipelineUsd":"verified_structured"}'::jsonb);

insert into public.change_sets
  (id, workspace_id, batch_id, new_records, updated_records, unchanged_records,
   owner_changes, pipeline_delta_usd, accounts_entering_top_n, accounts_leaving_top_n)
values
  ('c0000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e1', 1, 0, 0, 0, 25000, 0, 0);

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id,
   change_kind, after_values)
values
  ('c1000000-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e1',
   'account', 'UNIT1-ACCOUNT-001', 'create',
   '{"externalId":"UNIT1-ACCOUNT-001","name":"Unit One Customer","ownerId":"11111111-1111-1111-1111-111111111111","tier":"enterprise","lifecycleStage":"open_opportunity","openPipelineUsd":25000}'::jsonb);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.approve_ingestion_batch(
  'b0000000-0000-0000-0000-0000000000e1',
  'Apply the reviewed Unit 1 account import.'
);

select pg_temp.expect_true(
  (select state = 'awaiting_approval'
     from public.ingestion_batches where id = 'b0000000-0000-0000-0000-0000000000e1'),
  'approval advances the batch to awaiting_approval'
);

select pg_temp.expect_true(
  (select approved_by = '11111111-1111-1111-1111-111111111111'
          and not second_approval_required
     from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e1'),
  'approval is bound to the authenticated administrator'
);

select public.commit_ingestion_batch(
  'b0000000-0000-0000-0000-0000000000e1',
  'c0000000-0000-0000-0000-0000000000e1',
  (select id from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e1')
);

select pg_temp.expect_true(
  (select state = 'committed'
     from public.ingestion_batches where id = 'b0000000-0000-0000-0000-0000000000e1'),
  'commit advances the batch to committed'
);

select pg_temp.expect_true(
  exists (
    select 1
      from public.external_record_links l
      join public.accounts a on a.id = l.internal_record_id and a.workspace_id = l.workspace_id
     where l.source_id = 'd0000000-0000-0000-0000-00000000000a'
       and l.object_type = 'account'
       and l.external_id = 'UNIT1-ACCOUNT-001'
       and a.name = 'Unit One Customer'
       and a.open_pipeline_usd = 25000
  ),
  'approved staged account becomes canonical account state with a durable external link'
);

select pg_temp.expect_true(
  (select count(*) = 1
     from public.import_commit_items i
     join public.import_commits c on c.id = i.commit_id
    where c.batch_id = 'b0000000-0000-0000-0000-0000000000e1'),
  'commit records the exact applied change-set item'
);

select pg_temp.expect_true(
  (select count(*) = 1 from public.domain_events
    where batch_id = 'b0000000-0000-0000-0000-0000000000e1'
      and event_type = 'account.created')
  and
  (select count(*) = 1 from public.domain_events
    where batch_id = 'b0000000-0000-0000-0000-0000000000e1'
      and event_type = 'manual_import.committed'),
  'operational mutation and commit boundary emit durable domain events'
);

select pg_temp.expect_true(
  exists (select 1 from public.audit_evidence
    where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and action = 'ingestion.import_commit'
      and actor_id = '11111111-1111-1111-1111-111111111111'),
  'commit creates durable actor-bound audit evidence'
);

select pg_temp.expect_fail(
  $$select public.commit_ingestion_batch(
      'b0000000-0000-0000-0000-0000000000e1',
      'c0000000-0000-0000-0000-0000000000e1',
      (select id from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e1')
    )$$,
  'replaying the same commit after the batch state advanced'
);

\echo '=== Unit 1: high-risk import cannot commit before a distinct second approval ==='

reset role;

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, ready_rows)
values
  ('b0000000-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Unit 1 high-risk import',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id,
   source_row_number, row_hash, disposition, normalized_payload)
values
  ('50000000-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e2', '30000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-ACCOUNT-002', 2, repeat('f', 64), 'ready',
   '{"externalId":"UNIT1-ACCOUNT-002","name":"Unit One Large Customer","ownerId":"11111111-1111-1111-1111-111111111111","tier":"strategic","lifecycleStage":"open_opportunity","openPipelineUsd":15000000}'::jsonb);

insert into public.change_sets
  (id, workspace_id, batch_id, new_records, pipeline_delta_usd,
   accounts_entering_top_n, accounts_leaving_top_n)
values
  ('c0000000-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e2', 1, 15000000, 0, 0);

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id,
   change_kind, after_values)
values
  ('c1000000-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000e2', '50000000-0000-0000-0000-0000000000e2',
   'account', 'UNIT1-ACCOUNT-002', 'create',
   '{"externalId":"UNIT1-ACCOUNT-002","name":"Unit One Large Customer","ownerId":"11111111-1111-1111-1111-111111111111","tier":"strategic","lifecycleStage":"open_opportunity","openPipelineUsd":15000000}'::jsonb);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.approve_ingestion_batch(
  'b0000000-0000-0000-0000-0000000000e2',
  'Apply the reviewed high-risk Unit 1 import.'
);

select pg_temp.expect_true(
  (select second_approval_required and second_approved_by is null
     from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e2'),
  'high-risk change set records a required second approval'
);

select pg_temp.expect_fail(
  $$select public.commit_ingestion_batch(
      'b0000000-0000-0000-0000-0000000000e2',
      'c0000000-0000-0000-0000-0000000000e2',
      (select id from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e2')
    )$$,
  'high-risk import before second administrator acts'
);

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select public.approve_ingestion_batch(
  'b0000000-0000-0000-0000-0000000000e2',
  'Apply the reviewed high-risk Unit 1 import.'
);

select pg_temp.expect_true(
  (select second_approved_by = '55555555-5555-5555-5555-555555555555'
     from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e2'),
  'second approval is recorded only by the second authenticated administrator'
);

select public.commit_ingestion_batch(
  'b0000000-0000-0000-0000-0000000000e2',
  'c0000000-0000-0000-0000-0000000000e2',
  (select id from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e2')
);

select pg_temp.expect_true(
  (select state = 'committed'
     from public.ingestion_batches where id = 'b0000000-0000-0000-0000-0000000000e2'),
  'high-risk import commits after both approvals are durable'
);

\echo '=== Unit 1: hard blocks refuse approval ==='

reset role;
insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, rejected_rows)
values
  ('b0000000-0000-0000-0000-0000000000e3', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Unit 1 blocked import',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.ingestion_findings
  (workspace_id, batch_id, finding_class, severity, disposition, rule_id, explanation)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000e3',
   'workspace_boundary', 'critical', 'hard_block', 'cross_workspace_reference',
   'The batch references another workspace.');

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.expect_fail(
  $$select public.approve_ingestion_batch(
      'b0000000-0000-0000-0000-0000000000e3',
      'Attempt the blocked Unit 1 import.'
    )$$,
  'hard-block finding is not convertible into an approval'
);

\echo '=== Unit 1: a failed operational write rolls the whole commit back ==='

reset role;
insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, ready_rows)
values
  ('b0000000-0000-0000-0000-0000000000e4', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Unit 1 atomic refusal import',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id,
   source_row_number, row_hash, disposition, normalized_payload)
values
  ('50000000-0000-0000-0000-0000000000e4', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e4', '30000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-ACCOUNT-004', 2, repeat('a', 64), 'ready',
   '{"externalId":"UNIT1-ACCOUNT-004","name":"Atomic Refusal","ownerId":"11111111-1111-1111-1111-111111111111","tier":"smb","lifecycleStage":"prospect","notes":"not in the operational Account contract"}'::jsonb);

insert into public.change_sets
  (id, workspace_id, batch_id, new_records, accounts_entering_top_n, accounts_leaving_top_n)
values
  ('c0000000-0000-0000-0000-0000000000e4', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e4', 1, 0, 0);

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id,
   change_kind, after_values)
values
  ('c1000000-0000-0000-0000-0000000000e4', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000e4', '50000000-0000-0000-0000-0000000000e4',
   'account', 'UNIT1-ACCOUNT-004', 'create',
   '{"externalId":"UNIT1-ACCOUNT-004","name":"Atomic Refusal","ownerId":"11111111-1111-1111-1111-111111111111","tier":"smb","lifecycleStage":"prospect","notes":"not in the operational Account contract"}'::jsonb);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.approve_ingestion_batch(
  'b0000000-0000-0000-0000-0000000000e4',
  'Verify the Unit 1 transaction refuses unsupported operational fields.'
);

select pg_temp.expect_fail(
  $$select public.commit_ingestion_batch(
      'b0000000-0000-0000-0000-0000000000e4',
      'c0000000-0000-0000-0000-0000000000e4',
      (select id from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e4')
    )$$,
  'unsupported operational field refuses the commit transaction'
);

select pg_temp.expect_true(
  (select state = 'awaiting_approval'
     from public.ingestion_batches where id = 'b0000000-0000-0000-0000-0000000000e4')
  and not exists (
    select 1 from public.import_commits where batch_id = 'b0000000-0000-0000-0000-0000000000e4'
  )
  and not exists (
    select 1 from public.external_record_links
     where source_id = 'd0000000-0000-0000-0000-00000000000a'
       and object_type = 'account'
       and external_id = 'UNIT1-ACCOUNT-004'
  ),
  'failed operational write leaves no partial commit, link, or state transition'
);

reset role;
