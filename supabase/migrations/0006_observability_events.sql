-- 0006_observability_events.sql
-- Lightweight observability/audit-adjacent event sink (product evidence).
-- Sentry/Langfuse own reliability/LLM telemetry; this records in-product events.

create table if not exists public.observability_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  name text not null,
  level text not null default 'info',
  trace_id text,
  attributes jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_obs_events_name on public.observability_events (name);
create index if not exists idx_obs_events_trace on public.observability_events (trace_id);

alter table public.observability_events enable row level security;

-- Only managers/admins can read; writes happen via service role (bypasses RLS).
create policy "obs_events_select_manager_or_admin"
  on public.observability_events for select
  using (public.is_manager_or_admin());
