-- 0010_ingestion_batches_and_quarantine.sql
--
-- The staging pipeline: batches, uploaded files, staged records, findings.
--
-- A staged record is a candidate, not a fact. It carries where it came from,
-- what the pipeline concluded about it, and what an administrator decided. The
-- product reads none of these tables to score or to rank.
--
-- Raw payloads are not duplicated here. A CSV row is recoverable from its stored
-- file plus `source_row_number`; a webhook body is recoverable from the domain
-- event added in 0012. Keeping one copy means there is one place to redact.

-- ------------------------------------------------------------------ enums --

do $$ begin
  create type public.ingestion_state as enum (
    'draft', 'awaiting_upload', 'awaiting_auth', 'received', 'security_scanning',
    'parsing', 'mapping', 'validating', 'ready_for_review', 'awaiting_approval',
    'committing', 'committed', 'processing_events', 'completed',
    'rejected', 'quarantined', 'failed', 'cancelled', 'rolled_back',
    'partially_rolled_back'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.record_disposition as enum
    ('ready', 'warning', 'quarantined', 'rejected', 'duplicate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trust_classification as enum
    ('verified_structured', 'unverified_structured', 'untrusted_text',
     'derived_deterministic', 'blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finding_class as enum (
    'file_security', 'authentication', 'authorization', 'workspace_boundary',
    'schema', 'mapping', 'identity', 'referential_integrity', 'duplicate',
    'replay', 'resource_limit', 'data_anomaly', 'untrusted_text',
    'prompt_injection_pattern', 'credential', 'malware', 'system_error'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finding_severity as enum ('info', 'warning', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finding_disposition as enum
    ('open', 'corrected', 'ignored_with_reason', 'rejected_record',
     'rejected_batch', 'hard_block');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.file_scan_status as enum
    ('pending', 'clean', 'infected', 'unavailable');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------- ingestion_batches --

create table if not exists public.ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null,
  state public.ingestion_state not null default 'draft',
  object_type public.canonical_object_type,
  mapping_version_id uuid,
  name text check (name is null or char_length(name) between 1 and 200),
  business_reason text check (business_reason is null or char_length(business_reason) <= 1000),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  total_rows integer not null default 0 check (total_rows >= 0),
  ready_rows integer not null default 0 check (ready_rows >= 0),
  warning_rows integer not null default 0 check (warning_rows >= 0),
  quarantined_rows integer not null default 0 check (quarantined_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade,
  -- The mapping must belong to this batch's own source, not merely to the same
  -- workspace. A mapping decides how raw fields become canonical ones, so
  -- reading source A's rows through source B's mapping produces confident,
  -- wrong facts rather than an error.
  foreign key (mapping_version_id, source_id, workspace_id)
    references public.source_mapping_versions (id, source_id, workspace_id)
    on delete restrict,
  -- The counters describe the same rows the batch received. A total below the
  -- sum of its parts means the pipeline lost track of rows, which must not be
  -- storable.
  constraint ingestion_batches_counts_within_total check (
    ready_rows + warning_rows + quarantined_rows + rejected_rows + duplicate_rows
      <= total_rows
  )
);

alter table public.ingestion_batches
  drop constraint if exists ingestion_batches_id_workspace_key;
alter table public.ingestion_batches
  add constraint ingestion_batches_id_workspace_key unique (id, workspace_id);

-- Lets a staged record bind to the batch's own mapping version rather than to
-- any mapping in the workspace.
alter table public.ingestion_batches
  drop constraint if exists ingestion_batches_id_mapping_workspace_key;
alter table public.ingestion_batches
  add constraint ingestion_batches_id_mapping_workspace_key
  unique (id, mapping_version_id, workspace_id);

create index if not exists ingestion_batches_workspace_idx
  on public.ingestion_batches (workspace_id);
create index if not exists ingestion_batches_source_state_idx
  on public.ingestion_batches (source_id, state);

drop trigger if exists trg_ingestion_batches_updated_at on public.ingestion_batches;
create trigger trg_ingestion_batches_updated_at before update on public.ingestion_batches
  for each row execute function public.set_updated_at();

-- ------------------------------------------------- ingestion state machine --
--
-- Section 8.1: "Invalid state transitions fail closed and create audit
-- evidence." The application asks `@repo/shared-schemas` first; this function
-- is the same table in the database, so a direct SQL update cannot skip
-- approval by moving a batch from `validating` straight to `committed`.

create or replace function public.ingestion_transition_allowed(
  from_state public.ingestion_state,
  to_state public.ingestion_state
)
returns boolean
language sql
immutable
as $$
  select case
    -- Terminal states permit nothing.
    when from_state in ('rejected', 'quarantined', 'failed', 'cancelled',
                        'rolled_back', 'partially_rolled_back') then false
    -- Abandonment and error are reachable from anything still in flight.
    when to_state in ('failed', 'cancelled') then true
    when from_state = 'draft'             then to_state in ('awaiting_upload', 'awaiting_auth')
    when from_state = 'awaiting_upload'   then to_state = 'received'
    when from_state = 'awaiting_auth'     then to_state = 'received'
    when from_state = 'received'          then to_state = 'security_scanning'
    when from_state = 'security_scanning' then to_state in ('parsing', 'rejected', 'quarantined')
    when from_state = 'parsing'           then to_state in ('mapping', 'rejected', 'quarantined')
    when from_state = 'mapping'           then to_state in ('validating', 'rejected')
    when from_state = 'validating'        then to_state in ('ready_for_review', 'rejected', 'quarantined')
    when from_state = 'ready_for_review'  then to_state in ('awaiting_approval', 'rejected')
    when from_state = 'awaiting_approval' then to_state in ('committing', 'rejected')
    when from_state = 'committing'        then to_state = 'committed'
    when from_state = 'committed'         then to_state = 'processing_events'
    when from_state = 'processing_events' then to_state = 'completed'
    when from_state = 'completed'         then to_state in ('rolled_back', 'partially_rolled_back')
    else false
  end;
$$;

create or replace function public.enforce_ingestion_transition()
returns trigger
language plpgsql
as $$
begin
  if new.state is distinct from old.state
     and not public.ingestion_transition_allowed(old.state, new.state) then
    raise exception
      'ingestion batch % may not move from % to %', old.id, old.state, new.state
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ingestion_batches_transition on public.ingestion_batches;
create trigger trg_ingestion_batches_transition
  before update on public.ingestion_batches
  for each row execute function public.enforce_ingestion_transition();

-- -------------------------------------------------------- ingestion_files --

create table if not exists public.ingestion_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_id uuid not null,
  -- Server-generated. A client-supplied filename never becomes a storage path,
  -- so an upload cannot traverse or overwrite another workspace's object.
  storage_path text not null check (char_length(storage_path) between 1 and 1000),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  scan_status public.file_scan_status not null default 'pending',
  scanned_at timestamptz,
  uploaded_at timestamptz not null default now(),
  foreign key (batch_id, workspace_id)
    references public.ingestion_batches (id, workspace_id) on delete cascade
);

create index if not exists ingestion_files_batch_idx
  on public.ingestion_files (batch_id);

-- --------------------------------------------------------- staged_records --

create table if not exists public.staged_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_id uuid not null,
  mapping_version_id uuid not null,
  object_type public.canonical_object_type not null,
  external_id text not null check (char_length(external_id) between 1 and 255),
  source_row_number integer check (source_row_number is null or source_row_number > 0),
  row_hash text not null check (row_hash ~ '^[a-f0-9]{64}$'),
  disposition public.record_disposition not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  -- Per-field trust. The scorer boundary in section 8.4 is enforced from here,
  -- so free-form CRM prose stays excluded by construction.
  field_trust jsonb not null default '{}'::jsonb,
  corrected_from_hash text check (corrected_from_hash is null or corrected_from_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  -- A row is interpreted by its batch's mapping, never by another one that
  -- happens to share the workspace. This also means records cannot be staged
  -- before a mapping version is chosen, because the batch's column is still
  -- null and nothing matches it.
  foreign key (batch_id, mapping_version_id, workspace_id)
    references public.ingestion_batches (id, mapping_version_id, workspace_id)
    on delete cascade
);

alter table public.staged_records
  drop constraint if exists staged_records_id_workspace_key;
alter table public.staged_records
  add constraint staged_records_id_workspace_key unique (id, workspace_id);

create index if not exists staged_records_batch_disposition_idx
  on public.staged_records (batch_id, disposition);
create index if not exists staged_records_external_idx
  on public.staged_records (workspace_id, object_type, external_id);

comment on table public.staged_records is
  'Candidates, not facts. Nothing reads this table to score or rank; only an approved commit promotes a row.';

-- ------------------------------------------------------ ingestion_findings --

create table if not exists public.ingestion_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_id uuid,
  staged_record_id uuid,
  -- Set in 0012 once domain_events exists. A finding may attach to an event
  -- rather than a batch when it comes from a webhook.
  domain_event_id uuid,
  finding_class public.finding_class not null,
  severity public.finding_severity not null,
  disposition public.finding_disposition not null default 'open',
  rule_id text not null check (char_length(rule_id) between 1 and 100),
  canonical_field text check (canonical_field is null or char_length(canonical_field) <= 255),
  -- Redacted before storage. Raw source values never land here.
  redacted_value text check (redacted_value is null or char_length(redacted_value) <= 500),
  explanation text not null check (char_length(explanation) between 1 and 1000),
  downstream_impact text check (downstream_impact is null or char_length(downstream_impact) <= 1000),
  reviewed_by uuid references public.profiles (id) on delete restrict,
  resolution_reason text check (resolution_reason is null or char_length(resolution_reason) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (batch_id, workspace_id)
    references public.ingestion_batches (id, workspace_id) on delete cascade,
  foreign key (staged_record_id, workspace_id)
    references public.staged_records (id, workspace_id) on delete cascade,
  -- A finding describes something. One with no subject is a logging bug.
  constraint ingestion_findings_has_subject
    check (batch_id is not null or staged_record_id is not null or domain_event_id is not null),
  -- Resolving a finding is a decision, so it carries who decided and why.
  constraint ingestion_findings_resolution_recorded check (
    disposition in ('open', 'hard_block')
    or (reviewed_by is not null and resolution_reason is not null)
  )
);

create index if not exists ingestion_findings_batch_idx
  on public.ingestion_findings (batch_id);
create index if not exists ingestion_findings_open_idx
  on public.ingestion_findings (workspace_id, disposition, severity);

-- Section 13.4. These rules can never be overridden.
--
-- The list is duplicated from `HARD_BLOCK_RULES` in @repo/shared-schemas
-- because the two layers must agree without one being able to call the other.
-- An eval reads this file and fails if they drift.
create or replace function public.is_hard_block_rule(rule text)
returns boolean
language sql
immutable
as $$
  select rule in (
    'signature_invalid',
    'cross_workspace_reference',
    'malware_detected',
    'executable_content_in_csv',
    'credential_revoked',
    'hard_resource_limit_exceeded',
    'event_id_reuse_different_hash',
    'protected_field_mapping_attempt',
    'scoring_config_change_attempt',
    'customer_action_attempt'
  );
$$;

-- Hard-block status follows from the rule that fired, not from whatever
-- disposition the writer supplied. Deriving it here means a pipeline
-- misclassification or a direct admin insert cannot file `malware_detected` as
-- an ordinary finding and then resolve it.
create or replace function public.enforce_hard_block_disposition()
returns trigger
language plpgsql
as $$
begin
  if public.is_hard_block_rule(new.rule_id)
     and new.disposition <> 'hard_block' then
    raise exception 'finding rule % is a hard block and cannot be dispositioned as %',
      new.rule_id, new.disposition
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE'
     and old.disposition = 'hard_block'
     and new.disposition is distinct from old.disposition then
    raise exception 'hard block finding % cannot be resolved', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ingestion_findings_hard_block on public.ingestion_findings;
create trigger trg_ingestion_findings_hard_block
  before insert or update on public.ingestion_findings
  for each row execute function public.enforce_hard_block_disposition();
