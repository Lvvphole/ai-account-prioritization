-- 0011_import_commits_and_external_links.sql
--
-- The commit path: change sets, approvals, commits, rollbacks, and the link
-- between an external record and the operational row it became.
--
-- This is the only place staged data becomes product data, and it is gated:
-- a commit references an approval, an approval references a reviewer and a
-- reason, and a high-risk change set demands a second approver who is not the
-- first. Commits are append-only, so undoing an import writes a compensating
-- commit and leaves the original record of what was applied intact.

do $$ begin
  create type public.change_kind as enum
    ('create', 'update', 'unchanged', 'owner_change');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rollback_state as enum
    ('requested', 'conflicted', 'applied', 'partially_applied', 'denied');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ change_sets --
-- The preview an approver reads before deciding. Section 7.2 step 8.

create table if not exists public.change_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  new_records integer not null default 0 check (new_records >= 0),
  updated_records integer not null default 0 check (updated_records >= 0),
  unchanged_records integer not null default 0 check (unchanged_records >= 0),
  owner_changes integer not null default 0 check (owner_changes >= 0),
  referential_failures integer not null default 0 check (referential_failures >= 0),
  duplicate_records integer not null default 0 check (duplicate_records >= 0),
  -- Signed. An import can reduce pipeline as well as add to it.
  pipeline_delta_usd numeric not null default 0,
  accounts_entering_top_n integer not null default 0 check (accounts_entering_top_n >= 0),
  accounts_leaving_top_n integer not null default 0 check (accounts_leaving_top_n >= 0),
  predicted_guardrail_holds integer not null default 0 check (predicted_guardrail_holds >= 0),
  concentration_notes text check (concentration_notes is null or char_length(concentration_notes) <= 1000),
  foreign key (batch_id, workspace_id)
    references public.ingestion_batches (id, workspace_id) on delete cascade,
  -- One preview per batch. A second would let an approver read one set and a
  -- commit apply another.
  unique (batch_id)
);

alter table public.change_sets
  drop constraint if exists change_sets_id_workspace_key;
alter table public.change_sets
  add constraint change_sets_id_workspace_key unique (id, workspace_id);

-- ------------------------------------------------------- change_set_items --

create table if not exists public.change_set_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  change_set_id uuid not null,
  staged_record_id uuid not null,
  object_type public.canonical_object_type not null,
  external_id text not null check (char_length(external_id) between 1 and 255),
  -- Null on create. Set once the record resolves to an existing operational row.
  target_record_id uuid,
  change_kind public.change_kind not null,
  -- Before and after per changed field, so a rollback is exact rather than a
  -- guess at what the row used to look like.
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (change_set_id, workspace_id)
    references public.change_sets (id, workspace_id) on delete cascade,
  foreign key (staged_record_id, workspace_id)
    references public.staged_records (id, workspace_id) on delete cascade,
  constraint change_set_items_create_has_no_target
    check ((change_kind = 'create') = (target_record_id is null))
);

create index if not exists change_set_items_set_idx
  on public.change_set_items (change_set_id);

-- ------------------------------------------------------- import_approvals --

create table if not exists public.import_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_id uuid not null,
  approved_by uuid not null references public.profiles (id) on delete restrict,
  business_reason text not null check (char_length(business_reason) between 1 and 1000),
  second_approval_required boolean not null default false,
  second_approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz not null default now(),
  foreign key (batch_id, workspace_id)
    references public.ingestion_batches (id, workspace_id) on delete cascade,
  constraint import_approvals_second_approver_present
    check (not second_approval_required or second_approved_by is not null),
  -- Two approvals from one person is one approval. Section 7.2 step 9.
  constraint import_approvals_second_approver_distinct
    check (second_approved_by is null or second_approved_by <> approved_by)
);

alter table public.import_approvals
  drop constraint if exists import_approvals_id_workspace_key;
alter table public.import_approvals
  add constraint import_approvals_id_workspace_key unique (id, workspace_id);

create index if not exists import_approvals_batch_idx
  on public.import_approvals (batch_id);

-- --------------------------------------------------------- import_commits --

create table if not exists public.import_commits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_id uuid not null,
  change_set_id uuid not null,
  -- Not nullable. A commit without an approval is not representable.
  approval_id uuid not null,
  committed_by uuid not null references public.profiles (id) on delete restrict,
  committed_at timestamptz not null default now(),
  records_created integer not null default 0 check (records_created >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  rolled_back_by_commit_id uuid,
  foreign key (batch_id, workspace_id)
    references public.ingestion_batches (id, workspace_id) on delete restrict,
  foreign key (change_set_id, workspace_id)
    references public.change_sets (id, workspace_id) on delete restrict,
  foreign key (approval_id, workspace_id)
    references public.import_approvals (id, workspace_id) on delete restrict
);

alter table public.import_commits
  drop constraint if exists import_commits_id_workspace_key;
alter table public.import_commits
  add constraint import_commits_id_workspace_key unique (id, workspace_id);

alter table public.import_commits
  drop constraint if exists import_commits_rollback_fk;
alter table public.import_commits
  add constraint import_commits_rollback_fk
  foreign key (rolled_back_by_commit_id, workspace_id)
  references public.import_commits (id, workspace_id) on delete restrict;

create index if not exists import_commits_batch_idx
  on public.import_commits (batch_id);

-- ---------------------------------------------------- import_commit_items --
-- What one commit actually wrote, row by row. This is the lineage a reviewer
-- follows from an operational record back to the source row that produced it.

create table if not exists public.import_commit_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  commit_id uuid not null,
  change_set_item_id uuid not null,
  object_type public.canonical_object_type not null,
  -- The operational row written. Not a foreign key: the target table varies by
  -- object type, and `external_record_links` is the resolvable index.
  internal_record_id uuid not null,
  change_kind public.change_kind not null,
  applied_at timestamptz not null default now(),
  foreign key (commit_id, workspace_id)
    references public.import_commits (id, workspace_id) on delete restrict,
  unique (commit_id, change_set_item_id)
);

create index if not exists import_commit_items_commit_idx
  on public.import_commit_items (commit_id);
create index if not exists import_commit_items_record_idx
  on public.import_commit_items (workspace_id, object_type, internal_record_id);

-- ------------------------------------------------------- import_rollbacks --

create table if not exists public.import_rollbacks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- The commit being compensated. Never edited or deleted.
  original_commit_id uuid not null,
  compensating_commit_id uuid,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  business_reason text not null check (char_length(business_reason) between 1 and 1000),
  state public.rollback_state not null default 'requested',
  -- Records changed since the original commit. A rollback that overwrote later
  -- edits would destroy work, so conflicts are counted and surfaced first.
  conflict_count integer not null default 0 check (conflict_count >= 0),
  requested_at timestamptz not null default now(),
  foreign key (original_commit_id, workspace_id)
    references public.import_commits (id, workspace_id) on delete restrict,
  foreign key (compensating_commit_id, workspace_id)
    references public.import_commits (id, workspace_id) on delete restrict,
  constraint import_rollbacks_applied_has_compensation
    check (state not in ('applied', 'partially_applied') or compensating_commit_id is not null)
);

create index if not exists import_rollbacks_original_idx
  on public.import_rollbacks (original_commit_id);

-- -------------------------------------------------- external_record_links --
-- Section 19.2. Ties an operational row back to the source record it came from,
-- and gives the next sync a stable identity to match against.

create table if not exists public.external_record_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null,
  object_type public.canonical_object_type not null,
  external_id text not null check (char_length(external_id) between 1 and 255),
  internal_record_id uuid not null,
  last_commit_id uuid,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade,
  foreign key (last_commit_id, workspace_id)
    references public.import_commits (id, workspace_id) on delete set null,
  -- Section 15.3: one external record maps to one internal record per source.
  -- Without this, a replayed sync could fork an account into duplicates.
  unique (source_id, object_type, external_id)
);

create index if not exists external_record_links_internal_idx
  on public.external_record_links (workspace_id, object_type, internal_record_id);

comment on table public.import_commits is
  'Append-only record of every promotion from staging to product data. Rollback writes a compensating commit.';
