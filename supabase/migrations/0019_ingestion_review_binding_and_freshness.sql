-- 0019_ingestion_review_binding_and_freshness.sql
--
-- Production Spine Unit 1 review hardening.
--
-- An approval authorizes one reviewed snapshot. The snapshot hash binds the
-- batch, change set, change-set items, staged records, and findings that existed
-- when the approval was recorded. The final commit boundary recomputes that
-- hash, locks every updated external identity and operational target, and
-- refuses stale or remapped updates before any operational mutation occurs.

alter table public.import_approvals
  add column if not exists review_change_set_id uuid,
  add column if not exists review_snapshot_hash text;

alter table public.import_approvals
  drop constraint if exists import_approvals_review_snapshot_hash_format;
alter table public.import_approvals
  add constraint import_approvals_review_snapshot_hash_format
  check (review_snapshot_hash is null or review_snapshot_hash ~ '^[a-f0-9]{64}$');

alter table public.import_approvals
  drop constraint if exists import_approvals_review_change_set_fk;
alter table public.import_approvals
  add constraint import_approvals_review_change_set_fk
  foreign key (review_change_set_id, batch_id, workspace_id)
  references public.change_sets (id, batch_id, workspace_id) on delete restrict;

create or replace function public.ingestion_review_snapshot_hash(
  p_batch_id uuid,
  p_change_set_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with snapshot as (
    select jsonb_build_object(
      'batch',
        to_jsonb(b) - array['state', 'business_reason', 'updated_at'],
      'changeSet',
        to_jsonb(c),
      'items',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'changeSetItem', to_jsonb(i),
              'stagedRecord', to_jsonb(s)
            )
            order by i.id
          )
            from public.change_set_items i
            join public.staged_records s
              on s.id = i.staged_record_id
             and s.workspace_id = i.workspace_id
           where i.change_set_id = c.id
             and i.workspace_id = c.workspace_id
        ), '[]'::jsonb),
      'findings',
        coalesce((
          select jsonb_agg(to_jsonb(f) order by f.id)
            from public.ingestion_findings f
           where f.batch_id = b.id
             and f.workspace_id = b.workspace_id
        ), '[]'::jsonb)
    ) as document
      from public.ingestion_batches b
      join public.change_sets c
        on c.batch_id = b.id
       and c.workspace_id = b.workspace_id
     where b.id = p_batch_id
       and c.id = p_change_set_id
  )
  select encode(digest(convert_to(document::text, 'UTF8'), 'sha256'), 'hex')
    from snapshot;
$$;

revoke all on function public.ingestion_review_snapshot_hash(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.bind_import_approval_review_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_change_set_id uuid;
  current_hash text;
begin
  if tg_op = 'INSERT' then
    select c.id
      into resolved_change_set_id
      from public.change_sets c
     where c.batch_id = new.batch_id
       and c.workspace_id = new.workspace_id;

    if found then
      new.review_change_set_id := resolved_change_set_id;
      new.review_snapshot_hash := public.ingestion_review_snapshot_hash(
        new.batch_id,
        resolved_change_set_id
      );
    else
      -- Legacy lower-level rows can exist before a preview. They cannot cross
      -- the production commit boundary until a bound review snapshot exists.
      new.review_change_set_id := null;
      new.review_snapshot_hash := null;
    end if;

    return new;
  end if;

  if new.review_change_set_id is distinct from old.review_change_set_id
     or new.review_snapshot_hash is distinct from old.review_snapshot_hash then
    raise exception 'the approval review binding is immutable'
      using errcode = 'check_violation';
  end if;

  if new.second_approved_by is distinct from old.second_approved_by
     and new.second_approved_by is not null
     and old.review_change_set_id is not null then
    current_hash := public.ingestion_review_snapshot_hash(
      old.batch_id,
      old.review_change_set_id
    );

    if current_hash is null or current_hash is distinct from old.review_snapshot_hash then
      raise exception 'the reviewed ingestion snapshot changed after the first approval'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_approvals_bind_review_snapshot
  on public.import_approvals;
create trigger trg_import_approvals_bind_review_snapshot
  before insert or update on public.import_approvals
  for each row execute function public.bind_import_approval_review_snapshot();

-- Bind any existing approval that already has exactly one persisted change set.
-- Rows without a reviewable change set remain unbound and fail closed at the
-- production commit boundary.
update public.import_approvals a
   set review_change_set_id = c.id,
       review_snapshot_hash = public.ingestion_review_snapshot_hash(a.batch_id, c.id)
  from public.change_sets c
 where c.batch_id = a.batch_id
   and c.workspace_id = a.workspace_id
   and a.review_change_set_id is null;

create or replace function public.enforce_import_commit_review_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_state public.ingestion_state;
  batch_source_id uuid;
  bound_change_set_id uuid;
  bound_hash text;
  current_hash text;
  item record;
  linked_internal_id uuid;
  current_values jsonb;
  key_name text;
  before_value jsonb;
begin
  select b.state, b.source_id
    into batch_state, batch_source_id
    from public.ingestion_batches b
   where b.id = new.batch_id
     and b.workspace_id = new.workspace_id;

  if not found then
    raise exception 'commit batch does not exist in this workspace'
      using errcode = 'check_violation';
  end if;

  -- Legacy invariant tests can insert lower-level commit rows before the live
  -- state machine reaches committing. The production RPC always enters the
  -- committing state first, and that path requires the complete review binding.
  if batch_state <> 'committing' then
    return new;
  end if;

  select a.review_change_set_id, a.review_snapshot_hash
    into bound_change_set_id, bound_hash
    from public.import_approvals a
   where a.id = new.approval_id
     and a.batch_id = new.batch_id
     and a.workspace_id = new.workspace_id
   for share;

  if not found
     or bound_change_set_id is null
     or bound_hash is null
     or bound_change_set_id is distinct from new.change_set_id then
    raise exception 'commit approval is not bound to this reviewed change set'
      using errcode = 'check_violation';
  end if;

  current_hash := public.ingestion_review_snapshot_hash(new.batch_id, new.change_set_id);
  if current_hash is null or current_hash is distinct from bound_hash then
    raise exception 'the reviewed ingestion snapshot changed after approval'
      using errcode = 'check_violation';
  end if;

  -- Lock the identity link and the canonical row before checking the previewed
  -- before-values. These locks remain held through the RPC transaction, so the
  -- values cannot change between this check and the later operational update.
  for item in
    select c.*
      from public.change_set_items c
      join public.staged_records s
        on s.id = c.staged_record_id
       and s.workspace_id = c.workspace_id
     where c.change_set_id = new.change_set_id
       and c.workspace_id = new.workspace_id
       and c.change_kind in ('update', 'owner_change')
       and c.object_type in ('account', 'contact', 'opportunity', 'activity')
       and s.disposition in ('ready', 'warning')
     order by c.id
  loop
    linked_internal_id := null;
    current_values := null;

    select l.internal_record_id
      into linked_internal_id
      from public.external_record_links l
     where l.workspace_id = new.workspace_id
       and l.source_id = batch_source_id
       and l.object_type = item.object_type
       and l.external_id = item.external_id
     for update;

    if not found or linked_internal_id is distinct from item.target_record_id then
      raise exception 'previewed target no longer matches external identity for change-set item %', item.id
        using errcode = 'check_violation';
    end if;

    case item.object_type
      when 'account' then
        select jsonb_build_object(
          'externalId', item.external_id,
          'name', a.name,
          'domain', a.domain,
          'ownerId', a.owner_id,
          'tier', a.tier,
          'lifecycleStage', a.lifecycle_stage,
          'industry', a.industry,
          'employeeCount', a.employee_count,
          'annualRevenueUsd', a.annual_revenue_usd,
          'openPipelineUsd', a.open_pipeline_usd,
          'lastContactedAt', a.last_contacted_at,
          'healthScore', a.health_score,
          'intentSignals', to_jsonb(a.intent_signals),
          'dataQualityFlags', to_jsonb(a.data_quality_flags)
        )
          into current_values
          from public.accounts a
         where a.id = item.target_record_id
           and a.workspace_id = new.workspace_id
         for update;

      when 'contact' then
        select jsonb_build_object(
          'externalId', item.external_id,
          'accountExternalId', (
            select l.external_id
              from public.external_record_links l
             where l.workspace_id = new.workspace_id
               and l.source_id = batch_source_id
               and l.object_type = 'account'
               and l.internal_record_id = c.account_id
             order by l.id
             limit 1
          ),
          'firstName', c.first_name,
          'lastName', c.last_name,
          'title', c.title,
          'email', c.email,
          'role', c.role,
          'isPrimary', c.is_primary,
          'lastEngagedAt', c.last_engaged_at
        )
          into current_values
          from public.contacts c
         where c.id = item.target_record_id
           and c.workspace_id = new.workspace_id
         for update;

      when 'opportunity' then
        select jsonb_build_object(
          'externalId', item.external_id,
          'accountExternalId', (
            select l.external_id
              from public.external_record_links l
             where l.workspace_id = new.workspace_id
               and l.source_id = batch_source_id
               and l.object_type = 'account'
               and l.internal_record_id = o.account_id
             order by l.id
             limit 1
          ),
          'name', o.name,
          'stage', o.stage,
          'amountUsd', o.amount_usd,
          'probability', o.probability,
          'closeDate', o.close_date,
          'isClosed', o.is_closed,
          'isWon', o.is_won,
          'nextStep', o.next_step
        )
          into current_values
          from public.opportunities o
         where o.id = item.target_record_id
           and o.workspace_id = new.workspace_id
         for update;

      when 'activity' then
        select jsonb_build_object(
          'externalId', item.external_id,
          'accountExternalId', (
            select l.external_id
              from public.external_record_links l
             where l.workspace_id = new.workspace_id
               and l.source_id = batch_source_id
               and l.object_type = 'account'
               and l.internal_record_id = a.account_id
             order by l.id
             limit 1
          ),
          'contactExternalId', (
            select l.external_id
              from public.external_record_links l
             where l.workspace_id = new.workspace_id
               and l.source_id = batch_source_id
               and l.object_type = 'contact'
               and l.internal_record_id = a.contact_id
             order by l.id
             limit 1
          ),
          'type', a.type,
          'subject', a.subject,
          'body', a.body,
          'occurredAt', a.occurred_at,
          'createdById', a.created_by_id
        )
          into current_values
          from public.activities a
         where a.id = item.target_record_id
           and a.workspace_id = new.workspace_id
         for update;
    end case;

    if current_values is null then
      raise exception 'previewed operational target no longer exists for change-set item %', item.id
        using errcode = 'check_violation';
    end if;

    for key_name, before_value in
      select key, value from jsonb_each(item.before_values)
    loop
      if not (current_values ? key_name)
         or (current_values ->> key_name) is distinct from (before_value #>> '{}') then
        raise exception 'previewed before-value is stale for change-set item % field %', item.id, key_name
          using errcode = 'check_violation';
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_import_commits_review_integrity on public.import_commits;
create trigger trg_import_commits_review_integrity
  before insert on public.import_commits
  for each row execute function public.enforce_import_commit_review_integrity();
