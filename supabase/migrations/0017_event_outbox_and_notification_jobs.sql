-- Event-driven CRM processing foundation.
--
-- Source adapters write canonical CRM changes, authoritative capability evidence,
-- and outbox rows as one ingestion transaction. The outbox relay only starts
-- durable account-action workflows. It does not own the process after
-- publication succeeds.
--
-- Notification rows are delivery evidence. They do not schedule retries. The
-- durable workflow runtime owns provider-call retry behavior.

-- Complete the tenant-owned recommendation reference chain before new tables
-- depend on it. A recommendation must belong to the same workspace as its
-- canonical account, and `(id, workspace_id)` is the target for delivery evidence.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recommendations_id_workspace_key'
      and conrelid = 'public.recommendations'::regclass
  ) then
    alter table public.recommendations
      add constraint recommendations_id_workspace_key unique (id, workspace_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recommendations_account_same_workspace_fk'
      and conrelid = 'public.recommendations'::regclass
  ) then
    alter table public.recommendations
      add constraint recommendations_account_same_workspace_fk
      foreign key (account_id, workspace_id)
      references public.accounts(id, workspace_id) on delete cascade;
  end if;
end
$$;

create table if not exists public.account_source_capabilities (
  account_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  source text not null check (char_length(source) between 1 and 100),
  capabilities jsonb not null,
  mapping_version text not null check (char_length(mapping_version) between 1 and 200),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_source_capabilities_object check (jsonb_typeof(capabilities) = 'object'),
  constraint account_source_capabilities_account_same_workspace_fk
    foreign key (account_id, workspace_id)
    references public.accounts(id, workspace_id) on delete cascade
);

comment on table public.account_source_capabilities is
  'Authoritative per-account CRM capability snapshot, bound to the same workspace as its account. The runtime parses capabilities through CrmSourceCapabilitiesSchema and fails closed on missing or invalid evidence.';

create index if not exists account_source_capabilities_source_idx
  on public.account_source_capabilities (workspace_id, source, observed_at);

drop trigger if exists set_account_source_capabilities_updated_at on public.account_source_capabilities;
create trigger set_account_source_capabilities_updated_at
  before update on public.account_source_capabilities
  for each row execute function public.set_updated_at();

create table if not exists public.integration_event_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null check (char_length(source) between 1 and 100),
  source_event_id text not null check (char_length(source_event_id) between 1 and 500),
  aggregate_type text not null default 'account' check (aggregate_type = 'account'),
  aggregate_id uuid not null,
  event_type text not null check (char_length(event_type) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'publishing', 'published', 'failed', 'dead')),
  publication_attempt_count integer not null default 0
    check (publication_attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  workflow_run_id text,
  published_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (workspace_id, source, source_event_id),
  constraint integration_event_outbox_account_same_workspace_fk
    foreign key (aggregate_id, workspace_id)
    references public.accounts(id, workspace_id) on delete restrict,
  constraint integration_event_outbox_terminal_evidence check (
    (status = 'published' and workflow_run_id is not null and published_at is not null and last_error_code is null)
    or (status in ('failed', 'dead') and published_at is null and last_error_code is not null)
    or (status in ('pending', 'publishing') and published_at is null)
  )
);

create index if not exists integration_event_outbox_claim_idx
  on public.integration_event_outbox (status, available_at, created_at)
  where status in ('pending', 'failed');

create index if not exists integration_event_outbox_account_idx
  on public.integration_event_outbox (workspace_id, aggregate_id, created_at);

create or replace function public.enforce_integration_event_outbox_insert()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'pending'
     or new.publication_attempt_count <> 0
     or new.locked_at is not null
     or new.locked_by is not null
     or new.workflow_run_id is not null
     or new.published_at is not null
     or new.last_error_code is not null then
    raise exception 'integration event outbox insert must start in pending publication state'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_integration_event_outbox_insert on public.integration_event_outbox;
create trigger enforce_integration_event_outbox_insert
  before insert on public.integration_event_outbox
  for each row execute function public.enforce_integration_event_outbox_insert();

create or replace function public.enforce_integration_event_outbox_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('published', 'dead') then
    raise exception 'integration event outbox terminal state is immutable'
      using errcode = '23514';
  end if;

  if new.publication_attempt_count < old.publication_attempt_count then
    raise exception 'integration event outbox attempt count cannot decrease'
      using errcode = '23514';
  end if;

  if old.status = 'pending' and new.status not in ('pending', 'publishing') then
    raise exception 'invalid integration event outbox transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  if old.status = 'publishing' and new.status not in ('publishing', 'published', 'failed') then
    raise exception 'invalid integration event outbox transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  if old.status = 'failed' and new.status not in ('failed', 'publishing', 'dead') then
    raise exception 'invalid integration event outbox transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_integration_event_outbox_transition on public.integration_event_outbox;
create trigger enforce_integration_event_outbox_transition
  before update on public.integration_event_outbox
  for each row execute function public.enforce_integration_event_outbox_transition();

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recipient_id text not null check (char_length(recipient_id) between 1 and 500),
  recommendation_id uuid not null,
  channel text not null check (channel in ('email', 'in_app')),
  idempotency_key text not null check (char_length(idempotency_key) = 64),
  workflow_run_id text,
  status text not null default 'requested'
    check (status in ('requested', 'sent', 'failed', 'cancelled')),
  provider_message_id text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  constraint notification_deliveries_recommendation_same_workspace_fk
    foreign key (recommendation_id, workspace_id)
    references public.recommendations(id, workspace_id) on delete restrict,
  constraint notification_delivery_terminal_evidence check (
    (status = 'requested' and sent_at is null and failed_at is null and failure_code is null)
    or (status = 'sent' and sent_at is not null and failed_at is null and failure_code is null)
    or (status = 'failed' and sent_at is null and failed_at is not null and failure_code is not null)
    or (status = 'cancelled' and sent_at is null and failed_at is null and failure_code is null)
  )
);

create index if not exists notification_deliveries_recommendation_idx
  on public.notification_deliveries (workspace_id, recommendation_id, requested_at);

create or replace function public.enforce_notification_delivery_insert()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'requested'
     or new.provider_message_id is not null
     or new.sent_at is not null
     or new.failed_at is not null
     or new.failure_code is not null then
    raise exception 'notification delivery insert must start in requested state without terminal evidence'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_notification_delivery_insert on public.notification_deliveries;
create trigger enforce_notification_delivery_insert
  before insert on public.notification_deliveries
  for each row execute function public.enforce_notification_delivery_insert();

create or replace function public.enforce_notification_delivery_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'requested' then
    raise exception 'notification delivery terminal state is immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_notification_delivery_transition on public.notification_deliveries;
create trigger enforce_notification_delivery_transition
  before update on public.notification_deliveries
  for each row execute function public.enforce_notification_delivery_transition();

drop trigger if exists set_notification_deliveries_updated_at on public.notification_deliveries;
create trigger set_notification_deliveries_updated_at
  before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

alter table public.account_source_capabilities enable row level security;
alter table public.integration_event_outbox enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on table public.account_source_capabilities from anon, authenticated;
revoke all on table public.integration_event_outbox from anon, authenticated;
revoke all on table public.notification_deliveries from anon, authenticated;

revoke all on table public.account_source_capabilities from service_role;
revoke all on table public.integration_event_outbox from service_role;
revoke all on table public.notification_deliveries from service_role;

-- Capability authority is tenant-bound by the composite account/workspace FK.
-- Database-owned timestamps cannot be forged by source-adapter inserts.
grant select on table public.account_source_capabilities to service_role;
grant insert (
  account_id,
  workspace_id,
  source,
  capabilities,
  mapping_version,
  observed_at
) on table public.account_source_capabilities to service_role;
grant update (source, capabilities, mapping_version, observed_at)
  on table public.account_source_capabilities to service_role;

-- The source adapter can insert only event identity/content. Publication-state
-- columns keep their database defaults and are also protected by the insert trigger.
grant select on table public.integration_event_outbox to service_role;
grant insert (
  workspace_id,
  source,
  source_event_id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload,
  available_at
) on table public.integration_event_outbox to service_role;
grant update (
  status,
  publication_attempt_count,
  available_at,
  locked_at,
  locked_by,
  workflow_run_id,
  published_at,
  last_error_code
) on table public.integration_event_outbox to service_role;

-- A workflow can create only a requested delivery identity. Terminal state and
-- provider evidence can be written only through the guarded UPDATE path.
grant select on table public.notification_deliveries to service_role;
grant insert (
  workspace_id,
  recipient_id,
  recommendation_id,
  channel,
  idempotency_key,
  workflow_run_id
) on table public.notification_deliveries to service_role;
grant update (
  workflow_run_id,
  status,
  provider_message_id,
  sent_at,
  failed_at,
  failure_code
) on table public.notification_deliveries to service_role;

comment on table public.integration_event_outbox is
  'Transactional outbox for account events. Aggregate account identity is bound to the same workspace; inserts always start pending and the relay alone advances publication state.';
comment on table public.notification_deliveries is
  'Idempotent notification delivery ledger. Recommendation identity is bound to the same workspace; inserts always start requested; workflow steps own provider retry behavior and terminal evidence; customer-facing sends remain approval-gated.';
