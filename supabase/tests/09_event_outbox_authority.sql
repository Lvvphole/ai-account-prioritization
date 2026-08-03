\set ON_ERROR_STOP on
\pset pager off

-- PR #40 authority-boundary regressions. These checks exercise the database
-- behavior, not only the presence of DDL text.

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

\echo '=== capability authority is tenant-bound ==='

-- The workspaces and owners are seeded by 01_ingestion_invariants.sql. These
-- two accounts make the cross-tenant reference concrete.
insert into public.accounts
  (id, workspace_id, name, owner_id, tier, lifecycle_stage)
values
  ('90000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Capability tenant A account', '11111111-1111-1111-1111-111111111111', 'smb', 'prospect'),
  ('90000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000002',
   'Capability tenant B account', '44444444-4444-4444-4444-444444444444', 'smb', 'prospect');

set role service_role;
select pg_temp.expect_ok(
  $$insert into public.account_source_capabilities
      (account_id, workspace_id, source, capabilities, mapping_version, observed_at)
    values ('90000000-0000-0000-0000-0000000000a1',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'salesforce', '{}'::jsonb, 'account-v1', now())$$,
  'service role writes capability evidence for the account workspace');

select pg_temp.expect_fail(
  $$insert into public.account_source_capabilities
      (account_id, workspace_id, source, capabilities, mapping_version, observed_at)
    values ('90000000-0000-0000-0000-0000000000b2',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'salesforce', '{}'::jsonb, 'account-v1', now())$$,
  'service role cannot bind tenant A capability authority to tenant B account');
reset role;

\echo '=== outbox inserts can only create pending publication work ==='

do $$
begin
  if not has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'source_event_id',
    'INSERT'
  ) then
    raise exception 'service_role must be able to insert outbox event identity';
  end if;
  raise notice 'PASS  service_role can insert outbox event identity';

  if has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'status',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert outbox publication status';
  end if;
  raise notice 'PASS  service_role cannot insert outbox publication status';

  if has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'workflow_run_id',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert workflow publication evidence';
  end if;
  raise notice 'PASS  service_role cannot insert outbox workflow evidence';

  if has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'published_at',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert published timestamps';
  end if;
  raise notice 'PASS  service_role cannot insert outbox published timestamps';

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'integration_event_outbox'
      and t.tgname = 'enforce_integration_event_outbox_insert'
      and not t.tgisinternal
  ) then
    raise exception 'integration_event_outbox insert-state guard trigger is missing';
  end if;
  raise notice 'PASS  outbox insert-state guard exists';
end
$$;

select pg_temp.expect_fail(
  $$insert into public.integration_event_outbox
      (workspace_id, source, source_event_id, aggregate_id, event_type,
       status, workflow_run_id, published_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'salesforce', 'evt-forged',
            '90000000-0000-0000-0000-0000000000a1', 'account.updated',
            'published', 'workflow-forged', now())$$,
  'database guard rejects a forged published outbox insert');

\echo '=== delivery inserts can only create requested work ==='

do $$
begin
  if not has_column_privilege(
    'service_role',
    'public.notification_deliveries',
    'idempotency_key',
    'INSERT'
  ) then
    raise exception 'service_role must be able to insert delivery identity';
  end if;
  raise notice 'PASS  service_role can insert delivery identity';

  if has_column_privilege(
    'service_role',
    'public.notification_deliveries',
    'status',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert delivery terminal status';
  end if;
  raise notice 'PASS  service_role cannot insert delivery status';

  if has_column_privilege(
    'service_role',
    'public.notification_deliveries',
    'sent_at',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert sent delivery evidence';
  end if;
  raise notice 'PASS  service_role cannot insert delivery sent evidence';

  if has_column_privilege(
    'service_role',
    'public.notification_deliveries',
    'failed_at',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert failed delivery evidence';
  end if;
  raise notice 'PASS  service_role cannot insert delivery failed evidence';

  if has_column_privilege(
    'service_role',
    'public.notification_deliveries',
    'failure_code',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert delivery failure code';
  end if;
  raise notice 'PASS  service_role cannot insert delivery failure code';

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'notification_deliveries'
      and t.tgname = 'enforce_notification_delivery_insert'
      and not t.tgisinternal
  ) then
    raise exception 'notification_deliveries insert-state guard trigger is missing';
  end if;
  raise notice 'PASS  delivery insert-state guard exists';
end
$$;

select pg_temp.expect_fail(
  $$insert into public.notification_deliveries
      (workspace_id, recipient_id, recommendation_id, channel, idempotency_key,
       status, provider_message_id, sent_at)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'recipient-forged',
            'recommendation-forged', 'email', repeat('f', 64),
            'sent', 'provider-forged', now())$$,
  'database guard rejects a forged sent delivery insert');

set role service_role;
select pg_temp.expect_ok(
  $$insert into public.notification_deliveries
      (workspace_id, recipient_id, recommendation_id, channel, idempotency_key, workflow_run_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'recipient-valid',
            'recommendation-valid', 'email', repeat('a', 64), 'workflow-valid')$$,
  'service role creates a requested delivery through restricted insert authority');
reset role;

select pg_temp.expect_ok(
  $$update public.notification_deliveries
       set status = 'sent', provider_message_id = 'provider-valid', sent_at = now()
     where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and idempotency_key = repeat('a', 64)$$,
  'delivery reaches sent state only through the guarded update path');

select pg_temp.expect_fail(
  $$update public.notification_deliveries
       set status = 'requested', provider_message_id = null, sent_at = null
     where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and idempotency_key = repeat('a', 64)$$,
  'terminal delivery cannot be reopened');
