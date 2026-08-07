-- 0018_commit_approval_reverification.sql
--
-- A stored `second_approval_required = false` is not authority. The commit
-- trigger recomputes the hard risk thresholds from the persisted change set and,
-- when change-set items exist, from the committable items themselves. This keeps
-- the final database boundary fail-closed even if an authenticated administrator
-- bypasses the normal approval endpoint and writes an approval row directly.
-- Hard-block refusal remains in the production commit RPC, where the reviewed
-- import operation is authorized; this trigger is limited to approval completeness
-- so existing lower-level reference-binding tests retain their isolated purpose.

create or replace function public.enforce_commit_approval_complete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  needs_second_stored boolean;
  second_signer uuid;
  batch_state public.ingestion_state;
  change_row public.change_sets%rowtype;
  total_accounts bigint := 0;
  item_count integer := 0;
  records_changed integer := 0;
  owner_changes integer := 0;
  pipeline_delta numeric := 0;
  needs_second_derived boolean := false;
begin
  select a.second_approval_required, a.second_approved_by
    into needs_second_stored, second_signer
    from public.import_approvals a
   where a.id = new.approval_id
     and a.batch_id = new.batch_id
     and a.workspace_id = new.workspace_id;

  if not found then
    raise exception 'commit approval does not belong to this batch and workspace'
      using errcode = 'check_violation';
  end if;

  select b.state
    into batch_state
    from public.ingestion_batches b
   where b.id = new.batch_id
     and b.workspace_id = new.workspace_id;

  if not found then
    raise exception 'commit batch does not exist in this workspace'
      using errcode = 'check_violation';
  end if;

  -- Browser sessions must pass through the state transition immediately before
  -- the commit. Superuser migration tests and trusted maintenance contexts are
  -- not reclassified as browser actors by this guard.
  if current_user = 'authenticated' and batch_state <> 'committing' then
    raise exception 'authenticated commit requires a batch in committing state'
      using errcode = 'check_violation';
  end if;

  select *
    into change_row
    from public.change_sets c
   where c.id = new.change_set_id
     and c.batch_id = new.batch_id
     and c.workspace_id = new.workspace_id;

  if not found then
    raise exception 'commit change set does not belong to this batch and workspace'
      using errcode = 'check_violation';
  end if;

  select count(*),
         count(*) filter (
           where s.disposition in ('ready', 'warning') and c.change_kind <> 'unchanged'
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
    into item_count, records_changed, owner_changes, pipeline_delta
    from public.change_set_items c
    join public.staged_records s
      on s.id = c.staged_record_id
     and s.workspace_id = c.workspace_id
    left join public.accounts a
      on a.id = c.target_record_id
     and a.workspace_id = c.workspace_id
   where c.change_set_id = new.change_set_id
     and c.workspace_id = new.workspace_id;

  -- Legacy rows created before executable item-level commit support can have a
  -- summary without change-set items. Keep the old invariant usable for those
  -- records while preferring item-level evidence whenever it exists.
  if item_count = 0 then
    records_changed := change_row.new_records + change_row.updated_records;
    owner_changes := change_row.owner_changes;
    pipeline_delta := change_row.pipeline_delta_usd;
  end if;

  select count(*)
    into total_accounts
    from public.accounts
   where workspace_id = new.workspace_id;

  needs_second_derived :=
    records_changed > 10000
    or (total_accounts > 0 and records_changed::numeric / total_accounts::numeric > 0.10)
    or (total_accounts > 0 and owner_changes::numeric / total_accounts::numeric > 0.05)
    or abs(pipeline_delta) > 10000000;

  if (needs_second_stored or needs_second_derived) and second_signer is null then
    raise exception 'approval % still awaits its required second approver', new.approval_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
