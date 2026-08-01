\set ON_ERROR_STOP on
\pset pager off

-- Regression tests for the six review findings on PR #24. Each one sets up the
-- exact confusion the reviewer described and asserts the database refuses it.

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

create or replace function pg_temp.expect_ok(sql text, label text)
returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'PASS  %', label;
end;
$$;

-- Two sources in ONE workspace. Every finding below is an intra-workspace
-- confusion, so the workspace boundary from Epic 0 does not help.
insert into public.data_sources (id, workspace_id, name, provider, kind, state, owner_label, created_by)
values ('d0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Tenant A second source', 'hubspot', 'native_crm', 'healthy', 'RevOps',
        '11111111-1111-1111-1111-111111111111');

-- A published mapping owned by the SECOND source.
insert into public.source_mapping_versions (id, workspace_id, source_id, version, state, created_by, published_at)
values ('30000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a2', 1, 'published',
        '11111111-1111-1111-1111-111111111111', now());

\echo '=== finding 1: a batch cannot borrow another source''s mapping ==='

select pg_temp.expect_fail(
  $$insert into public.ingestion_batches
      (workspace_id, source_id, state, object_type, mapping_version_id, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
            'draft', 'account', '30000000-0000-0000-0000-0000000000a2',
            '11111111-1111-1111-1111-111111111111')$$,
  'source A batch using source B mapping');

select pg_temp.expect_ok(
  $$insert into public.ingestion_batches
      (id, workspace_id, source_id, state, object_type, mapping_version_id, created_by, total_rows)
    values ('b0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
            'd0000000-0000-0000-0000-00000000000a', 'draft', 'account',
            '30000000-0000-0000-0000-00000000000a',
            '11111111-1111-1111-1111-111111111111', 1)$$,
  'a batch using its own source''s mapping');

-- The same confusion one level down: a staged row must be read through its
-- batch's mapping.
select pg_temp.expect_fail(
  $$insert into public.staged_records
      (workspace_id, batch_id, mapping_version_id, object_type, external_id, row_hash, disposition)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            '30000000-0000-0000-0000-0000000000a2', 'account', 'EXT-X', repeat('d', 64), 'ready')$$,
  'staged record read through a foreign mapping');

\echo '=== finding 4: hard blocks are derived from the rule ==='

select pg_temp.expect_fail(
  $$insert into public.ingestion_findings
      (workspace_id, batch_id, finding_class, severity, disposition, rule_id, explanation)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            'malware', 'critical', 'open', 'malware_detected', 'Scan flagged the upload.')$$,
  'filing a hard-block rule as an ordinary open finding');

select pg_temp.expect_fail(
  $$insert into public.ingestion_findings
      (workspace_id, batch_id, finding_class, severity, disposition, rule_id, explanation,
       reviewed_by, resolution_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            'workspace_boundary', 'critical', 'ignored_with_reason', 'cross_workspace_reference',
            'Parent in another tenant.', '11111111-1111-1111-1111-111111111111', 'seems fine')$$,
  'inserting a hard-block rule already resolved');

select pg_temp.expect_ok(
  $$insert into public.ingestion_findings
      (workspace_id, batch_id, finding_class, severity, disposition, rule_id, explanation)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            'malware', 'critical', 'hard_block', 'malware_detected', 'Scan flagged the upload.')$$,
  'a hard-block rule filed as a hard block');

\echo '=== finding 2: approvals name the person who acted ==='

-- Not an admin of this workspace: the manager is a member, the tenant B admin
-- is not a member at all. Run inside a session so these fail on membership
-- rather than on the missing subject.
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c',
            '22222222-2222-2222-2222-222222222222', 'Approving as a manager')$$,
  'a manager recorded as an import approver');

select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c',
            '44444444-4444-4444-4444-444444444444', 'Approving from another tenant')$$,
  'a non-member recorded as an import approver');

select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason, second_approval_required,
       second_approved_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c',
            '11111111-1111-1111-1111-111111111111', 'Bulk update', true,
            '22222222-2222-2222-2222-222222222222')$$,
  'a manager named as the second approver');

-- The approver must be the requester, and the second signature cannot be
-- claimed on someone else's behalf.
select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            '55555555-5555-5555-5555-555555555555', 'Approving as somebody else')$$,
  'one admin recording an approval under another admin''s name');

select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason, second_approval_required,
       second_approved_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            '11111111-1111-1111-1111-111111111111', 'Bulk update', true,
            '55555555-5555-5555-5555-555555555555')$$,
  'one admin claiming both signatures at once');

select pg_temp.expect_ok(
  $$insert into public.import_approvals
      (id, workspace_id, batch_id, approved_by, business_reason, second_approval_required)
    values ('a0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
            'Bulk update', true)$$,
  'the first admin recording their own approval');

select pg_temp.expect_fail(
  $$update public.import_approvals
       set second_approved_by = '55555555-5555-5555-5555-555555555555'
     where id = 'a0000000-0000-0000-0000-0000000000d1'$$,
  'the first admin signing for the second');

reset role;
set role authenticated;
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select pg_temp.expect_ok(
  $$update public.import_approvals
       set second_approved_by = '55555555-5555-5555-5555-555555555555'
     where id = 'a0000000-0000-0000-0000-0000000000d1'$$,
  'the second admin recording their own approval');

select pg_temp.expect_fail(
  $$update public.import_approvals set business_reason = 'something else'
     where id = 'a0000000-0000-0000-0000-0000000000d1'$$,
  'editing an approval under cover of the second-approver update');

reset role;

select pg_temp.expect_fail(
  $$update public.import_approvals
       set second_approved_by = '11111111-1111-1111-1111-111111111111'
     where id = 'a0000000-0000-0000-0000-0000000000d1'$$,
  'replacing a recorded second approver');

\echo '=== finding 3: a commit''s inputs all name the same batch ==='

insert into public.change_sets
  (id, workspace_id, batch_id, new_records,
   accounts_entering_top_n, accounts_leaving_top_n)
values ('c0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-0000000000d1', 1, 0, 0);

-- Approval a...000a belongs to batch b...000c; change set c...00d1 belongs to
-- batch b...00d1. Neither pairing may be crossed.
select pg_temp.expect_fail(
  $$insert into public.import_commits
      (workspace_id, batch_id, change_set_id, approval_id, committed_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            'c0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-00000000000a',
            '11111111-1111-1111-1111-111111111111')$$,
  'a commit citing another batch''s approval');

select pg_temp.expect_fail(
  $$insert into public.import_commits
      (workspace_id, batch_id, change_set_id, approval_id, committed_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            'c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d1',
            '11111111-1111-1111-1111-111111111111')$$,
  'a commit citing another batch''s change set');

select pg_temp.expect_ok(
  $$insert into public.import_commits
      (id, workspace_id, batch_id, change_set_id, approval_id, committed_by, records_created)
    values ('e0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000d1',
            'a0000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', 1)$$,
  'a commit whose batch, change set and approval agree');

\echo '=== finding 5: commit items name a previewed change ==='

insert into public.staged_records
  (id, workspace_id, batch_id, mapping_version_id, object_type, external_id, row_hash, disposition)
values ('50000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-00000000000a',
        'account', 'EXT-D1', repeat('e', 64), 'ready');

insert into public.change_set_items
  (id, workspace_id, change_set_id, staged_record_id, object_type, external_id, change_kind)
values ('c1000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000d1',
        'account', 'EXT-D1', 'create');

select pg_temp.expect_fail(
  $$insert into public.import_commit_items
      (workspace_id, commit_id, change_set_id, change_set_item_id, object_type,
       internal_record_id, change_kind)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000d1',
            'c0000000-0000-0000-0000-0000000000d1', gen_random_uuid(), 'account',
            gen_random_uuid(), 'create')$$,
  'a commit item citing a change-set item that does not exist');

select pg_temp.expect_fail(
  $$insert into public.import_commit_items
      (workspace_id, commit_id, change_set_id, change_set_item_id, object_type,
       internal_record_id, change_kind)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000d1',
            'c0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-0000000000d1',
            'account', gen_random_uuid(), 'create')$$,
  'a commit item citing another commit''s change set');

select pg_temp.expect_ok(
  $$insert into public.import_commit_items
      (workspace_id, commit_id, change_set_id, change_set_item_id, object_type,
       internal_record_id, change_kind)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000d1',
            'c0000000-0000-0000-0000-0000000000d1', 'c1000000-0000-0000-0000-0000000000d1',
            'account', gen_random_uuid(), 'create')$$,
  'a commit item naming the change it applied');

\echo '=== finding 6: an execution''s version belongs to its trigger ==='

insert into public.trigger_definitions (id, workspace_id, name, state, created_by)
values ('70000000-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Second trigger', 'draft', '11111111-1111-1111-1111-111111111111');

select pg_temp.expect_fail(
  $$insert into public.trigger_executions
      (workspace_id, trigger_id, trigger_version_id, domain_event_id, state, correlation_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000d2',
            '71000000-0000-0000-0000-00000000000a', '11110000-0000-0000-0000-00000000000a',
            'pending', gen_random_uuid())$$,
  'an execution citing another trigger''s version');

\echo '=== hardening: an approval needs an authenticated person ==='

reset role;

select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000d1',
            '11111111-1111-1111-1111-111111111111', 'Service role forging an approval')$$,
  'a connection with no authenticated subject recording an approval');

select pg_temp.expect_fail(
  $$update public.import_approvals
       set second_approved_by = '11111111-1111-1111-1111-111111111111'
     where id = 'a0000000-0000-0000-0000-0000000000d1'$$,
  'a connection with no authenticated subject adding a second approval');
