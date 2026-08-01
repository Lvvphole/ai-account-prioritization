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

-- Lets a commit demand that its change set and its approval describe the same
-- batch it claims to be committing.
alter table public.change_sets
  drop constraint if exists change_sets_id_batch_workspace_key;
alter table public.change_sets
  add constraint change_sets_id_batch_workspace_key unique (id, batch_id, workspace_id);

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

-- Lets a commit item name the exact previewed change it applied.
alter table public.change_set_items
  drop constraint if exists change_set_items_id_set_workspace_key;
alter table public.change_set_items
  add constraint change_set_items_id_set_workspace_key
  unique (id, change_set_id, workspace_id);

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
  -- No constraint requires the second signature to be present here. The row
  -- records who has approved so far, and the second approver has not acted yet
  -- when the first one does. Completeness is demanded at commit time instead,
  -- by `enforce_commit_approval_complete` below, which is the moment it
  -- actually matters.
  --
  -- Two approvals from one person is one approval. Section 7.2 step 9.
  constraint import_approvals_second_approver_distinct
    check (second_approved_by is null or second_approved_by <> approved_by)
);

alter table public.import_approvals
  drop constraint if exists import_approvals_id_workspace_key;
alter table public.import_approvals
  add constraint import_approvals_id_workspace_key unique (id, workspace_id);

alter table public.import_approvals
  drop constraint if exists import_approvals_id_batch_workspace_key;
alter table public.import_approvals
  add constraint import_approvals_id_batch_workspace_key
  unique (id, batch_id, workspace_id);

create index if not exists import_approvals_batch_idx
  on public.import_approvals (batch_id);

-- ------------------------------------------- approvals name real approvers --
--
-- `approved_by` referencing `profiles` only proves the id belongs to some user
-- somewhere. Two problems follow: the named person need not be an admin of
-- this workspace, and one admin can satisfy a two-person requirement by typing
-- two ids without either person acting.
--
-- Both are closed here. An approver must hold admin in the batch's workspace,
-- and in a browser session the approver must be the person making the request.
-- The service role has no `auth.uid()` and remains a trusted server context, as
-- it is everywhere else in this schema.

create or replace function public.is_workspace_admin_user(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.workspace_memberships m
     where m.workspace_id = ws
       and m.user_id = uid
       and m.role = 'admin'
  );
$$;

create or replace function public.enforce_approval_identity()
returns trigger
language plpgsql
as $$
begin
  if not public.is_workspace_admin_user(new.workspace_id, new.approved_by) then
    raise exception 'approver % does not hold admin in workspace %',
      new.approved_by, new.workspace_id
      using errcode = 'check_violation';
  end if;

  if new.second_approved_by is not null
     and not public.is_workspace_admin_user(new.workspace_id, new.second_approved_by) then
    raise exception 'second approver % does not hold admin in workspace %',
      new.second_approved_by, new.workspace_id
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and auth.uid() is not null then
    if new.approved_by <> auth.uid() then
      raise exception 'an approval records the person giving it, not another user'
        using errcode = 'check_violation';
    end if;
    -- A second approval is a second person acting. It is recorded when they
    -- act, never claimed on their behalf at insert time.
    if new.second_approved_by is not null then
      raise exception 'a second approval must be recorded by the second approver'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null
     and new.second_approved_by is distinct from old.second_approved_by
     and new.second_approved_by <> auth.uid() then
    raise exception 'a second approval records the person giving it'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_approvals_identity on public.import_approvals;
create trigger trg_import_approvals_identity
  before insert or update on public.import_approvals
  for each row execute function public.enforce_approval_identity();

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
  -- All three inputs must name the same batch. Checking only the workspace
  -- would let one approved batch's sign-off authorize a different batch's
  -- changes, which is the whole gate defeated by a single mismatched id.
  foreign key (change_set_id, batch_id, workspace_id)
    references public.change_sets (id, batch_id, workspace_id) on delete restrict,
  foreign key (approval_id, batch_id, workspace_id)
    references public.import_approvals (id, batch_id, workspace_id) on delete restrict
);

alter table public.import_commits
  drop constraint if exists import_commits_id_workspace_key;
alter table public.import_commits
  add constraint import_commits_id_workspace_key unique (id, workspace_id);

-- Lets a commit item prove it belongs to the change set this commit applied.
alter table public.import_commits
  drop constraint if exists import_commits_id_change_set_workspace_key;
alter table public.import_commits
  add constraint import_commits_id_change_set_workspace_key
  unique (id, change_set_id, workspace_id);

alter table public.import_commits
  drop constraint if exists import_commits_rollback_fk;
alter table public.import_commits
  add constraint import_commits_rollback_fk
  foreign key (rolled_back_by_commit_id, workspace_id)
  references public.import_commits (id, workspace_id) on delete restrict;

create index if not exists import_commits_batch_idx
  on public.import_commits (batch_id);

-- The gate that a two-person requirement actually rests on. An approval row is
-- allowed to sit incomplete while the second admin has not yet acted; a commit
-- against it is not.
create or replace function public.enforce_commit_approval_complete()
returns trigger
language plpgsql
as $$
declare
  needs_second boolean;
  second_signer uuid;
begin
  select second_approval_required, second_approved_by
    into needs_second, second_signer
    from public.import_approvals
   where id = new.approval_id;

  if needs_second and second_signer is null then
    raise exception 'approval % still awaits its second approver', new.approval_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_import_commits_approval_complete on public.import_commits;
create trigger trg_import_commits_approval_complete
  before insert on public.import_commits
  for each row execute function public.enforce_commit_approval_complete();

-- ---------------------------------------------------- import_commit_items --
-- What one commit actually wrote, row by row. This is the lineage a reviewer
-- follows from an operational record back to the source row that produced it.

create table if not exists public.import_commit_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  commit_id uuid not null,
  -- Carried so the two references below can be pinned to the same change set.
  -- Without it, lineage is a claim rather than a constraint.
  change_set_id uuid not null,
  change_set_item_id uuid not null,
  object_type public.canonical_object_type not null,
  -- The operational row written. Not a foreign key: the target table varies by
  -- object type, and `external_record_links` is the resolvable index.
  internal_record_id uuid not null,
  change_kind public.change_kind not null,
  applied_at timestamptz not null default now(),
  foreign key (commit_id, change_set_id, workspace_id)
    references public.import_commits (id, change_set_id, workspace_id) on delete restrict,
  -- The applied item must be one of the items an approver actually previewed.
  foreign key (change_set_item_id, change_set_id, workspace_id)
    references public.change_set_items (id, change_set_id, workspace_id) on delete restrict,
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
