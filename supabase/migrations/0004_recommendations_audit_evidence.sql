-- 0004_recommendations_audit_evidence.sql
-- Published recommendations, audit evidence, and eval results.

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  score numeric not null check (score between 0 and 100),
  rank integer not null check (rank > 0),
  confidence numeric not null check (confidence between 0 and 1),
  reason_codes text[] not null,
  reason_narrative text not null,
  next_best_action jsonb not null,
  source_signals jsonb not null,
  verification jsonb not null,
  approval_status public.approval_status not null default 'not_required',
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_recommendations_owner on public.recommendations (owner_id);
create index if not exists idx_recommendations_account on public.recommendations (account_id);
create index if not exists idx_recommendations_run on public.recommendations (run_id);

-- Immutable audit trail for every critical action (Execution Rule #18).
create table if not exists public.audit_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id text,
  account_id uuid references public.accounts (id) on delete set null,
  actor_id uuid not null,
  action text not null,
  decision public.audit_decision not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_audit_account on public.audit_evidence (account_id);
create index if not exists idx_audit_run on public.audit_evidence (run_id);

create table if not exists public.eval_results (
  id uuid primary key default gen_random_uuid(),
  suite text not null,
  kind text not null,
  passed boolean not null,
  pass_rate numeric not null check (pass_rate between 0 and 1),
  threshold numeric not null check (threshold between 0 and 1),
  deployment_blocking boolean not null default false,
  details jsonb not null default '{}'::jsonb,
  ran_at timestamptz not null default now()
);
