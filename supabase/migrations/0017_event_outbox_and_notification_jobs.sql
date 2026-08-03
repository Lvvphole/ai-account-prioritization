-- Event-driven CRM processing foundation.
--
-- Kafka is not a scheduler. Source adapters write normalized CRM changes and
-- this outbox row in one database transaction. A durable worker claims pending
-- rows, coalesces account changes, recomputes only affected accounts, and then
-- creates notification jobs. The daily cron remains the reconciliation path.

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
    check (status in ('pending', 'processing', 'processed', 'failed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (workspace_id, source, source_event_id)
);

create index if not exists integration_event_outbox_claim_idx
  on public.integration_event_outbox (status, available_at, created_at)
  where status in ('pending', 'failed');

create index if not exists integration_event_outbox_account_idx
  on public.integration_event_outbox (workspace_id, aggregate_id, created_at);

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recipient_id text not null check (char_length(recipient_id) between 1 and 500),
  recommendation_id text not null check (char_length(recommendation_id) between 1 and 500),
  channel text not null check (channel in ('email', 'in_app')),
  idempotency_key text not null check (char_length(idempotency_key) = 64),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create index if not exists notification_jobs_claim_idx
  on public.notification_jobs (status, available_at, created_at)
  where status in ('pending', 'failed');

alter table public.integration_event_outbox enable row level security;
alter table public.notification_jobs enable row level security;

-- These are server-worker tables. Browser sessions cannot read or mutate them.
revoke all on table public.integration_event_outbox from anon, authenticated;
revoke all on table public.notification_jobs from anon, authenticated;
grant select, insert, update, delete on table public.integration_event_outbox to service_role;
grant select, insert, update, delete on table public.notification_jobs to service_role;

comment on table public.integration_event_outbox is
  'Transactional outbox for idempotent CRM domain events. A durable worker owns delivery and retry.';
comment on table public.notification_jobs is
  'Idempotent in-app and email delivery jobs. Customer-facing sends remain approval-gated upstream.';
