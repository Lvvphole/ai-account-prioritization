\set ON_ERROR_STOP on
\pset pager off

-- Regression tests for the PR #47 review findings that require the approved
-- preview to remain the committed preview and require update targets to remain
-- both identity-correct and fresh.

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

-- Keep each one-record fixture below the 10 percent second-approval threshold.
insert into public.accounts (workspace_id, name, owner_id, tier, lifecycle_stage)
select 'aaaaaaaa-0000-0000-0000-000000000001',
       'Review freshness threshold fixture ' || n,
       '11111111-1111-1111-1111-111111111111',
       'smb',
       'prospect'
  from generate_series(1, 20) as n;

\echo '=== review binding: approval is tied to the exact reviewed snapshot ==='

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, ready_rows)
values
  ('b4700000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Review binding fixture',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id,
   source_row_number, row_hash, disposition, normalized_payload)
values
  ('54700000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b4700000-0000-4000-8000-000000000001', '30000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-REVIEW-001', 2, repeat('a', 64), 'ready',
   '{"externalId":"UNIT1-REVIEW-001","name":"Bound Review Customer","ownerId":"11111111-1111-1111-1111-111111111111","tier":"enterprise","lifecycleStage":"prospect","openPipelineUsd":100}'::jsonb);

insert into public.change_sets
  (id, workspace_id, batch_id, new_records, pipeline_delta_usd,
   accounts_entering_top_n, accounts_leaving_top_n)
values
  ('c4700000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b4700000-0000-4000-8000-000000000001', 1, 100, 0, 0);

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id,
   change_kind, after_values)
values
  ('d4700000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c4700000-0000-4000-8000-000000000001', '54700000-0000-4000-8000-000000000001',
   'account', 'UNIT1-REVIEW-001', 'create',
   '{"externalId":"UNIT1-REVIEW-001","name":"Bound Review Customer","ownerId":"11111111-1111-1111-1111-111111111111","tier":"enterprise","lifecycleStage":"prospect","openPipelineUsd":100}'::jsonb);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.approve_ingestion_batch(
  'b4700000-0000-4000-8000-000000000001',
  'Approve the exact reviewed snapshot for binding verification.'
);

select pg_temp.expect_true(
  (select review_change_set_id = 'c4700000-0000-4000-8000-000000000001'
          and review_snapshot_hash ~ '^[a-f0-9]{64}$'
     from public.import_approvals
    where batch_id = 'b4700000-0000-4000-8000-000000000001'),
  'approval stores a deterministic binding to the reviewed change set'
);

reset role;
update public.change_sets
   set concentration_notes = 'tampered after approval'
 where id = 'c4700000-0000-4000-8000-000000000001';

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.expect_fail(
  $$select public.commit_ingestion_batch(
      'b4700000-0000-4000-8000-000000000001',
      'c4700000-0000-4000-8000-000000000001',
      (select id from public.import_approvals where batch_id = 'b4700000-0000-4000-8000-000000000001')
    )$$,
  'commit after the approved review snapshot changes'
);

select pg_temp.expect_true(
  not exists (select 1 from public.import_commits where batch_id = 'b4700000-0000-4000-8000-000000000001'),
  'snapshot mismatch leaves no commit record'
);

\echo '=== target binding: update must still resolve to the previewed external identity ==='

reset role;
insert into public.accounts
  (id, workspace_id, name, owner_id, tier, lifecycle_stage, open_pipeline_usd)
values
  ('74700000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Previewed target', '11111111-1111-1111-1111-111111111111', 'enterprise', 'open_opportunity', 100),
  ('74700000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Wrong remapped target', '11111111-1111-1111-1111-111111111111', 'enterprise', 'open_opportunity', 999);

insert into public.external_record_links
  (workspace_id, source_id, object_type, external_id, internal_record_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-UPDATE-002', '74700000-0000-4000-8000-000000000002');

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, ready_rows)
values
  ('b4700000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Target binding fixture',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id,
   source_row_number, row_hash, disposition, normalized_payload)
values
  ('54700000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b4700000-0000-4000-8000-000000000002', '30000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-UPDATE-002', 2, repeat('b', 64), 'ready',
   '{"externalId":"UNIT1-UPDATE-002","openPipelineUsd":200}'::jsonb);

insert into public.change_sets
  (id, workspace_id, batch_id, updated_records, pipeline_delta_usd,
   accounts_entering_top_n, accounts_leaving_top_n)
values
  ('c4700000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b4700000-0000-4000-8000-000000000002', 1, 100, 0, 0);

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id,
   target_record_id, change_kind, before_values, after_values)
values
  ('d4700000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c4700000-0000-4000-8000-000000000002', '54700000-0000-4000-8000-000000000002',
   'account', 'UNIT1-UPDATE-002', '74700000-0000-4000-8000-000000000002', 'update',
   '{"openPipelineUsd":100}'::jsonb, '{"openPipelineUsd":200}'::jsonb);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.approve_ingestion_batch(
  'b4700000-0000-4000-8000-000000000002',
  'Approve the previewed external identity target for update verification.'
);

reset role;
update public.external_record_links
   set internal_record_id = '74700000-0000-4000-8000-000000000004'
 where source_id = 'd0000000-0000-0000-0000-00000000000a'
   and object_type = 'account'
   and external_id = 'UNIT1-UPDATE-002';

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.expect_fail(
  $$select public.commit_ingestion_batch(
      'b4700000-0000-4000-8000-000000000002',
      'c4700000-0000-4000-8000-000000000002',
      (select id from public.import_approvals where batch_id = 'b4700000-0000-4000-8000-000000000002')
    )$$,
  'update after its external identity is remapped to another record'
);

select pg_temp.expect_true(
  (select open_pipeline_usd = 100 from public.accounts where id = '74700000-0000-4000-8000-000000000002')
  and
  (select open_pipeline_usd = 999 from public.accounts where id = '74700000-0000-4000-8000-000000000004'),
  'identity mismatch leaves both canonical records unchanged'
);

\echo '=== before-state freshness: later canonical edits are never overwritten ==='

reset role;
insert into public.accounts
  (id, workspace_id, name, owner_id, tier, lifecycle_stage, open_pipeline_usd)
values
  ('74700000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Freshness target', '11111111-1111-1111-1111-111111111111', 'enterprise', 'open_opportunity', 100);

insert into public.external_record_links
  (workspace_id, source_id, object_type, external_id, internal_record_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-UPDATE-003', '74700000-0000-4000-8000-000000000003');

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, ready_rows)
values
  ('b4700000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Before-state freshness fixture',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id,
   source_row_number, row_hash, disposition, normalized_payload)
values
  ('54700000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b4700000-0000-4000-8000-000000000003', '30000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-UPDATE-003', 2, repeat('c', 64), 'ready',
   '{"externalId":"UNIT1-UPDATE-003","openPipelineUsd":200}'::jsonb);

insert into public.change_sets
  (id, workspace_id, batch_id, updated_records, pipeline_delta_usd,
   accounts_entering_top_n, accounts_leaving_top_n)
values
  ('c4700000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b4700000-0000-4000-8000-000000000003', 1, 100, 0, 0);

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id,
   target_record_id, change_kind, before_values, after_values)
values
  ('d4700000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c4700000-0000-4000-8000-000000000003', '54700000-0000-4000-8000-000000000003',
   'account', 'UNIT1-UPDATE-003', '74700000-0000-4000-8000-000000000003', 'update',
   '{"openPipelineUsd":100}'::jsonb, '{"openPipelineUsd":200}'::jsonb);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.approve_ingestion_batch(
  'b4700000-0000-4000-8000-000000000003',
  'Approve the previewed before-state for stale update verification.'
);

reset role;
update public.accounts
   set open_pipeline_usd = 150
 where id = '74700000-0000-4000-8000-000000000003';

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.expect_fail(
  $$select public.commit_ingestion_batch(
      'b4700000-0000-4000-8000-000000000003',
      'c4700000-0000-4000-8000-000000000003',
      (select id from public.import_approvals where batch_id = 'b4700000-0000-4000-8000-000000000003')
    )$$,
  'update after the canonical row changes from the previewed before-state'
);

select pg_temp.expect_true(
  (select open_pipeline_usd = 150 from public.accounts where id = '74700000-0000-4000-8000-000000000003'),
  'stale preview refusal preserves the later canonical edit'
);

reset role;
