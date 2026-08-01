\set ON_ERROR_STOP on
\pset pager off

-- Behavioural verification of migrations 0009 to 0013.
-- Every check either prints PASS or aborts the script.

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

-- ---------------------------------------------------------------- seed --

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'manager-a@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'rep-a@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'admin-b@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'admin2-a@example.com');

update public.profiles set role = 'admin'   where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set role = 'manager' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set role = 'rep'     where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set role = 'admin'   where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set role = 'admin'   where id = '55555555-5555-5555-5555-555555555555';

insert into public.workspaces (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Tenant A', 'tenant-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b');

insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'manager'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'rep'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'admin'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'admin');

insert into public.data_sources (id, workspace_id, name, provider, kind, state, owner_label, created_by)
values
  ('d0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Tenant A CSV', 'manual_csv', 'csv', 'healthy', 'RevOps', '11111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Tenant B CSV', 'manual_csv', 'csv', 'healthy', 'RevOps', '44444444-4444-4444-4444-444444444444');

insert into public.source_mapping_versions (id, workspace_id, source_id, version, state, created_by, published_at)
values ('30000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-00000000000a', 1, 'published',
        '11111111-1111-1111-1111-111111111111', now());

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, created_by, total_rows)
values ('b0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-00000000000a', 'draft', 'account',
        '30000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 3);

\echo '=== 1. ingestion state machine ==='

select pg_temp.expect_ok(
  $$update public.ingestion_batches set state = 'awaiting_upload'
     where id = 'b0000000-0000-0000-0000-00000000000a'$$,
  'draft -> awaiting_upload');

select pg_temp.expect_fail(
  $$update public.ingestion_batches set state = 'committed'
     where id = 'b0000000-0000-0000-0000-00000000000a'$$,
  'awaiting_upload -> committed skips approval');

select pg_temp.expect_fail(
  $$update public.ingestion_batches set state = 'draft'
     where id = 'b0000000-0000-0000-0000-00000000000a'$$,
  'awaiting_upload -> draft moves backwards');

-- Walk the happy path to `ready_for_review`.
update public.ingestion_batches set state = 'received'          where id = 'b0000000-0000-0000-0000-00000000000a';
update public.ingestion_batches set state = 'security_scanning' where id = 'b0000000-0000-0000-0000-00000000000a';
update public.ingestion_batches set state = 'parsing'           where id = 'b0000000-0000-0000-0000-00000000000a';
update public.ingestion_batches set state = 'mapping'           where id = 'b0000000-0000-0000-0000-00000000000a';
update public.ingestion_batches set state = 'validating'        where id = 'b0000000-0000-0000-0000-00000000000a';
update public.ingestion_batches set state = 'ready_for_review'  where id = 'b0000000-0000-0000-0000-00000000000a';
\echo 'PASS  full happy path to ready_for_review'

select pg_temp.expect_ok(
  $$update public.ingestion_batches set state = 'cancelled'
     where id = 'b0000000-0000-0000-0000-00000000000a'$$,
  'any in-flight state -> cancelled');

select pg_temp.expect_fail(
  $$update public.ingestion_batches set state = 'committing'
     where id = 'b0000000-0000-0000-0000-00000000000a'$$,
  'cancelled is terminal');

\echo '=== 2. counters cannot exceed the rows received ==='

select pg_temp.expect_fail(
  $$insert into public.ingestion_batches
      (workspace_id, source_id, state, created_by, total_rows, ready_rows)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
            'draft', '11111111-1111-1111-1111-111111111111', 2, 5)$$,
  'ready_rows above total_rows');

\echo '=== 3. workspace boundary ==='

select pg_temp.expect_fail(
  $$insert into public.ingestion_batches (workspace_id, source_id, state, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000b',
            'draft', '11111111-1111-1111-1111-111111111111')$$,
  'batch adopting another tenant''s source');

select pg_temp.expect_fail(
  $$insert into public.source_scopes (workspace_id, source_id, scope, access, business_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
            'crm.write', 'write', 'needed for sync')$$,
  'write scope on a v1 source');

\echo '=== 4. field mappings ==='

select pg_temp.expect_fail(
  $$insert into public.source_field_mappings
      (workspace_id, mapping_version_id, object_type, source_field, disposition)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a',
            'account', 'Acct Name', 'mapped')$$,
  'mapped field with no canonical target');

select pg_temp.expect_fail(
  $$insert into public.source_field_mappings
      (workspace_id, mapping_version_id, object_type, source_field, canonical_field, disposition)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a',
            'account', 'Notes', 'name', 'explicitly_ignored')$$,
  'ignored field naming a canonical target');

\echo '=== 5. quarantine hard blocks ==='

insert into public.ingestion_findings
  (id, workspace_id, batch_id, finding_class, severity, disposition, rule_id, explanation)
values ('f0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-00000000000a', 'malware', 'critical', 'hard_block',
        'malware_detected', 'Uploaded file failed the malware scan.');

select pg_temp.expect_fail(
  $$update public.ingestion_findings
       set disposition = 'ignored_with_reason',
           reviewed_by = '11111111-1111-1111-1111-111111111111',
           resolution_reason = 'looks fine to me'
     where id = 'f0000000-0000-0000-0000-00000000000a'$$,
  'resolving a hard block');

select pg_temp.expect_fail(
  $$insert into public.ingestion_findings
      (workspace_id, batch_id, finding_class, severity, disposition, rule_id, explanation)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
            'schema', 'warning', 'ignored_with_reason', 'unknown_field', 'Extra column.')$$,
  'resolving a finding with no reviewer or reason');

\echo '=== 6. approvals and commits ==='

insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, created_by, total_rows, ready_rows)
values ('b0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-00000000000a', 'draft', 'account',
        '30000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 2, 2);

-- An approval requires an authenticated person, so these run as one.
select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c',
            '11111111-1111-1111-1111-111111111111', 'Approving with no session')$$,
  'an unauthenticated connection recording an approval');

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- An incomplete approval is storable; committing against it is not.
insert into public.import_approvals
  (id, workspace_id, batch_id, approved_by, business_reason, second_approval_required)
values ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
        'Quarterly refresh', true);

reset role;

insert into public.change_sets
  (id, workspace_id, batch_id, new_records,
   accounts_entering_top_n, accounts_leaving_top_n)
values ('c0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-00000000000c', 1, 0, 0);

select pg_temp.expect_fail(
  $$insert into public.import_commits
      (workspace_id, batch_id, change_set_id, approval_id, committed_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c',
            'c0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1',
            '11111111-1111-1111-1111-111111111111')$$,
  'committing against an approval awaiting its second approver');

select pg_temp.expect_fail(
  $$insert into public.import_approvals
      (workspace_id, batch_id, approved_by, business_reason, second_approval_required, second_approved_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c',
            '11111111-1111-1111-1111-111111111111', 'Quarterly refresh', true,
            '11111111-1111-1111-1111-111111111111')$$,
  'one person approving twice');

set role authenticated;
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
update public.import_approvals
   set second_approved_by = '55555555-5555-5555-5555-555555555555'
 where id = 'a0000000-0000-0000-0000-0000000000f1';
reset role;
\echo 'PASS  two distinct approvers accepted'

insert into public.import_commits
  (id, workspace_id, batch_id, change_set_id, approval_id, committed_by, records_created)
values ('e0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000000f1',
        'a0000000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111', 2);

select pg_temp.expect_fail(
  $$update public.import_commits set records_created = 99
     where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'editing a commit');

select pg_temp.expect_fail(
  $$delete from public.import_commits where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'deleting a commit');

select pg_temp.expect_fail(
  $$update public.import_approvals set business_reason = 'changed my mind'
     where id = 'a0000000-0000-0000-0000-0000000000f1'$$,
  'editing an approval');

\echo '=== 7. external record links ==='

insert into public.external_record_links
  (workspace_id, source_id, object_type, external_id, internal_record_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
        'account', 'EXT-1', gen_random_uuid());

select pg_temp.expect_fail(
  $$insert into public.external_record_links
      (workspace_id, source_id, object_type, external_id, internal_record_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
            'account', 'EXT-1', gen_random_uuid())$$,
  'one external id forking into two internal records');

\echo '=== 8. domain events ==='

insert into public.domain_events
  (id, workspace_id, source_id, event_type, object_type, object_id, external_event_id,
   occurred_at, payload_hash)
values ('11110000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-00000000000a', 'opportunity.stage_changed', 'opportunity',
        gen_random_uuid(), 'EVT-1', now(), repeat('a', 64));

select pg_temp.expect_fail(
  $$insert into public.domain_events
      (workspace_id, source_id, event_type, object_type, object_id, external_event_id,
       occurred_at, payload_hash)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a',
            'opportunity.stage_changed', 'opportunity', gen_random_uuid(), 'EVT-1',
            now(), repeat('b', 64))$$,
  'redelivering the same source event id');

select pg_temp.expect_ok(
  $$update public.domain_events set state = 'processing', attempt_count = 1
     where id = '11110000-0000-0000-0000-00000000000a'$$,
  'advancing event processing state');

select pg_temp.expect_fail(
  $$update public.domain_events set payload = '{"amount": 1}'::jsonb
     where id = '11110000-0000-0000-0000-00000000000a'$$,
  'rewriting an event payload');

select pg_temp.expect_fail(
  $$delete from public.domain_events where id = '11110000-0000-0000-0000-00000000000a'$$,
  'deleting an event');

\echo '=== 9. triggers ==='

insert into public.trigger_definitions (id, workspace_id, name, state, created_by)
values ('70000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Escalate large negotiations', 'draft', '11111111-1111-1111-1111-111111111111');

insert into public.trigger_versions
  (id, workspace_id, trigger_id, version, event_type, debounce_seconds, cooldown_seconds, created_by)
values ('71000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-00000000000a', 1, 'opportunity.stage_changed', 300, 600,
        '11111111-1111-1111-1111-111111111111');

select pg_temp.expect_fail(
  $$insert into public.trigger_conditions
      (workspace_id, trigger_version_id, object_type, canonical_field, operator, value)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
            'opportunity', 'stage', 'exists', '"negotiation"'::jsonb)$$,
  'valueless operator carrying a value');

select pg_temp.expect_fail(
  $$insert into public.trigger_conditions
      (workspace_id, trigger_version_id, object_type, canonical_field, operator, value)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
            'opportunity', 'stage', 'in', '"negotiation"'::jsonb)$$,
  'list operator carrying a scalar');

insert into public.trigger_conditions
  (workspace_id, trigger_version_id, object_type, canonical_field, operator, value, ordinal)
values ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
        'opportunity', 'stage', 'changed_to', '"negotiation"'::jsonb, 0),
       ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
        'opportunity', 'amountUsd', 'greater_than_or_equal', '50000'::jsonb, 1);
\echo 'PASS  well-formed conditions accepted'

insert into public.trigger_actions
  (workspace_id, trigger_version_id, action_type, ordinal, params)
values ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
        'recompute_affected_account', 0, '{}'::jsonb),
       ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
        'notify_account_owner', 1, '{"notifyRole": "account_owner"}'::jsonb);
\echo 'PASS  permitted actions accepted'

select pg_temp.expect_fail(
  $$insert into public.trigger_actions
      (workspace_id, trigger_version_id, action_type, ordinal)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
            'send_customer_message', 2)$$,
  'a customer-facing action type');

select pg_temp.expect_fail(
  $$insert into public.trigger_actions
      (workspace_id, trigger_version_id, action_type, ordinal)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
            'write_to_crm', 3)$$,
  'a CRM write-back action type');

select pg_temp.expect_fail(
  $$insert into public.trigger_actions
      (workspace_id, trigger_version_id, action_type, ordinal, params)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '71000000-0000-0000-0000-00000000000a',
            'notify_account_owner', 4, '{"notifyRole": "customer@example.com"}'::jsonb)$$,
  'notifying an address instead of a role');

select pg_temp.expect_fail(
  $$insert into public.trigger_versions
      (workspace_id, trigger_id, version, event_type, published_at, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a',
            2, 'account.updated', now(), '11111111-1111-1111-1111-111111111111')$$,
  'publishing with no publisher or reason');

-- Publish, then confirm nothing about the rule can change afterwards.
update public.trigger_versions
   set published_at = now(),
       published_by = '11111111-1111-1111-1111-111111111111',
       publish_reason = 'Escalate stalled enterprise negotiations'
 where id = '71000000-0000-0000-0000-00000000000a';
\echo 'PASS  publishing a draft version'

select pg_temp.expect_fail(
  $$update public.trigger_versions set cooldown_seconds = 0
     where id = '71000000-0000-0000-0000-00000000000a'$$,
  'editing a published version');

select pg_temp.expect_fail(
  $$update public.trigger_conditions set value = '1'::jsonb
     where trigger_version_id = '71000000-0000-0000-0000-00000000000a' and ordinal = 1$$,
  'editing a published version''s conditions');

select pg_temp.expect_fail(
  $$delete from public.trigger_actions
     where trigger_version_id = '71000000-0000-0000-0000-00000000000a'$$,
  'deleting a published version''s actions');

\echo '=== 10. executions and dead letters ==='

insert into public.trigger_executions
  (id, workspace_id, trigger_id, trigger_version_id, domain_event_id, state, correlation_id)
values ('72000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-00000000000a',
        '11110000-0000-0000-0000-00000000000a', 'running', gen_random_uuid());

select pg_temp.expect_ok(
  $$update public.trigger_executions
       set state = 'succeeded', actions_run = array['recompute_affected_account']::public.trigger_action_type[]
     where id = '72000000-0000-0000-0000-00000000000a'$$,
  'recording an execution result');

select pg_temp.expect_fail(
  $$update public.trigger_executions set trigger_version_id = gen_random_uuid()
     where id = '72000000-0000-0000-0000-00000000000a'$$,
  'repointing an execution at different logic');

select pg_temp.expect_fail(
  $$insert into public.trigger_executions
      (workspace_id, trigger_id, trigger_version_id, domain_event_id, state, correlation_id, is_replay)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a',
            '71000000-0000-0000-0000-00000000000a', '11110000-0000-0000-0000-00000000000a',
            'pending', gen_random_uuid(), true)$$,
  'a replay with no original execution');

select pg_temp.expect_fail(
  $$insert into public.dead_letter_events
      (workspace_id, domain_event_id, reason, error_code, state)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '11110000-0000-0000-0000-00000000000a',
            'retry_budget_exhausted', 'E_TIMEOUT', 'replayed')$$,
  'a replayed dead letter with no replay execution');

\echo '=== 11. audit evidence is append-only ==='

insert into public.audit_evidence
  (workspace_id, actor_id, action, decision, reason)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'commit_manual_import', 'approved', 'Reviewed change set.');

select pg_temp.expect_fail(
  $$update public.audit_evidence set reason = 'nothing to see here'$$,
  'editing audit evidence');

select pg_temp.expect_fail(
  $$delete from public.audit_evidence$$,
  'deleting audit evidence');

\echo '=== 12. rank impact is known or explained, never defaulted ==='

-- Migration 0016. The preview refuses to compute top-N movement without full
-- scoring context, and a NOT NULL DEFAULT 0 column would turn that refusal into
-- the number 0 on the way to storage. An approver reads 0 as "nothing moves".

-- Rolled back at the end of the section. The scratch batches below would
-- otherwise change the row counts 02_rls_by_role asserts on, and a test that
-- silently retunes another file's expectations is how a real RLS regression
-- gets absorbed as an off-by-two.
begin;

-- Real batches, because `change_sets.batch_id` is a foreign key: without them
-- the refusals below would be foreign-key violations and `expect_fail` would
-- pass without the CHECK ever being reached.
insert into public.ingestion_batches
  (id, workspace_id, source_id, state, object_type, mapping_version_id, created_by)
values
  ('b0000000-0000-0000-0000-00000000000d', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'draft', 'account',
   '30000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-00000000000e', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-00000000000a', 'draft', 'account',
   '30000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');

insert into public.change_sets
  (id, workspace_id, batch_id, new_records, rank_impact_unavailable_reason)
values ('c0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-00000000000d', 1,
        'No scoring context was supplied for this batch.');
\echo 'PASS  a change set may record why rank impact is unknown'

select pg_temp.expect_fail(
  $$insert into public.change_sets (workspace_id, batch_id, new_records)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-00000000000e', 1)$$,
  'a change set with neither the counts nor a reason');

select pg_temp.expect_fail(
  $$insert into public.change_sets
      (workspace_id, batch_id, new_records,
       accounts_entering_top_n, accounts_leaving_top_n, rank_impact_unavailable_reason)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-00000000000e', 1, 0, 0, 'unavailable')$$,
  'a change set claiming both a count and a reason');

select pg_temp.expect_fail(
  $$insert into public.change_sets
      (workspace_id, batch_id, new_records, accounts_entering_top_n)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-00000000000e', 1, 3)$$,
  'a change set knowing only half of the rank impact');

rollback;
\echo 'PASS  rank-impact scratch rows rolled back'
