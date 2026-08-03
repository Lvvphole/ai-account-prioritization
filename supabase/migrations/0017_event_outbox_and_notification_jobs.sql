-- Event-driven CRM processing foundation.
--
-- Source adapters write canonical CRM changes, authoritative capability evidence,
-- and outbox rows as one ingestion transaction. The outbox relay only starts
-- durable account-action workflows. It does not own the process after
-- publication succeeds.
--
-- Notification rows are delivery evidence. They do not schedule retries. The
-- durable workflow runtime owns provider-call retry behavior.

create table if not exists public.account_source_capabilities (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  source text not null check (char_length(source) between 1 and 100),
  capabilities jsonb not null,
  mapping_version text not null check (char_length(mapping_version) between 1 and 200),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_source_capabilities_object check (jsonb_typeof(capabilities) = 'object')
);

comment on table public.account_source_capabilities is
  'Authoritative per-account CRM capability snapshot. The runtime parses capabilities through CrmSourceCapabilitiesSchema and fails closed on missing or invalid evidence.';

create index if not exists account_source_capabilities_source_idx
  on public.account_source_capabilities (source, observed_at);

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
  aggregate_id text not null check (char_length(aggregate_id) between 1 and 500),
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
  recommendation_id text not null check (char_length(recommendation_id) between 1 and 500),
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
  constraint notification_delivery_terminal_evidence check (
    (status = 'requested' and sent_at is null and failed_at is null and failure_code is null)
    or (status = 'sent' and sent_at is not null and failed_at is null and failure_code is null)
    or (status = 'failed' and sent_at is null and failed_at is not null and failure_code is not null)
    or (status = 'cancelled' and sent_at is null and failed_at is null and failure_code is null)
  )
);

create index if not exists notification_deliveries_recommendation_idx
  on public.notification_deliveries (workspace_id, recommendation_id, requested_at);

create or replace function public.enforce_notification_delivery_transition()
returns trigger
language plpgsql
as $$
begin
  -- A terminal delivery row is immutable business evidence. A sent/failed/
  -- cancelled row cannot be reopened to requested or rewritten in place.
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

-- These tables are server-only. Browser sessions cannot read or mutate them.
revoke all on table public.account_source_capabilities from anon, authenticated;
revoke all on table public.integration_event_outbox from anon, authenticated;
revoke all on table public.notification_deliveries from anon, authenticated;

-- PostgreSQL grants are additive. Remove Supabase default service-role table
-- privileges first, then add only the operations required by the runtime.
revoke all on table public.account_source_capabilities from service_role;
revoke all on table public.integration_event_outbox from service_role;
revoke all on table public.notification_deliveries from service_role;

-- Source adapters maintain the current capability snapshot. Account identity is
-- the immutable primary key; updates can replace the source evidence and version.
grant select, insert on table public.account_source_capabilities to service_role;
grant update (source, capabilities, mapping_version, observed_at)
  on table public.account_source_capabilities to service_role;

-- Outbox identity and payload are immutable after insertion. The relay can only
-- advance publication state and record workflow-start evidence.
grant select, insert on table public.integration_event_outbox to service_role;
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

-- Delivery identity and the idempotency key are immutable to application code.
-- Only delivery-result columns can change while the row is requested. DELETE is
-- not granted, and the transition trigger makes terminal rows immutable.
grant select, insert on table public.notification_deliveries to service_role;
grant update (
  workflow_run_id,
  status,
  provider_message_id,
  sent_at,
  failed_at,
  failure_code
) on table public.notification_deliveries to service_role;

comment on table public.integration_event_outbox is
  'Transactional outbox for CRM events. The relay publishes durable workflow starts and records the workflow run id.';
comment on table public.notification_deliveries is
  'Idempotent notification delivery ledger. Workflow steps own provider retry behavior; customer-facing sends remain approval-gated.';
