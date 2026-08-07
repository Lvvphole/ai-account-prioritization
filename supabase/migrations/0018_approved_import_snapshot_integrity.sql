-- 0018_approved_import_snapshot_integrity.sql
--
-- An approval is meaningful only when the approved snapshot cannot change under
-- it. This migration verifies the persisted preview against the committable
-- items when the first approval is recorded and then freezes the batch inputs,
-- staged rows, change set, and change-set items. State may still advance through
-- the ingestion state machine.

create or replace function public.enforce_approval_matches_change_set()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  change_row public.change_sets%rowtype;
  total_accounts bigint := 0;
  actual_new integer := 0;
  actual_updated integer := 0;
  actual_unchanged integer := 0;
  actual_owner_changes integer := 0;
  actual_pipeline_delta numeric := 0;
  needs_second boolean := false;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select *
    into change_row
    from public.change_sets
   where batch_id = new.batch_id
     and workspace_id = new.workspace_id;

  if not found then
    raise exception 'approval requires a persisted change set'
      using errcode = 'check_violation';
  end if;

  select
    count(*) filter (
      where s.disposition in ('ready', 'warning') and c.change_kind = 'create'
    ),
    count(*) filter (
      where s.disposition in ('ready', 'warning') and c.change_kind in ('update', 'owner_change')
    ),
    count(*) filter (
      where s.disposition in ('ready', 'warning') and c.change_kind = 'unchanged'
    ),
    count(*) filter (
      where s.disposition in ('ready', 'warning') and c.change_kind = 'owner_change'
    ),
    coalesce(sum(
      case
        when s.disposition not in ('ready', 'warning') then 0
        when c.object_type <> 'account' then 0
        when c.change_kind = 'create' then
          coalesce((c.after_values->>'openPipelineUsd')::numeric, 0)
        when c.change_kind in ('update', 'owner_change')
             and c.after_values ? 'openPipelineUsd' then
          (c.after_values->>'openPipelineUsd')::numeric - coalesce(a.open_pipeline_usd, 0)
        else 0
      end
    ), 0)
    into actual_new, actual_updated, actual_unchanged, actual_owner_changes, actual_pipeline_delta
    from public.change_set_items c
    join public.staged_records s
      on s.id = c.staged_record_id
     and s.workspace_id = c.workspace_id
    left join public.accounts a
      on a.id = c.target_record_id
     and a.workspace_id = c.workspace_id
   where c.change_set_id = change_row.id
     and c.workspace_id = new.workspace_id;

  if change_row.new_records <> actual_new
     or change_row.updated_records <> actual_updated
     or change_row.unchanged_records <> actual_unchanged
     or change_row.owner_changes <> actual_owner_changes
     or abs(change_row.pipeline_delta_usd - actual_pipeline_delta) > 0.01 then
    raise exception 'change-set summary does not match the persisted committable items'
      using errcode = 'check_violation';
  end if;

  select count(*)
    into total_accounts
    from public.accounts
   where workspace_id = new.workspace_id;

  needs_second :=
    (actual_new + actual_updated > 10000)
    or (
      total_accounts > 0
      and (actual_new + actual_updated)::numeric / total_accounts::numeric > 0.10
    )
    or (
      total_accounts > 0
      and actual_owner_changes::numeric / total_accounts::numeric > 0.05
    )
    or abs(actual_pipeline_delta) > 10000000;

  if new.second_approval_required is distinct from needs_second then
    raise exception 'approval requirement does not match deterministic risk thresholds'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_approvals_change_set_integrity on public.import_approvals;
create trigger trg_import_approvals_change_set_integrity
  before insert on public.import_approvals
  for each row execute function public.enforce_approval_matches_change_set();

create or replace function public.forbid_approved_batch_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.import_approvals a
     where a.batch_id = old.id and a.workspace_id = old.workspace_id
  ) and (
    new.workspace_id is distinct from old.workspace_id
    or new.source_id is distinct from old.source_id
    or new.object_type is distinct from old.object_type
    or new.mapping_version_id is distinct from old.mapping_version_id
    or new.name is distinct from old.name
    or new.business_reason is distinct from old.business_reason
    or new.total_rows is distinct from old.total_rows
    or new.ready_rows is distinct from old.ready_rows
    or new.warning_rows is distinct from old.warning_rows
    or new.quarantined_rows is distinct from old.quarantined_rows
    or new.rejected_rows is distinct from old.rejected_rows
    or new.duplicate_rows is distinct from old.duplicate_rows
  ) then
    raise exception 'approved ingestion batch inputs are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ingestion_batches_approved_snapshot on public.ingestion_batches;
create trigger trg_ingestion_batches_approved_snapshot
  before update on public.ingestion_batches
  for each row execute function public.forbid_approved_batch_rewrite();

create or replace function public.forbid_approved_staged_record_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  candidate_batch uuid := coalesce(new.batch_id, old.batch_id);
  candidate_workspace uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if exists (
    select 1 from public.import_approvals a
     where a.batch_id = candidate_batch and a.workspace_id = candidate_workspace
  ) then
    raise exception 'staged records are immutable after approval'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_staged_records_approved_snapshot on public.staged_records;
create trigger trg_staged_records_approved_snapshot
  before insert or update or delete on public.staged_records
  for each row execute function public.forbid_approved_staged_record_rewrite();

create or replace function public.forbid_approved_change_set_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$;
declare
  candidate_batch uuid := coalesce(new.batch_id, old.batch_id);
  candidate_workspace uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if exists (
    select 1 from public.import_approvals a
     where a.batch_id = candidate_batch and a.workspace_id = candidate_workspace
  ) then
    raise exception 'change set is immutable after approval'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_change_sets_approved_snapshot on public.change_sets;
create trigger trg_change_sets_approved_snapshot
  before insert or update or delete on public.change_sets
  for each row execute function public.forbid_approved_change_set_rewrite();

create or replace function public.forbid_approved_change_set_item_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$;
declare
  candidate_set uuid := coalesce(new.change_set_id, old.change_set_id);
  candidate_workspace uuid := coalesce(new.workspace_id, old.workspace_id);
  candidate_batch uuid;
begin
  select c.batch_id
    into candidate_batch
    from public.change_sets c
   where c.id = candidate_set and c.workspace_id = candidate_workspace;

  if candidate_batch is not null and exists (
    select 1 from public.import_approvals a
     where a.batch_id = candidate_batch and a.workspace_id = candidate_workspace
  ) then
    raise exception 'change-set items are immutable after approval'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_change_set_items_approved_snapshot on public.change_set_items;
create trigger trg_change_set_items_approved_snapshot
  before insert or update or delete on public.change_set_items
  for each row execute function public.forbid_approved_change_set_item_rewrite();
