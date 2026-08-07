-- 0017_ingestion_atomic_commit_rpc.sql
--
-- Production Spine Unit 1.
--
-- Browser requests can ask to approve or commit a reviewed import, but they do
-- not supply workspace, change-set, approval, staged-row, or operational data.
-- Both functions reload those facts from the database, bind the action to
-- auth.uid(), and fail closed. The commit function performs the operational
-- mutation, lineage write, domain-event creation, audit write, and batch-state
-- transition in one PostgreSQL transaction.

-- One batch has one approval record. A second person adds the second signature
-- to that record; creating a second approval row would make it ambiguous which
-- payload the commit was authorized to apply.
do $$
begin
  if exists (
    select batch_id
      from public.import_approvals
     group by batch_id
    having count(*) > 1
  ) then
    raise exception 'cannot enforce one approval per batch while duplicate approvals exist'
      using errcode = 'check_violation';
  end if;
end $$;

create unique index if not exists import_approvals_one_per_batch_idx
  on public.import_approvals (batch_id);

-- The application Account contract permits decimal health values. The original
-- table used integer, which would force a lossy rounding step for an approved
-- account-health import. Store the accepted number exactly instead.
alter table public.accounts
  alter column health_score type numeric using health_score::numeric;

-- Resolve a parent account through the same source identity namespace as the
-- imported child record. Cross-workspace and cross-source references therefore
-- cannot be manufactured by a caller.
create or replace function public.resolve_import_account(
  ws uuid,
  source uuid,
  external_account_id text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.internal_record_id
    from public.external_record_links l
    join public.accounts a
      on a.id = l.internal_record_id
     and a.workspace_id = l.workspace_id
   where l.workspace_id = ws
     and l.source_id = source
     and l.object_type = 'account'
     and l.external_id = external_account_id
   limit 1;
$$;

revoke all on function public.resolve_import_account(uuid, uuid, text) from public, anon, authenticated;

-- Approval is a server-resolved operation. The function recomputes the hard
-- default second-approval thresholds from the persisted change set instead of
-- accepting a boolean supplied by the browser.
create or replace function public.approve_ingestion_batch(
  p_batch_id uuid,
  p_business_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_user uuid := auth.uid();
  batch_row public.ingestion_batches%rowtype;
  change_row public.change_sets%rowtype;
  approval_row public.import_approvals%rowtype;
  total_accounts bigint := 0;
  records_changed integer := 0;
  needs_second boolean := false;
  reasons text[] := array[]::text[];
  result_status text;
begin
  if request_user is null then
    raise exception 'authentication is required to approve an import'
      using errcode = 'insufficient_privilege';
  end if;

  if p_business_reason is null
     or char_length(btrim(p_business_reason)) < 10
     or char_length(btrim(p_business_reason)) > 1000 then
    raise exception 'business reason must contain 10 to 1000 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  select *
    into batch_row
    from public.ingestion_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'ingestion batch was not found'
      using errcode = 'no_data_found';
  end if;

  if not public.is_workspace_admin_user(batch_row.workspace_id, request_user) then
    raise exception 'only a workspace administrator can approve this import'
      using errcode = 'insufficient_privilege';
  end if;

  if batch_row.state not in ('ready_for_review', 'awaiting_approval') then
    raise exception 'batch % is in state %, not ready for approval', p_batch_id, batch_row.state
      using errcode = 'check_violation';
  end if;

  if batch_row.name is null or batch_row.mapping_version_id is null then
    raise exception 'batch name and mapping version are required before approval'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
      from public.ingestion_findings f
     where f.batch_id = p_batch_id
       and f.workspace_id = batch_row.workspace_id
       and (f.disposition = 'hard_block' or public.is_hard_block_rule(f.rule_id))
  ) then
    raise exception 'a hard-block finding prohibits approval'
      using errcode = 'check_violation';
  end if;

  select *
    into change_row
    from public.change_sets
   where batch_id = p_batch_id
     and workspace_id = batch_row.workspace_id;

  if not found then
    raise exception 'a persisted change set is required before approval'
      using errcode = 'check_violation';
  end if;

  records_changed := change_row.new_records + change_row.updated_records;
  select count(*) into total_accounts
    from public.accounts
   where workspace_id = batch_row.workspace_id;

  if records_changed > 10000 then
    reasons := array_append(reasons, records_changed::text || ' operational records change');
  end if;

  if total_accounts > 0
     and records_changed::numeric / total_accounts::numeric > 0.10 then
    reasons := array_append(
      reasons,
      round(records_changed::numeric / total_accounts::numeric * 100)::text ||
        ' percent of workspace accounts change'
    );
  end if;

  if total_accounts > 0
     and change_row.owner_changes::numeric / total_accounts::numeric > 0.05 then
    reasons := array_append(
      reasons,
      round(change_row.owner_changes::numeric / total_accounts::numeric * 100)::text ||
        ' percent of account owners change'
    );
  end if;

  if abs(change_row.pipeline_delta_usd) > 10000000 then
    reasons := array_append(
      reasons,
      'absolute pipeline delta exceeds $10,000,000'
    );
  end if;

  needs_second := cardinality(reasons) > 0;

  select *
    into approval_row
    from public.import_approvals
   where batch_id = p_batch_id
     and workspace_id = batch_row.workspace_id
   for update;

  if not found then
    if batch_row.state = 'ready_for_review' then
      update public.ingestion_batches
         set state = 'awaiting_approval',
             business_reason = btrim(p_business_reason)
       where id = p_batch_id;
    else
      update public.ingestion_batches
         set business_reason = btrim(p_business_reason)
       where id = p_batch_id;
    end if;

    insert into public.import_approvals (
      workspace_id,
      batch_id,
      approved_by,
      business_reason,
      second_approval_required
    ) values (
      batch_row.workspace_id,
      p_batch_id,
      request_user,
      btrim(p_business_reason),
      needs_second
    )
    returning * into approval_row;

    insert into public.audit_evidence (
      workspace_id,
      actor_id,
      action,
      decision,
      reason,
      evidence
    ) values (
      batch_row.workspace_id,
      request_user::text,
      'ingestion.import_approval',
      'approved',
      btrim(p_business_reason),
      jsonb_build_object(
        'batchId', p_batch_id,
        'approvalId', approval_row.id,
        'secondApprovalRequired', needs_second,
        'approvalOrdinal', 1
      )
    );
  else
    if approval_row.second_approval_required is distinct from needs_second then
      raise exception 'persisted approval requirement no longer matches the change set'
        using errcode = 'check_violation';
    end if;

    if approval_row.business_reason <> btrim(p_business_reason) then
      raise exception 'business reason does not match the recorded approval'
        using errcode = 'check_violation';
    end if;

    if needs_second and approval_row.second_approved_by is null then
      if approval_row.approved_by <> request_user then
        update public.import_approvals
           set second_approved_by = request_user
         where id = approval_row.id
        returning * into approval_row;

        insert into public.audit_evidence (
          workspace_id,
          actor_id,
          action,
          decision,
          reason,
          evidence
        ) values (
          batch_row.workspace_id,
          request_user::text,
          'ingestion.import_second_approval',
          'approved',
          approval_row.business_reason,
          jsonb_build_object(
            'batchId', p_batch_id,
            'approvalId', approval_row.id,
            'approvalOrdinal', 2
          )
        );
      end if;
    end if;
  end if;

  result_status := case
    when approval_row.second_approval_required
         and approval_row.second_approved_by is null
      then 'awaiting_second_approval'
    else 'approved'
  end;

  return jsonb_build_object(
    'status', result_status,
    'approvalId', approval_row.id,
    'approvedBy', approval_row.approved_by,
    'secondApprovalRequired', approval_row.second_approval_required,
    'secondApprovedBy', approval_row.second_approved_by,
    'businessReason', approval_row.business_reason,
    'reasons', to_jsonb(reasons)
  );
end;
$$;

revoke all on function public.approve_ingestion_batch(uuid, text) from public, anon;
grant execute on function public.approve_ingestion_batch(uuid, text) to authenticated;

-- Apply the approved change set. Every input except the three immutable ids is
-- reloaded from persistence. The function locks the batch first, so a replay or
-- concurrent request cannot create a second commit after the state advances.
create or replace function public.commit_ingestion_batch(
  p_batch_id uuid,
  p_change_set_id uuid,
  p_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_user uuid := auth.uid();
  batch_row public.ingestion_batches%rowtype;
  change_row public.change_sets%rowtype;
  approval_row public.import_approvals%rowtype;
  item record;
  commit_row public.import_commits%rowtype;
  internal_id uuid;
  parent_account_id uuid;
  parent_contact_id uuid;
  affected_account_id uuid;
  records_created integer := 0;
  records_updated integer := 0;
  event_payload jsonb;
  event_hash text;
  changed_count integer := 0;
begin
  if request_user is null then
    raise exception 'authentication is required to commit an import'
      using errcode = 'insufficient_privilege';
  end if;

  select *
    into batch_row
    from public.ingestion_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'ingestion batch was not found'
      using errcode = 'no_data_found';
  end if;

  if not public.is_workspace_admin_user(batch_row.workspace_id, request_user) then
    raise exception 'only a workspace administrator can commit this import'
      using errcode = 'insufficient_privilege';
  end if;

  if batch_row.state <> 'awaiting_approval' then
    raise exception 'batch % is in state %, not awaiting approval', p_batch_id, batch_row.state
      using errcode = 'check_violation';
  end if;

  select *
    into change_row
    from public.change_sets
   where id = p_change_set_id
     and batch_id = p_batch_id
     and workspace_id = batch_row.workspace_id;

  if not found then
    raise exception 'change set does not belong to the requested batch'
      using errcode = 'check_violation';
  end if;

  select *
    into approval_row
    from public.import_approvals
   where id = p_approval_id
     and batch_id = p_batch_id
     and workspace_id = batch_row.workspace_id
   for share;

  if not found then
    raise exception 'approval does not belong to the requested batch'
      using errcode = 'check_violation';
  end if;

  if approval_row.second_approval_required and approval_row.second_approved_by is null then
    raise exception 'the required second approval has not been recorded'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
      from public.ingestion_findings f
     where f.batch_id = p_batch_id
       and f.workspace_id = batch_row.workspace_id
       and (f.disposition = 'hard_block' or public.is_hard_block_rule(f.rule_id))
  ) then
    raise exception 'a hard-block finding prohibits commit'
      using errcode = 'check_violation';
  end if;

  -- A committable preview item must still describe the exact staged row that
  -- passed validation. A stale or edited preview is a refusal, not a merge.
  if exists (
    select 1
      from public.change_set_items c
      join public.staged_records s
        on s.id = c.staged_record_id
       and s.workspace_id = c.workspace_id
     where c.change_set_id = p_change_set_id
       and c.workspace_id = batch_row.workspace_id
       and s.disposition in ('ready', 'warning')
       and c.change_kind <> 'unchanged'
       and (
         c.external_id <> s.external_id
         or c.object_type <> s.object_type
         or not (s.normalized_payload @> c.after_values)
       )
  ) then
    raise exception 'change set no longer matches validated staged data'
      using errcode = 'check_violation';
  end if;

  -- The current production spine has canonical operational storage for these
  -- six source object classes. A future object must earn and implement its own
  -- persistence semantics before this boundary may accept it.
  if exists (
    select 1
      from public.change_set_items c
      join public.staged_records s on s.id = c.staged_record_id
     where c.change_set_id = p_change_set_id
       and s.disposition in ('ready', 'warning')
       and c.change_kind <> 'unchanged'
       and c.object_type not in (
         'account', 'contact', 'opportunity', 'activity', 'intent_signal', 'account_health'
       )
  ) then
    raise exception 'change set contains an object type without production persistence semantics'
      using errcode = 'check_violation';
  end if;

  select count(*)
    into changed_count
    from public.change_set_items c
    join public.staged_records s
      on s.id = c.staged_record_id
     and s.workspace_id = c.workspace_id
   where c.change_set_id = p_change_set_id
     and c.workspace_id = batch_row.workspace_id
     and s.disposition in ('ready', 'warning')
     and c.change_kind <> 'unchanged';

  if changed_count = 0 then
    raise exception 'change set has no committable operational changes'
      using errcode = 'check_violation';
  end if;

  update public.ingestion_batches
     set state = 'committing'
   where id = p_batch_id;

  select count(*) filter (where c.change_kind = 'create'),
         count(*) filter (where c.change_kind in ('update', 'owner_change'))
    into records_created, records_updated
    from public.change_set_items c
    join public.staged_records s
      on s.id = c.staged_record_id
     and s.workspace_id = c.workspace_id
   where c.change_set_id = p_change_set_id
     and c.workspace_id = batch_row.workspace_id
     and s.disposition in ('ready', 'warning')
     and c.change_kind <> 'unchanged';

  insert into public.import_commits (
    workspace_id,
    batch_id,
    change_set_id,
    approval_id,
    committed_by,
    records_created,
    records_updated
  ) values (
    batch_row.workspace_id,
    p_batch_id,
    p_change_set_id,
    p_approval_id,
    request_user,
    records_created,
    records_updated
  )
  returning * into commit_row;

  for item in
    select
      c.*,
      s.disposition,
      s.normalized_payload,
      s.source_row_number
    from public.change_set_items c
    join public.staged_records s
      on s.id = c.staged_record_id
     and s.workspace_id = c.workspace_id
   where c.change_set_id = p_change_set_id
     and c.workspace_id = batch_row.workspace_id
     and s.disposition in ('ready', 'warning')
     and c.change_kind <> 'unchanged'
   order by s.source_row_number nulls last, c.id
  loop
    internal_id := null;
    parent_account_id := null;
    parent_contact_id := null;
    affected_account_id := null;

    case item.object_type
      when 'account' then
        if (item.after_values - array[
          'externalId', 'name', 'domain', 'ownerId', 'tier', 'lifecycleStage',
          'industry', 'employeeCount', 'annualRevenueUsd', 'openPipelineUsd',
          'lastContactedAt', 'healthScore', 'intentSignals', 'dataQualityFlags'
        ]) <> '{}'::jsonb then
          raise exception 'account change contains a field outside the operational Account contract'
            using errcode = 'check_violation';
        end if;

        if item.change_kind = 'create' then
          insert into public.accounts (
            workspace_id,
            name,
            domain,
            owner_id,
            tier,
            lifecycle_stage,
            industry,
            employee_count,
            annual_revenue_usd,
            open_pipeline_usd,
            last_contacted_at,
            health_score,
            intent_signals,
            data_quality_flags
          ) values (
            batch_row.workspace_id,
            item.after_values->>'name',
            item.after_values->>'domain',
            (item.after_values->>'ownerId')::uuid,
            (item.after_values->>'tier')::public.account_tier,
            (item.after_values->>'lifecycleStage')::public.lifecycle_stage,
            item.after_values->>'industry',
            (item.after_values->>'employeeCount')::integer,
            (item.after_values->>'annualRevenueUsd')::numeric,
            coalesce((item.after_values->>'openPipelineUsd')::numeric, 0),
            (item.after_values->>'lastContactedAt')::timestamptz,
            (item.after_values->>'healthScore')::numeric,
            case
              when jsonb_typeof(item.after_values->'intentSignals') = 'array'
                then array(select jsonb_array_elements_text(item.after_values->'intentSignals'))
              else '{}'::text[]
            end,
            case
              when jsonb_typeof(item.after_values->'dataQualityFlags') = 'array'
                then array(select jsonb_array_elements_text(item.after_values->'dataQualityFlags'))
              else '{}'::text[]
            end
          )
          returning id into internal_id;
        else
          update public.accounts a
             set name = case when item.after_values ? 'name' then item.after_values->>'name' else a.name end,
                 domain = case when item.after_values ? 'domain' then item.after_values->>'domain' else a.domain end,
                 owner_id = case when item.after_values ? 'ownerId' then (item.after_values->>'ownerId')::uuid else a.owner_id end,
                 tier = case when item.after_values ? 'tier' then (item.after_values->>'tier')::public.account_tier else a.tier end,
                 lifecycle_stage = case when item.after_values ? 'lifecycleStage' then (item.after_values->>'lifecycleStage')::public.lifecycle_stage else a.lifecycle_stage end,
                 industry = case when item.after_values ? 'industry' then item.after_values->>'industry' else a.industry end,
                 employee_count = case when item.after_values ? 'employeeCount' then (item.after_values->>'employeeCount')::integer else a.employee_count end,
                 annual_revenue_usd = case when item.after_values ? 'annualRevenueUsd' then (item.after_values->>'annualRevenueUsd')::numeric else a.annual_revenue_usd end,
                 open_pipeline_usd = case when item.after_values ? 'openPipelineUsd' then (item.after_values->>'openPipelineUsd')::numeric else a.open_pipeline_usd end,
                 last_contacted_at = case when item.after_values ? 'lastContactedAt' then (item.after_values->>'lastContactedAt')::timestamptz else a.last_contacted_at end,
                 health_score = case when item.after_values ? 'healthScore' then (item.after_values->>'healthScore')::numeric else a.health_score end,
                 intent_signals = case
                   when item.after_values ? 'intentSignals'
                     then array(select jsonb_array_elements_text(item.after_values->'intentSignals'))
                   else a.intent_signals
                 end,
                 data_quality_flags = case
                   when item.after_values ? 'dataQualityFlags'
                     then array(select jsonb_array_elements_text(item.after_values->'dataQualityFlags'))
                   else a.data_quality_flags
                 end
           where a.id = item.target_record_id
             and a.workspace_id = batch_row.workspace_id
          returning a.id into internal_id;
        end if;
        affected_account_id := internal_id;

      when 'contact' then
        if (item.after_values - array[
          'externalId', 'accountExternalId', 'firstName', 'lastName', 'title',
          'email', 'role', 'isPrimary', 'lastEngagedAt'
        ]) <> '{}'::jsonb then
          raise exception 'contact change contains a field outside the operational Contact contract'
            using errcode = 'check_violation';
        end if;

        if item.after_values ? 'accountExternalId' then
          parent_account_id := public.resolve_import_account(
            batch_row.workspace_id,
            batch_row.source_id,
            item.after_values->>'accountExternalId'
          );
          if parent_account_id is null then
            raise exception 'contact parent account does not resolve in this source and workspace'
              using errcode = 'check_violation';
          end if;
        end if;

        if item.change_kind = 'create' then
          if parent_account_id is null then
            raise exception 'contact create requires accountExternalId'
              using errcode = 'check_violation';
          end if;
          insert into public.contacts (
            workspace_id, account_id, first_name, last_name, title, email, role,
            is_primary, last_engaged_at
          ) values (
            batch_row.workspace_id,
            parent_account_id,
            item.after_values->>'firstName',
            item.after_values->>'lastName',
            item.after_values->>'title',
            item.after_values->>'email',
            coalesce((item.after_values->>'role')::public.contact_role, 'unknown'),
            coalesce((item.after_values->>'isPrimary')::boolean, false),
            (item.after_values->>'lastEngagedAt')::timestamptz
          )
          returning id, account_id into internal_id, affected_account_id;
        else
          update public.contacts c
             set account_id = coalesce(parent_account_id, c.account_id),
                 first_name = case when item.after_values ? 'firstName' then item.after_values->>'firstName' else c.first_name end,
                 last_name = case when item.after_values ? 'lastName' then item.after_values->>'lastName' else c.last_name end,
                 title = case when item.after_values ? 'title' then item.after_values->>'title' else c.title end,
                 email = case when item.after_values ? 'email' then item.after_values->>'email' else c.email end,
                 role = case when item.after_values ? 'role' then (item.after_values->>'role')::public.contact_role else c.role end,
                 is_primary = case when item.after_values ? 'isPrimary' then (item.after_values->>'isPrimary')::boolean else c.is_primary end,
                 last_engaged_at = case when item.after_values ? 'lastEngagedAt' then (item.after_values->>'lastEngagedAt')::timestamptz else c.last_engaged_at end
           where c.id = item.target_record_id
             and c.workspace_id = batch_row.workspace_id
          returning c.id, c.account_id into internal_id, affected_account_id;
        end if;

      when 'opportunity' then
        if (item.after_values - array[
          'externalId', 'accountExternalId', 'name', 'stage', 'amountUsd',
          'probability', 'closeDate', 'isClosed', 'isWon', 'nextStep'
        ]) <> '{}'::jsonb then
          raise exception 'opportunity change contains a field outside the operational Opportunity contract'
            using errcode = 'check_violation';
        end if;

        if item.after_values ? 'accountExternalId' then
          parent_account_id := public.resolve_import_account(
            batch_row.workspace_id,
            batch_row.source_id,
            item.after_values->>'accountExternalId'
          );
          if parent_account_id is null then
            raise exception 'opportunity parent account does not resolve in this source and workspace'
              using errcode = 'check_violation';
          end if;
        end if;

        if item.change_kind = 'create' then
          if parent_account_id is null then
            raise exception 'opportunity create requires accountExternalId'
              using errcode = 'check_violation';
          end if;
          insert into public.opportunities (
            workspace_id, account_id, name, stage, amount_usd, probability,
            close_date, is_closed, is_won, next_step
          ) values (
            batch_row.workspace_id,
            parent_account_id,
            item.after_values->>'name',
            (item.after_values->>'stage')::public.opportunity_stage,
            coalesce((item.after_values->>'amountUsd')::numeric, 0),
            coalesce((item.after_values->>'probability')::numeric, 0),
            (item.after_values->>'closeDate')::timestamptz,
            coalesce((item.after_values->>'isClosed')::boolean, false),
            coalesce((item.after_values->>'isWon')::boolean, false),
            item.after_values->>'nextStep'
          )
          returning id, account_id into internal_id, affected_account_id;
        else
          update public.opportunities o
             set account_id = coalesce(parent_account_id, o.account_id),
                 name = case when item.after_values ? 'name' then item.after_values->>'name' else o.name end,
                 stage = case when item.after_values ? 'stage' then (item.after_values->>'stage')::public.opportunity_stage else o.stage end,
                 amount_usd = case when item.after_values ? 'amountUsd' then (item.after_values->>'amountUsd')::numeric else o.amount_usd end,
                 probability = case when item.after_values ? 'probability' then (item.after_values->>'probability')::numeric else o.probability end,
                 close_date = case when item.after_values ? 'closeDate' then (item.after_values->>'closeDate')::timestamptz else o.close_date end,
                 is_closed = case when item.after_values ? 'isClosed' then (item.after_values->>'isClosed')::boolean else o.is_closed end,
                 is_won = case when item.after_values ? 'isWon' then (item.after_values->>'isWon')::boolean else o.is_won end,
                 next_step = case when item.after_values ? 'nextStep' then item.after_values->>'nextStep' else o.next_step end
           where o.id = item.target_record_id
             and o.workspace_id = batch_row.workspace_id
          returning o.id, o.account_id into internal_id, affected_account_id;
        end if;

      when 'activity' then
        if (item.after_values - array[
          'externalId', 'accountExternalId', 'contactExternalId', 'type',
          'subject', 'body', 'occurredAt', 'createdById'
        ]) <> '{}'::jsonb then
          raise exception 'activity change contains a field outside the operational Activity contract'
            using errcode = 'check_violation';
        end if;

        if item.after_values ? 'accountExternalId' then
          parent_account_id := public.resolve_import_account(
            batch_row.workspace_id,
            batch_row.source_id,
            item.after_values->>'accountExternalId'
          );
          if parent_account_id is null then
            raise exception 'activity parent account does not resolve in this source and workspace'
              using errcode = 'check_violation';
          end if;
        end if;

        if item.after_values ? 'contactExternalId'
           and item.after_values->>'contactExternalId' is not null then
          select l.internal_record_id
            into parent_contact_id
            from public.external_record_links l
            join public.contacts c
              on c.id = l.internal_record_id
             and c.workspace_id = l.workspace_id
           where l.workspace_id = batch_row.workspace_id
             and l.source_id = batch_row.source_id
             and l.object_type = 'contact'
             and l.external_id = item.after_values->>'contactExternalId'
           limit 1;
          if parent_contact_id is null then
            raise exception 'activity contact does not resolve in this source and workspace'
              using errcode = 'check_violation';
          end if;
        end if;

        if item.change_kind = 'create' then
          if parent_account_id is null then
            raise exception 'activity create requires accountExternalId'
              using errcode = 'check_violation';
          end if;
          insert into public.activities (
            workspace_id, account_id, contact_id, type, subject, body,
            occurred_at, created_by_id, verified
          ) values (
            batch_row.workspace_id,
            parent_account_id,
            parent_contact_id,
            (item.after_values->>'type')::public.activity_type,
            item.after_values->>'subject',
            item.after_values->>'body',
            (item.after_values->>'occurredAt')::timestamptz,
            (item.after_values->>'createdById')::uuid,
            true
          )
          returning id, account_id into internal_id, affected_account_id;
        else
          update public.activities a
             set account_id = coalesce(parent_account_id, a.account_id),
                 contact_id = case when item.after_values ? 'contactExternalId' then parent_contact_id else a.contact_id end,
                 type = case when item.after_values ? 'type' then (item.after_values->>'type')::public.activity_type else a.type end,
                 subject = case when item.after_values ? 'subject' then item.after_values->>'subject' else a.subject end,
                 body = case when item.after_values ? 'body' then item.after_values->>'body' else a.body end,
                 occurred_at = case when item.after_values ? 'occurredAt' then (item.after_values->>'occurredAt')::timestamptz else a.occurred_at end,
                 created_by_id = case when item.after_values ? 'createdById' then (item.after_values->>'createdById')::uuid else a.created_by_id end
           where a.id = item.target_record_id
             and a.workspace_id = batch_row.workspace_id
          returning a.id, a.account_id into internal_id, affected_account_id;
        end if;

      when 'intent_signal' then
        if (item.after_values - array[
          'externalId', 'accountExternalId', 'signalType', 'observedAt', 'intensity', 'topic'
        ]) <> '{}'::jsonb then
          raise exception 'intent signal contains a field outside the accepted intent contract'
            using errcode = 'check_violation';
        end if;
        parent_account_id := public.resolve_import_account(
          batch_row.workspace_id,
          batch_row.source_id,
          item.after_values->>'accountExternalId'
        );
        if parent_account_id is null then
          raise exception 'intent signal parent account does not resolve in this source and workspace'
            using errcode = 'check_violation';
        end if;
        update public.accounts a
           set intent_signals = case
             when item.after_values->>'signalType' = any(a.intent_signals) then a.intent_signals
             else array_append(a.intent_signals, item.after_values->>'signalType')
           end
         where a.id = parent_account_id
           and a.workspace_id = batch_row.workspace_id
        returning a.id into internal_id;
        affected_account_id := parent_account_id;

      when 'account_health' then
        if (item.after_values - array[
          'externalId', 'accountExternalId', 'measuredAt', 'healthScore',
          'supportTicketsOpen', 'usageTrend'
        ]) <> '{}'::jsonb then
          raise exception 'account health contains a field outside the accepted health contract'
            using errcode = 'check_violation';
        end if;
        parent_account_id := public.resolve_import_account(
          batch_row.workspace_id,
          batch_row.source_id,
          item.after_values->>'accountExternalId'
        );
        if parent_account_id is null then
          raise exception 'account health parent account does not resolve in this source and workspace'
            using errcode = 'check_violation';
        end if;
        if not (item.after_values ? 'healthScore') then
          raise exception 'account health change has no healthScore to apply'
            using errcode = 'check_violation';
        end if;
        update public.accounts a
           set health_score = (item.after_values->>'healthScore')::numeric
         where a.id = parent_account_id
           and a.workspace_id = batch_row.workspace_id
        returning a.id into internal_id;
        affected_account_id := parent_account_id;
    end case;

    if internal_id is null then
      raise exception 'operational target was not found for change-set item %', item.id
        using errcode = 'check_violation';
    end if;

    insert into public.external_record_links (
      workspace_id,
      source_id,
      object_type,
      external_id,
      internal_record_id,
      last_commit_id,
      last_seen_at
    ) values (
      batch_row.workspace_id,
      batch_row.source_id,
      item.object_type,
      item.external_id,
      internal_id,
      commit_row.id,
      now()
    )
    on conflict (source_id, object_type, external_id)
    do update set
      internal_record_id = excluded.internal_record_id,
      last_commit_id = excluded.last_commit_id,
      last_seen_at = excluded.last_seen_at;

    insert into public.import_commit_items (
      workspace_id,
      commit_id,
      change_set_id,
      change_set_item_id,
      object_type,
      internal_record_id,
      change_kind
    ) values (
      batch_row.workspace_id,
      commit_row.id,
      p_change_set_id,
      item.id,
      item.object_type,
      internal_id,
      item.change_kind
    );

    event_payload := item.after_values || jsonb_build_object(
      'externalId', item.external_id,
      'sourceRowNumber', item.source_row_number
    );
    event_hash := encode(digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), 'hex');

    insert into public.domain_events (
      workspace_id,
      source_id,
      event_type,
      object_type,
      object_id,
      account_id,
      batch_id,
      commit_id,
      occurred_at,
      payload,
      payload_hash
    ) values (
      batch_row.workspace_id,
      batch_row.source_id,
      case
        when item.object_type = 'account' and item.change_kind = 'create' then 'account.created'::public.domain_event_type
        when item.object_type = 'account' and item.change_kind = 'owner_change' then 'account.owner_changed'::public.domain_event_type
        when item.object_type = 'account' then 'account.updated'::public.domain_event_type
        when item.object_type = 'contact' and item.change_kind = 'create' then 'contact.created'::public.domain_event_type
        when item.object_type = 'contact' then 'contact.updated'::public.domain_event_type
        when item.object_type = 'opportunity' and item.change_kind = 'create' then 'opportunity.created'::public.domain_event_type
        when item.object_type = 'opportunity' then 'opportunity.updated'::public.domain_event_type
        when item.object_type = 'activity' then 'activity.created'::public.domain_event_type
        when item.object_type = 'intent_signal' then 'intent.detected'::public.domain_event_type
        when item.object_type = 'account_health' then 'account_health.updated'::public.domain_event_type
        else null
      end,
      item.object_type,
      internal_id,
      affected_account_id,
      p_batch_id,
      commit_row.id,
      now(),
      event_payload,
      event_hash
    );
  end loop;

  -- The batch-level event is emitted in the same transaction as every row
  -- event and operational mutation. It is what downstream processing can use
  -- as the durable boundary for the accepted import.
  event_payload := jsonb_build_object(
    'batchId', p_batch_id,
    'commitId', commit_row.id,
    'recordsCreated', records_created,
    'recordsUpdated', records_updated
  );
  event_hash := encode(digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.domain_events (
    workspace_id,
    source_id,
    event_type,
    object_type,
    object_id,
    batch_id,
    commit_id,
    occurred_at,
    payload,
    payload_hash
  ) values (
    batch_row.workspace_id,
    batch_row.source_id,
    'manual_import.committed',
    coalesce(batch_row.object_type, 'account'),
    commit_row.id,
    p_batch_id,
    commit_row.id,
    now(),
    event_payload,
    event_hash
  );

  insert into public.audit_evidence (
    workspace_id,
    actor_id,
    action,
    decision,
    reason,
    evidence
  ) values (
    batch_row.workspace_id,
    request_user::text,
    'ingestion.import_commit',
    'approved',
    approval_row.business_reason,
    jsonb_build_object(
      'batchId', p_batch_id,
      'changeSetId', p_change_set_id,
      'approvalId', p_approval_id,
      'commitId', commit_row.id,
      'recordsCreated', records_created,
      'recordsUpdated', records_updated
    )
  );

  update public.ingestion_batches
     set state = 'committed'
   where id = p_batch_id;

  return jsonb_build_object(
    'status', 'committed',
    'batchId', p_batch_id,
    'commitId', commit_row.id,
    'recordsCreated', records_created,
    'recordsUpdated', records_updated,
    'state', 'committed'
  );
end;
$$;

revoke all on function public.commit_ingestion_batch(uuid, uuid, uuid) from public, anon;
grant execute on function public.commit_ingestion_batch(uuid, uuid, uuid) to authenticated;
