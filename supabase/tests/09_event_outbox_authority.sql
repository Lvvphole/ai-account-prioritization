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

create or replace function pg_temp.expect_ok(sql text, label text)
returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'PASS  %', label;
end;
$$;

\echo '=== tenant-owned authority references and capability freshness ==='

insert into public.accounts
  (id, workspace_id, name, owner_id, tier, lifecycle_stage)
values
  ('90000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Authority tenant A account', '11111111-1111-1111-1111-111111111111', 'smb', 'prospect'),
  ('90000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Authority tenant B account', '44444444-4444-4444-4444-444444444444', 'smb', 'prospect');

insert into public.recommendations
  (id, workspace_id, run_id, account_id, owner_id, score, rank, confidence,
   reason_codes, reason_narrative, next_best_action, source_signals, verification)
values
  ('91000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'run-authority-a',
   '90000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   0, 1, 1, array['no_qualifying_signal'], 'Fixture recommendation A.',
   '{"type":"no_action_hold","customerFacing":false,"crmWriteBack":false,"objective":"fixture"}'::jsonb,
   '[{"kind":"derived","refId":"fixture-a","description":"fixture","verified":true}]'::jsonb,
   '{"status":"passed","schemaValid":true,"guardrailsPassed":true,"sourceSignalsVerified":true,"permissionGranted":true,"failedGates":[],"checkedAt":"2026-08-03T09:00:00.000Z"}'::jsonb),
  ('91000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000002', 'run-authority-b',
   '90000000-0000-0000-0000-0000000000b2', '44444444-4444-4444-4444-444444444444',
   0, 1, 1, array['no_qualifying_signal'], 'Fixture recommendation B.',
   '{"type":"no_action_hold","customerFacing":false,"crmWriteBack":false,"objective":"fixture"}'::jsonb,
   '[{"kind":"derived","refId":"fixture-b","description":"fixture","verified":true}]'::jsonb,
   '{"status":"passed","schemaValid":true,"guardrailsPassed":true,"sourceSignalsVerified":true,"permissionGranted":true,"failedGates":[],"checkedAt":"2026-08-03T09:00:00.000Z"}'::jsonb);

set role service_role;
select pg_temp.expect_ok(
  $$insert into public.account_source_capabilities
      (account_id, workspace_id, source, capabilities, mapping_version, observed_at)
    values ('90000000-0000-0000-0000-0000000000a1',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'salesforce', '{}'::jsonb, 'account-v1', '2026-08-03T10:00:00Z')$$,
  'service role writes capability evidence for the account workspace');
select pg_temp.expect_fail(
  $$insert into public.account_source_capabilities
      (account_id, workspace_id, source, capabilities, mapping_version, observed_at)
    values ('90000000-0000-0000-0000-0000000000b2',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'salesforce', '{}'::jsonb, 'account-v1', '2026-08-03T10:00:00Z')$$,
  'service role cannot bind tenant A capability authority to tenant B account');
select pg_temp.expect_fail(
  $$update public.account_source_capabilities
       set capabilities = '{"contacts":true}'::jsonb,
           observed_at = '2026-08-03T09:00:00Z'
     where account_id = '90000000-0000-0000-0000-0000000000a1'$$,
  'older capability observation cannot replace newer authority');
select pg_temp.expect_fail(
  $$update public.account_source_capabilities
       set capabilities = '{"contacts":true}'::jsonb
     where account_id = '90000000-0000-0000-0000-0000000000a1'$$,
  'equal-time replay cannot change capability content');
select pg_temp.expect_ok(
  $$update public.account_source_capabilities
       set capabilities = '{"contacts":true}'::jsonb,
           observed_at = '2026-08-03T11:00:00Z'
     where account_id = '90000000-0000-0000-0000-0000000000a1'$$,
  'newer capability observation replaces current authority');
reset role;

\echo '=== outbox producer and relay authority are separate ==='

do $$
begin
  if has_column_privilege('service_role', 'public.integration_event_outbox', 'status', 'UPDATE') then
    raise exception 'service_role must not have outbox transition authority';
  end if;
  raise notice 'PASS  service_role lacks outbox transition authority';

  if pg_has_role('service_role', 'integration_outbox_relay', 'MEMBER') then
    raise exception 'service_role must not be able to assume integration_outbox_relay';
  end if;
  raise notice 'PASS  service_role cannot assume integration_outbox_relay';
end
$$;

set role service_role;
select pg_temp.expect_ok(
  $$insert into public.integration_event_outbox
      (workspace_id, source, source_event_id, aggregate_id, event_type)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'salesforce', 'evt-valid-a',
            '90000000-0000-0000-0000-0000000000a1', 'account.updated')$$,
  'service role creates pending outbox work for same-workspace account');
select pg_temp.expect_fail(
  $$insert into public.integration_event_outbox
      (workspace_id, source, source_event_id, aggregate_id, event_type)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'salesforce', 'evt-cross-tenant',
            '90000000-0000-0000-0000-0000000000b2', 'account.updated')$$,
  'service role cannot publish tenant A work for tenant B account');
select pg_temp.expect_fail(
  $$update public.integration_event_outbox
       set status = 'publishing', publication_attempt_count = 1
     where source_event_id = 'evt-valid-a'$$,
  'source adapter credential cannot claim publication work');
reset role;

set role integration_outbox_relay;
select pg_temp.expect_fail(
  $$update public.integration_event_outbox
       set status = 'publishing'
     where source_event_id = 'evt-valid-a'$$,
  'entering publishing without exactly one attempt increment is blocked');
select pg_temp.expect_ok(
  $$update public.integration_event_outbox
       set status = 'publishing', publication_attempt_count = 1,
           locked_at = '2026-08-03T12:00:00Z', locked_by = 'relay-1'
     where source_event_id = 'evt-valid-a'$$,
  'relay enters publishing with exactly one attempt increment');
select pg_temp.expect_fail(
  $$update public.integration_event_outbox
       set publication_attempt_count = 2
     where source_event_id = 'evt-valid-a'$$,
  'attempt count cannot change while already publishing');
select pg_temp.expect_ok(
  $$update public.integration_event_outbox
       set status = 'published', workflow_run_id = 'workflow-valid',
           published_at = '2026-08-03T12:01:00Z'
     where source_event_id = 'evt-valid-a'$$,
  'relay records published evidence without changing attempt count');
select pg_temp.expect_fail(
  $$update public.integration_event_outbox
       set status = 'publishing', published_at = null
     where source_event_id = 'evt-valid-a'$$,
  'published outbox row cannot reopen');
reset role;

\echo '=== delivery creator and provider-result authority are separate ==='

do $$
begin
  if has_column_privilege('service_role', 'public.notification_deliveries', 'status', 'UPDATE') then
    raise exception 'service_role must not have delivery result authority';
  end if;
  raise notice 'PASS  service_role lacks delivery result authority';

  if pg_has_role('service_role', 'notification_delivery_worker', 'MEMBER') then
    raise exception 'service_role must not be able to assume notification_delivery_worker';
  end if;
  raise notice 'PASS  service_role cannot assume notification_delivery_worker';
end
$$;

select pg_temp.expect_fail(
  $$insert into public.notification_deliveries
      (workspace_id, recipient_id, recommendation_id, channel, idempotency_key,
       status, provider_message_id, sent_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'recipient-forged',
            '91000000-0000-0000-0000-0000000000a1', 'email', repeat('f', 64),
            'sent', 'provider-forged', now())$$,
  'database guard rejects forged terminal delivery insert');

set role service_role;
select pg_temp.expect_ok(
  $$insert into public.notification_deliveries
      (workspace_id, recipient_id, recommendation_id, channel, idempotency_key, workflow_run_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'recipient-valid',
            '91000000-0000-0000-0000-0000000000a1', 'email', repeat('a', 64), 'workflow-valid')$$,
  'service role reserves requested delivery for same-workspace recommendation');
select pg_temp.expect_fail(
  $$insert into public.notification_deliveries
      (workspace_id, recipient_id, recommendation_id, channel, idempotency_key, workflow_run_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'recipient-cross-tenant',
            '91000000-0000-0000-0000-0000000000b2', 'email', repeat('b', 64), 'workflow-cross-tenant')$$,
  'service role cannot bind tenant A delivery to tenant B recommendation');
select pg_temp.expect_fail(
  $$update public.notification_deliveries
       set status = 'sent', provider_message_id = 'forged', sent_at = now()
     where idempotency_key = repeat('a', 64)$$,
  'delivery creator credential cannot record terminal outcome');
reset role;

set role notification_delivery_worker;
select pg_temp.expect_ok(
  $$update public.notification_deliveries
       set status = 'sent', provider_message_id = 'provider-valid',
           sent_at = '2026-08-03T12:05:00Z'
     where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and idempotency_key = repeat('a', 64)$$,
  'delivery worker records terminal provider result');
select pg_temp.expect_fail(
  $$update public.notification_deliveries
       set status = 'requested', provider_message_id = null, sent_at = null
     where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and idempotency_key = repeat('a', 64)$$,
  'terminal delivery cannot reopen');
reset role;
