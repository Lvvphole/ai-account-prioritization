-- Event-driven CRM processing foundation.
--
-- Source adapters write canonical CRM changes and outbox rows in one database
-- transaction. The outbox relay only starts durable account-action workflows.
-- It does not own the process after publication succeeds.
--
-- Notification rows are delivery evidence. They do not schedule retries. The
-- durable workflow runtime owns provider-call retry behavior.

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
  unique (workspace_id, source, source_event_id)
);

create index if not exists integration_event_outbox_claim_idx
  on public.integration_event_outbox (status, available_at, created_at)
  where status in ('pending', 'failed');

create index if not exists integration_event_outbox_account_idx
  on public.integration_event_outbox (workspace_id, aggregate_id, created_at);

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
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create index if not exists notification_deliveries_recommendation_idx
  on public.notification_deliveries (workspace_id, recommendation_id, requested_at);

alter table public.integration_event_outbox enable row level security;
alter table public.notification_deliveries enable row level security;

-- These tables are server-only. Browser sessions cannot read or mutate them.
revoke all on table public.integration_event_outbox from anon, authenticated;
revoke all on table public.notification_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.integration_event_outbox to service_role;
grant select, insert, update, delete on table public.notification_deliveries to service_role;

comment on table public.integration_event_outbox is
  'Transactional outbox for CRM events. The relay publishes durable workflow starts and records the workflow run id.';
comment on table public.notification_deliveries is
  'Idempotent notification delivery ledger. Workflow steps own provider retry behavior; customer-facing sends remain approval-gated.';
