\set ON_ERROR_STOP on
\pset pager off

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

\echo '=== Unit 1: commit re-verifies high-risk approval from item evidence ==='

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, name,
   created_by, total_rows, ready_rows)
values
  ('b0000000-0000-0000-0000-0000000000e6', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'ready_for_review', 'account',
   '30000000-0000-0000-0000-00000000000a', 'Unit 1 approval recheck',
   '11111111-1111-1111-1111-111111111111', 1, 1);

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id,
   source_row_number, row_hash, disposition, normalized_payload)
values
  ('50000000-0000-0000-0000-0000000000e6', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e6', '30000000-0000-0000-0000-00000000000a',
   'account', 'UNIT1-ACCOUNT-006', 2, repeat('6', 64), 'ready',
   '{"externalId":"UNIT1-ACCOUNT-006","name":"Reverified High Risk","ownerId":"11111111-1111-1111-1111-111111111111","tier":"strategic","lifecycleStage":"open_opportunity","openPipelineUsd":20000000}'::jsonb);

-- The summary is deliberately understated. The final commit boundary must use
-- item evidence and must not accept this summary as authority.
insert into public.change_sets
  (id, workspace_id, batch_id, new_records, pipeline_delta_usd,
   accounts_entering_top_n, accounts_leaving_top_n)
values
  ('c0000000-0000-0000-0000-0000000000e6', 'aaaaaaaa-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-0000000000e6', 1, 0, 0, 0);

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id,
   change_kind, after_values)
values
  ('c1000000-0000-0000-0000-0000000000e6', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000e6', '50000000-0000-0000-0000-0000000000e6',
   'account', 'UNIT1-ACCOUNT-006', 'create',
   '{"externalId":"UNIT1-ACCOUNT-006","name":"Reverified High Risk","ownerId":"11111111-1111-1111-1111-111111111111","tier":"strategic","lifecycleStage":"open_opportunity","openPipelineUsd":20000000}'::jsonb);

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Simulate a caller bypassing the normal approval RPC and understating the
-- second-approval requirement. Identity is real, but the risk flag is false.
insert into public.import_approvals
  (workspace_id, batch_id, approved_by, business_reason, second_approval_required)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000e6',
   '11111111-1111-1111-1111-111111111111',
   'Deliberately understated approval for the commit re-verification test.', false);

update public.ingestion_batches
   set state = 'awaiting_approval'
 where id = 'b0000000-0000-0000-0000-0000000000e6';

select pg_temp.expect_fail(
  $$select public.commit_ingestion_batch(
      'b0000000-0000-0000-0000-0000000000e6',
      'c0000000-0000-0000-0000-0000000000e6',
      (select id from public.import_approvals where batch_id = 'b0000000-0000-0000-0000-0000000000e6')
    )$$,
  'understated approval cannot bypass item-derived second-approval threshold'
);

select pg_temp.expect_true(
  (select state = 'awaiting_approval'
     from public.ingestion_batches where id = 'b0000000-0000-0000-0000-0000000000e6')
  and not exists (
    select 1 from public.import_commits where batch_id = 'b0000000-0000-0000-0000-0000000000e6'
  )
  and not exists (
    select 1 from public.external_record_links
     where source_id = 'd0000000-0000-0000-0000-00000000000a'
       and object_type = 'account'
       and external_id = 'UNIT1-ACCOUNT-006'
  ),
  're-verification failure rolls back commit state and operational writes'
);

reset role;
