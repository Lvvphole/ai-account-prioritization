-- 0013_ingestion_rls_and_append_only_guards.sql
--
-- Row Level Security and immutability for the ingestion control plane.
--
-- Three rules decide every policy below, taken from section 5.2:
--
--   Admin    manages sources, mappings, imports, quarantine and triggers,
--            within their own workspace only.
--   Manager  reads source health, committed imports, trigger executions and
--            quarantine summaries. Nothing else, and nothing writable.
--   Rep      has no access to the control plane at all, so no policy names it.
--
-- `source_credentials` is the one table with no policy for any browser role.
-- Section 5.2: "Source secrets must never be returned to any browser after
-- creation." A table with RLS enabled and no SELECT policy returns nothing,
-- which is a stronger guarantee than a policy nobody satisfies today.
--
-- Service-role connections bypass RLS by design, matching 0005.

-- ------------------------------------------------------------ 1. enable --
--
-- Applied in a loop because the list is long and identical. A table missing
-- from this array would silently be world-readable, so the array is the
-- checklist: every table created in 0009 through 0012 appears exactly once.

do $$
declare
  t text;
  tables text[] := array[
    'data_sources', 'source_credentials', 'source_scopes',
    'source_mapping_versions', 'source_field_mappings', 'source_sync_cursors',
    'ingestion_batches', 'ingestion_files', 'staged_records', 'ingestion_findings',
    'change_sets', 'change_set_items', 'import_approvals', 'import_commits',
    'import_commit_items', 'import_rollbacks', 'external_record_links',
    'domain_events', 'trigger_definitions', 'trigger_versions',
    'trigger_conditions', 'trigger_actions', 'trigger_executions',
    'dead_letter_events'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    -- Nothing in the control plane is ever read by a signed-out visitor.
    -- Supabase's default privileges grant `anon` SELECT on new public tables,
    -- so the grant is withdrawn rather than left to RLS alone.
    execute format('revoke all on public.%I from anon', t);
    -- Supabase grants these to `authenticated` for tables created through its
    -- own tooling. Migrations applied directly need them explicitly, otherwise
    -- RLS never gets a chance to decide because the grant refuses first.
    if t <> 'source_credentials' then
      execute format(
        'grant select, insert, update, delete on public.%I to authenticated', t
      );
    end if;
  end loop;
end $$;

-- Two independent refusals for the one table holding credential metadata: no
-- grant, and no policy. Either alone would be enough; both means a future
-- migration that adds a policy by mistake still returns nothing to a browser.
revoke all on public.source_credentials from anon, authenticated;

-- ------------------------------------------------- 2. admin control plane --

do $$
declare
  t text;
  admin_tables text[] := array[
    'data_sources', 'source_scopes',
    'source_mapping_versions', 'source_field_mappings', 'source_sync_cursors',
    'ingestion_batches', 'ingestion_files', 'staged_records', 'ingestion_findings',
    'change_sets', 'change_set_items', 'import_approvals', 'import_commits',
    'import_commit_items', 'import_rollbacks', 'external_record_links',
    'domain_events', 'trigger_definitions', 'trigger_versions',
    'trigger_conditions', 'trigger_actions', 'trigger_executions',
    'dead_letter_events'
  ];
begin
  foreach t in array admin_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all
         using (public.is_workspace_admin(workspace_id))
         with check (public.is_workspace_admin(workspace_id))',
      t || '_admin_all', t
    );
  end loop;
end $$;

-- ----------------------------------------------------- 3. manager reading --
--
-- Read-only, and deliberately not the whole control plane. A manager sees what
-- landed and what it did to their team. They do not see staged payloads,
-- approvals, scopes, mappings-in-progress or credential metadata.

do $$
declare
  t text;
  manager_read_tables text[] := array[
    'data_sources', 'ingestion_batches', 'ingestion_findings', 'change_sets',
    'import_commits', 'trigger_definitions', 'trigger_versions',
    'trigger_executions', 'dead_letter_events'
  ];
begin
  foreach t in array manager_read_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_manager_select', t);
    execute format(
      'create policy %I on public.%I for select
         using (public.is_workspace_manager_or_admin(workspace_id))',
      t || '_manager_select', t
    );
  end loop;
end $$;

comment on table public.source_credentials is
  'No RLS policy exists for any browser role. Secrets are never returned to a browser after creation; only the service role reads this table.';

-- --------------------------------------------------- 4. append-only guards --
--
-- Section 15.3: `import_commits` and `audit_evidence` are append-only. An
-- import that can be edited after the fact is not evidence of anything, and a
-- rollback that rewrites the original commit destroys the record of what was
-- applied. Undo writes a compensating commit instead.

create or replace function public.forbid_update_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = 'check_violation';
end;
$$;

-- `import_commits.rolled_back_by_commit_id` is set once when a compensating
-- commit exists, so UPDATE is narrowed rather than forbidden outright.
create or replace function public.forbid_commit_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.batch_id is distinct from old.batch_id
     or new.change_set_id is distinct from old.change_set_id
     or new.approval_id is distinct from old.approval_id
     or new.committed_by is distinct from old.committed_by
     or new.committed_at is distinct from old.committed_at
     or new.records_created is distinct from old.records_created
     or new.records_updated is distinct from old.records_updated then
    raise exception 'import_commits is append-only; only the rollback pointer may be set'
      using errcode = 'check_violation';
  end if;
  if old.rolled_back_by_commit_id is not null
     and new.rolled_back_by_commit_id is distinct from old.rolled_back_by_commit_id then
    raise exception 'the rollback pointer on commit % is already set', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_import_commits_no_delete on public.import_commits;
create trigger trg_import_commits_no_delete
  before delete on public.import_commits
  for each row execute function public.forbid_update_delete();

drop trigger if exists trg_import_commits_no_rewrite on public.import_commits;
create trigger trg_import_commits_no_rewrite
  before update on public.import_commits
  for each row execute function public.forbid_commit_rewrite();

drop trigger if exists trg_import_commit_items_append_only on public.import_commit_items;
create trigger trg_import_commit_items_append_only
  before update or delete on public.import_commit_items
  for each row execute function public.forbid_update_delete();

-- An approval is append-only in substance, but the second approver has not
-- acted yet when the row is created. Their signature is new information rather
-- than a rewrite, so exactly that one column may be filled in once. Everything
-- else, including changing an already-recorded second approver, is refused.
create or replace function public.forbid_approval_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.batch_id is distinct from old.batch_id
     or new.approved_by is distinct from old.approved_by
     or new.business_reason is distinct from old.business_reason
     or new.second_approval_required is distinct from old.second_approval_required
     or new.approved_at is distinct from old.approved_at then
    raise exception 'import_approvals is append-only; only the second approver may be added'
      using errcode = 'check_violation';
  end if;
  if old.second_approved_by is not null
     and new.second_approved_by is distinct from old.second_approved_by then
    raise exception 'the second approver on approval % is already recorded', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_import_approvals_no_delete on public.import_approvals;
create trigger trg_import_approvals_no_delete
  before delete on public.import_approvals
  for each row execute function public.forbid_update_delete();

drop trigger if exists trg_import_approvals_no_rewrite on public.import_approvals;
create trigger trg_import_approvals_no_rewrite
  before update on public.import_approvals
  for each row execute function public.forbid_approval_rewrite();

-- audit_evidence predates this spec and was never guarded. The runtime only
-- appends, but "only appends" was a property of the code rather than of the
-- table.
drop trigger if exists trg_audit_evidence_append_only on public.audit_evidence;
create trigger trg_audit_evidence_append_only
  before update or delete on public.audit_evidence
  for each row execute function public.forbid_update_delete();

-- --------------------------------------------- 5. domain events are facts --
--
-- An event records that something happened. Processing state changes; the fact
-- does not. Allowing a payload edit would let a replay produce different work
-- from the same event.

create or replace function public.forbid_domain_event_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.source_id is distinct from old.source_id
     or new.event_type is distinct from old.event_type
     or new.object_type is distinct from old.object_type
     or new.object_id is distinct from old.object_id
     or new.account_id is distinct from old.account_id
     or new.external_event_id is distinct from old.external_event_id
     or new.occurred_at is distinct from old.occurred_at
     or new.payload is distinct from old.payload
     or new.payload_hash is distinct from old.payload_hash then
    raise exception 'domain_events is append-only; only processing state may change'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_domain_events_no_rewrite on public.domain_events;
create trigger trg_domain_events_no_rewrite
  before update on public.domain_events
  for each row execute function public.forbid_domain_event_rewrite();

drop trigger if exists trg_domain_events_no_delete on public.domain_events;
create trigger trg_domain_events_no_delete
  before delete on public.domain_events
  for each row execute function public.forbid_update_delete();

-- ----------------------------------- 6. executions record what happened --

create or replace function public.forbid_execution_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.trigger_version_id is distinct from old.trigger_version_id
     or new.domain_event_id is distinct from old.domain_event_id
     or new.correlation_id is distinct from old.correlation_id
     or new.started_at is distinct from old.started_at
     or new.is_replay is distinct from old.is_replay
     or new.replay_of_execution_id is distinct from old.replay_of_execution_id then
    raise exception 'trigger_executions may not rewrite what ran'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trigger_executions_no_rewrite on public.trigger_executions;
create trigger trg_trigger_executions_no_rewrite
  before update on public.trigger_executions
  for each row execute function public.forbid_execution_rewrite();

drop trigger if exists trg_trigger_executions_no_delete on public.trigger_executions;
create trigger trg_trigger_executions_no_delete
  before delete on public.trigger_executions
  for each row execute function public.forbid_update_delete();
