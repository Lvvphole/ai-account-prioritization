-- 0012_domain_events_and_triggers.sql
--
-- Domain events and the trigger engine.
--
-- A trigger is a closed, typed rule. The action column is an enum containing
-- only the eight internal actions v1 permits, so `send_customer_message` and
-- `write_to_crm` are not values this schema can hold. An administrator cannot
-- author code here, and a compromised trigger cannot reach a customer.
--
-- Rules are versioned and a published version is immutable, so every execution
-- can name the exact logic that ran.

-- ------------------------------------------------------------------ enums --

do $$ begin
  create type public.domain_event_type as enum (
    'account.created', 'account.updated', 'account.owner_changed',
    'contact.created', 'contact.updated', 'contact.opted_out',
    'opportunity.created', 'opportunity.updated', 'opportunity.stage_changed',
    'opportunity.amount_changed', 'opportunity.stalled',
    'activity.created', 'intent.detected',
    'account_health.updated', 'account_health.threshold_crossed',
    'renewal.window_entered', 'sync.completed',
    'manual_import.committed', 'manual_import.rolled_back'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.domain_event_state as enum
    ('pending', 'processing', 'processed', 'failed', 'dead_lettered', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.condition_operator as enum (
    'equals', 'not_equals', 'in', 'not_in', 'greater_than',
    'greater_than_or_equal', 'less_than', 'less_than_or_equal',
    'changed', 'changed_from', 'changed_to', 'exists', 'not_exists', 'within_days'
  );
exception when duplicate_object then null; end $$;

-- Section 12.4. The prohibited actions are absent by construction, not filtered
-- at write time.
do $$ begin
  create type public.trigger_action_type as enum (
    'recompute_affected_account', 'recompute_owner_book',
    'create_manager_attention_item', 'hold_recommendation',
    'notify_admin', 'notify_manager', 'notify_account_owner',
    'start_delta_reconciliation'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trigger_state as enum ('draft', 'published', 'paused', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trigger_execution_state as enum (
    'pending', 'running', 'succeeded', 'skipped_debounced', 'skipped_cooldown',
    'skipped_condition', 'skipped_rate_limited', 'failed', 'dead_lettered'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------- domain_events --

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Null for events the product raises itself rather than ingesting.
  source_id uuid,
  event_type public.domain_event_type not null,
  object_type public.canonical_object_type not null,
  object_id uuid not null,
  -- What this event rolls up to, so debounce and cooldown can group by account.
  account_id uuid,
  external_event_id text check (external_event_id is null or char_length(external_event_id) between 1 and 255),
  batch_id uuid,
  commit_id uuid,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  -- Normalized, trust-filtered fields only. Raw source bodies stay in staging.
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  state public.domain_event_state not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  processed_at timestamptz,
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade,
  foreign key (batch_id, workspace_id)
    references public.ingestion_batches (id, workspace_id) on delete set null,
  foreign key (commit_id, workspace_id)
    references public.import_commits (id, workspace_id) on delete set null
);

alter table public.domain_events
  drop constraint if exists domain_events_id_workspace_key;
alter table public.domain_events
  add constraint domain_events_id_workspace_key unique (id, workspace_id);

-- Section 15.3 and 10.4. A source that redelivers an event produces one row,
-- so a replayed webhook cannot recompute or notify twice.
create unique index if not exists domain_events_source_external_key
  on public.domain_events (source_id, external_event_id)
  where source_id is not null and external_event_id is not null;

create index if not exists domain_events_pending_idx
  on public.domain_events (workspace_id, state, occurred_at)
  where state = 'pending';
create index if not exists domain_events_account_idx
  on public.domain_events (workspace_id, account_id, occurred_at);

-- A finding may attach to an event rather than a batch, which is how a webhook
-- rejection is recorded when there is no file and no batch.
alter table public.ingestion_findings
  drop constraint if exists ingestion_findings_domain_event_fk;
alter table public.ingestion_findings
  add constraint ingestion_findings_domain_event_fk
  foreign key (domain_event_id, workspace_id)
  references public.domain_events (id, workspace_id) on delete cascade;

-- ----------------------------------------------------- trigger_definitions --

create table if not exists public.trigger_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  state public.trigger_state not null default 'draft',
  active_version_id uuid,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.trigger_definitions
  drop constraint if exists trigger_definitions_id_workspace_key;
alter table public.trigger_definitions
  add constraint trigger_definitions_id_workspace_key unique (id, workspace_id);

drop trigger if exists trg_trigger_definitions_updated_at on public.trigger_definitions;
create trigger trg_trigger_definitions_updated_at before update on public.trigger_definitions
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------- trigger_versions --

create table if not exists public.trigger_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  trigger_id uuid not null,
  version integer not null check (version > 0),
  event_type public.domain_event_type not null,
  -- Optional audience filter, for example enterprise accounts only.
  audience_filter jsonb,
  -- What counts as "the result changed enough to act on". Section 12.1.
  result_change_gate jsonb,
  debounce_seconds integer not null default 0
    check (debounce_seconds between 0 and 86400),
  cooldown_seconds integer not null default 0
    check (cooldown_seconds between 0 and 604800),
  max_executions_per_hour integer not null default 100
    check (max_executions_per_hour between 1 and 10000),
  retry_budget integer not null default 3 check (retry_budget between 0 and 10),
  publish_reason text check (publish_reason is null or char_length(publish_reason) <= 1000),
  published_by uuid references public.profiles (id) on delete restrict,
  published_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (trigger_id, workspace_id)
    references public.trigger_definitions (id, workspace_id) on delete cascade,
  unique (trigger_id, version),
  -- Publishing is a person, a moment and a reason together. Section 12.5.
  constraint trigger_versions_publication_complete check (
    (published_at is null and published_by is null and publish_reason is null)
    or (published_at is not null and published_by is not null and publish_reason is not null)
  )
);

alter table public.trigger_versions
  drop constraint if exists trigger_versions_id_workspace_key;
alter table public.trigger_versions
  add constraint trigger_versions_id_workspace_key unique (id, workspace_id);

create index if not exists trigger_versions_event_idx
  on public.trigger_versions (workspace_id, event_type)
  where published_at is not null;

alter table public.trigger_definitions
  drop constraint if exists trigger_definitions_active_version_fk;
alter table public.trigger_definitions
  add constraint trigger_definitions_active_version_fk
  foreign key (active_version_id, workspace_id)
  references public.trigger_versions (id, workspace_id) on delete set null;

-- ------------------------------------------------------ trigger_conditions --

create table if not exists public.trigger_conditions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  trigger_version_id uuid not null,
  object_type public.canonical_object_type not null,
  -- Canonical field path. A source field name is never accepted here, so a
  -- trigger cannot be written against unmapped, unvalidated data.
  canonical_field text not null check (char_length(canonical_field) between 1 and 255),
  operator public.condition_operator not null,
  value jsonb,
  ordinal integer not null default 0 check (ordinal >= 0),
  foreign key (trigger_version_id, workspace_id)
    references public.trigger_versions (id, workspace_id) on delete cascade,
  unique (trigger_version_id, ordinal),
  -- Operators that take no operand cannot carry one, and the rest require one.
  constraint trigger_conditions_value_matches_operator check (
    (operator in ('changed', 'exists', 'not_exists') and value is null)
    or (operator not in ('changed', 'exists', 'not_exists') and value is not null)
  ),
  -- List operators take a list; scalar operators do not.
  constraint trigger_conditions_list_operator_shape check (
    (operator in ('in', 'not_in')) = (jsonb_typeof(value) = 'array')
    or value is null
  )
);

create index if not exists trigger_conditions_version_idx
  on public.trigger_conditions (trigger_version_id);

-- --------------------------------------------------------- trigger_actions --

create table if not exists public.trigger_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  trigger_version_id uuid not null,
  action_type public.trigger_action_type not null,
  ordinal integer not null default 0 check (ordinal >= 0),
  -- Closed parameter set. Recipients are roles, never addresses, so a trigger
  -- cannot be edited into a channel for reaching a customer.
  params jsonb not null default '{}'::jsonb,
  foreign key (trigger_version_id, workspace_id)
    references public.trigger_versions (id, workspace_id) on delete cascade,
  unique (trigger_version_id, ordinal),
  constraint trigger_actions_notify_role_closed check (
    not (params ? 'notifyRole')
    or params ->> 'notifyRole' in ('admin', 'manager', 'account_owner')
  )
);

create index if not exists trigger_actions_version_idx
  on public.trigger_actions (trigger_version_id);

-- ------------------------------------------------ published version is final --
--
-- Section 15.3: "Trigger versions are immutable after publication." Conditions
-- and actions belong to a version, so freezing all three means an execution
-- record always resolves to the logic that actually ran.

create or replace function public.enforce_trigger_version_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null then
    raise exception 'trigger version % is published and cannot be modified', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trigger_versions_immutable on public.trigger_versions;
create trigger trg_trigger_versions_immutable
  before update on public.trigger_versions
  for each row
  -- The publishing write itself is permitted; everything after it is not.
  when (old.published_at is not null)
  execute function public.enforce_trigger_version_immutable();

create or replace function public.enforce_published_version_children_immutable()
returns trigger
language plpgsql
as $$
declare
  target uuid;
  is_published boolean;
begin
  target := coalesce(new.trigger_version_id, old.trigger_version_id);
  select published_at is not null into is_published
    from public.trigger_versions where id = target;
  if coalesce(is_published, false) then
    raise exception 'trigger version % is published; its rules cannot change', target
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_trigger_conditions_immutable on public.trigger_conditions;
create trigger trg_trigger_conditions_immutable
  before insert or update or delete on public.trigger_conditions
  for each row execute function public.enforce_published_version_children_immutable();

drop trigger if exists trg_trigger_actions_immutable on public.trigger_actions;
create trigger trg_trigger_actions_immutable
  before insert or update or delete on public.trigger_actions
  for each row execute function public.enforce_published_version_children_immutable();

-- ------------------------------------------------------ trigger_executions --

create table if not exists public.trigger_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  trigger_id uuid not null,
  -- The exact logic that ran. Never the definition, which can change.
  trigger_version_id uuid not null,
  domain_event_id uuid not null,
  state public.trigger_execution_state not null default 'pending',
  conditions_matched boolean,
  actions_run public.trigger_action_type[] not null default '{}',
  affected_account_ids uuid[] not null default '{}',
  prioritization_run_id uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  correlation_id uuid not null,
  -- Redacted. No source payload and no customer text.
  error_code text check (error_code is null or char_length(error_code) <= 100),
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  is_replay boolean not null default false,
  replay_of_execution_id uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (trigger_id, workspace_id)
    references public.trigger_definitions (id, workspace_id) on delete cascade,
  foreign key (trigger_version_id, workspace_id)
    references public.trigger_versions (id, workspace_id) on delete restrict,
  foreign key (domain_event_id, workspace_id)
    references public.domain_events (id, workspace_id) on delete cascade,
  constraint trigger_executions_replay_has_origin
    check (not is_replay or replay_of_execution_id is not null)
);

alter table public.trigger_executions
  drop constraint if exists trigger_executions_id_workspace_key;
alter table public.trigger_executions
  add constraint trigger_executions_id_workspace_key unique (id, workspace_id);

alter table public.trigger_executions
  drop constraint if exists trigger_executions_replay_fk;
alter table public.trigger_executions
  add constraint trigger_executions_replay_fk
  foreign key (replay_of_execution_id, workspace_id)
  references public.trigger_executions (id, workspace_id) on delete set null;

create index if not exists trigger_executions_cooldown_idx
  on public.trigger_executions (workspace_id, trigger_id, started_at);
create index if not exists trigger_executions_event_idx
  on public.trigger_executions (domain_event_id);

-- ------------------------------------------------------ dead_letter_events --

create table if not exists public.dead_letter_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Mandatory. A dead letter an operator cannot inspect and replay is just a
  -- deleted event.
  domain_event_id uuid not null,
  trigger_execution_id uuid,
  source_id uuid,
  reason text not null check (reason in (
    'retry_budget_exhausted', 'permanent_action_failure', 'invalid_state_transition',
    'workspace_boundary_violation', 'rate_limit_exhausted', 'system_error'
  )),
  error_code text not null check (char_length(error_code) between 1 and 100),
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  state text not null default 'open' check (state in ('open', 'replayed', 'discarded')),
  replay_execution_id uuid,
  resolved_by uuid references public.profiles (id) on delete restrict,
  resolution_reason text check (resolution_reason is null or char_length(resolution_reason) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (domain_event_id, workspace_id)
    references public.domain_events (id, workspace_id) on delete cascade,
  foreign key (trigger_execution_id, workspace_id)
    references public.trigger_executions (id, workspace_id) on delete set null,
  foreign key (replay_execution_id, workspace_id)
    references public.trigger_executions (id, workspace_id) on delete set null,
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade,
  constraint dead_letter_replayed_has_execution
    check (state <> 'replayed' or replay_execution_id is not null),
  constraint dead_letter_discarded_has_reason
    check (state <> 'discarded' or (resolved_by is not null and resolution_reason is not null))
);

create index if not exists dead_letter_events_open_idx
  on public.dead_letter_events (workspace_id, state, created_at);

comment on table public.trigger_versions is
  'Immutable after publication. Every execution names the version that ran, so past behaviour stays explainable.';
