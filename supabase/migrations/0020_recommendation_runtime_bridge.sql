-- 0020_recommendation_runtime_bridge.sql
-- Durable publication bridge from the verified runtime to the live web read path.
-- The service role writes through SECURITY DEFINER functions. Tenant/workspace
-- identity is derived from canonical accounts and is never accepted from runtime
-- or model output.

alter table public.recommendations
  add column if not exists runtime_recommendation_id text;

update public.recommendations
set runtime_recommendation_id = 'legacy:' || id::text
where runtime_recommendation_id is null;

alter table public.recommendations
  alter column runtime_recommendation_id set not null;

create unique index if not exists recommendations_workspace_runtime_id_uq
  on public.recommendations (workspace_id, runtime_recommendation_id);

comment on column public.recommendations.runtime_recommendation_id is
  'Application recommendation identifier. The database UUID remains the storage identity.';

-- Runtime audit writes must derive workspace_id from the canonical account. The
-- audit table requires workspace_id, so direct inserts that omit it cannot be a
-- valid production path.
create or replace function public.append_runtime_audit_evidence(p_entry jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_workspace_id uuid;
  v_audit_id uuid;
begin
  if jsonb_typeof(p_entry) is distinct from 'object' then
    raise exception 'runtime audit entry must be a JSON object';
  end if;

  v_account_id := nullif(btrim(p_entry ->> 'accountId'), '')::uuid;
  if v_account_id is null then
    raise exception 'runtime audit entry requires accountId for workspace binding';
  end if;

  select a.workspace_id
    into v_workspace_id
    from public.accounts a
   where a.id = v_account_id;

  if not found then
    raise exception 'runtime audit account % does not exist', v_account_id;
  end if;

  insert into public.audit_evidence (
    workspace_id,
    run_id,
    account_id,
    actor_id,
    action,
    decision,
    reason,
    evidence,
    occurred_at
  ) values (
    v_workspace_id,
    nullif(btrim(p_entry ->> 'runId'), ''),
    v_account_id,
    nullif(btrim(p_entry ->> 'actorId'), ''),
    nullif(btrim(p_entry ->> 'action'), ''),
    (p_entry ->> 'decision')::public.audit_decision,
    nullif(btrim(p_entry ->> 'reason'), ''),
    coalesce(p_entry -> 'evidence', '{}'::jsonb),
    (p_entry ->> 'occurredAt')::timestamptz
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

revoke all on function public.append_runtime_audit_evidence(jsonb)
  from public, anon, authenticated;
grant execute on function public.append_runtime_audit_evidence(jsonb)
  to service_role;

-- Persist one verified published set. Exact replay is idempotent. Reuse of an
-- application recommendation id with different content is rejected. All rows in
-- one call must belong to one owner, run, and canonical workspace; this prevents
-- the service-role runtime from publishing a rank that was computed across tenant
-- boundaries.
create or replace function public.persist_published_recommendations(p_recommendations jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_input_count integer;
  v_unique_count integer;
  v_runtime_id text;
  v_run_id text;
  v_account_id uuid;
  v_owner_id uuid;
  v_account_owner_id uuid;
  v_workspace_id uuid;
  v_score numeric;
  v_rank integer;
  v_confidence numeric;
  v_reason_codes text[];
  v_approval_status public.approval_status;
  v_published boolean;
  v_created_at timestamptz;
  v_inserted integer;
  v_existing public.recommendations%rowtype;
  v_run_workspace_id uuid;
  v_run_owner_id uuid;
  v_first_run_id text;
  v_persisted_count integer;
begin
  if jsonb_typeof(p_recommendations) is distinct from 'array' then
    raise exception 'published recommendations must be a JSON array';
  end if;

  v_input_count := jsonb_array_length(p_recommendations);
  if v_input_count = 0 then
    return 0;
  end if;

  select count(distinct nullif(btrim(item ->> 'id'), ''))
    into v_unique_count
    from jsonb_array_elements(p_recommendations) as items(item);

  if v_unique_count <> v_input_count then
    raise exception 'published recommendation ids must be present and unique';
  end if;

  for v_item in
    select item from jsonb_array_elements(p_recommendations) as items(item)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'each published recommendation must be a JSON object';
    end if;

    v_runtime_id := nullif(btrim(v_item ->> 'id'), '');
    v_run_id := nullif(btrim(v_item ->> 'runId'), '');
    v_account_id := nullif(btrim(v_item ->> 'accountId'), '')::uuid;
    v_owner_id := nullif(btrim(v_item ->> 'ownerId'), '')::uuid;
    v_score := (v_item ->> 'score')::numeric;
    v_rank := (v_item ->> 'rank')::integer;
    v_confidence := (v_item ->> 'confidence')::numeric;
    v_approval_status := (v_item ->> 'approvalStatus')::public.approval_status;
    v_published := coalesce((v_item ->> 'published')::boolean, false);
    v_created_at := (v_item ->> 'createdAt')::timestamptz;

    if v_runtime_id is null or v_run_id is null or v_account_id is null or v_owner_id is null then
      raise exception 'published recommendation identity fields are required';
    end if;

    if not v_published then
      raise exception 'recommendation % is not marked published', v_runtime_id;
    end if;

    if jsonb_typeof(v_item -> 'verification') is distinct from 'object'
       or v_item #>> '{verification,status}' is distinct from 'passed'
       or not coalesce((v_item #>> '{verification,schemaValid}')::boolean, false)
       or not coalesce((v_item #>> '{verification,guardrailsPassed}')::boolean, false)
       or not coalesce((v_item #>> '{verification,sourceSignalsVerified}')::boolean, false)
       or not coalesce((v_item #>> '{verification,permissionGranted}')::boolean, false) then
      raise exception 'recommendation % has not passed deterministic verification', v_runtime_id;
    end if;

    if jsonb_typeof(v_item -> 'reasonCodes') is distinct from 'array' then
      raise exception 'recommendation % reasonCodes must be an array', v_runtime_id;
    end if;

    select coalesce(array_agg(code.value order by code.ordinality), array[]::text[])
      into v_reason_codes
      from jsonb_array_elements_text(v_item -> 'reasonCodes')
           with ordinality as code(value, ordinality);

    if cardinality(v_reason_codes) = 0 then
      raise exception 'recommendation % requires at least one reason code', v_runtime_id;
    end if;

    if jsonb_typeof(v_item -> 'sourceSignals') is distinct from 'array'
       or jsonb_array_length(v_item -> 'sourceSignals') = 0 then
      raise exception 'recommendation % requires source signals', v_runtime_id;
    end if;

    if exists (
      select 1
        from jsonb_array_elements(v_item -> 'sourceSignals') as signals(signal)
       where not coalesce((signal ->> 'verified')::boolean, false)
    ) then
      raise exception 'recommendation % contains an unverified source signal', v_runtime_id;
    end if;

    if jsonb_typeof(v_item -> 'nextBestAction') is distinct from 'object' then
      raise exception 'recommendation % nextBestAction must be an object', v_runtime_id;
    end if;

    if (
      coalesce((v_item #>> '{nextBestAction,customerFacing}')::boolean, false)
      or coalesce((v_item #>> '{nextBestAction,crmWriteBack}')::boolean, false)
    ) and v_approval_status is distinct from 'approved'::public.approval_status then
      raise exception 'recommendation % requires explicit approval', v_runtime_id;
    end if;

    select a.workspace_id, a.owner_id
      into v_workspace_id, v_account_owner_id
      from public.accounts a
     where a.id = v_account_id;

    if not found then
      raise exception 'recommendation % account % does not exist', v_runtime_id, v_account_id;
    end if;

    if v_account_owner_id is distinct from v_owner_id then
      raise exception 'recommendation % owner does not match canonical account owner', v_runtime_id;
    end if;

    if v_run_workspace_id is null then
      v_run_workspace_id := v_workspace_id;
      v_run_owner_id := v_owner_id;
      v_first_run_id := v_run_id;
    elsif v_workspace_id is distinct from v_run_workspace_id
       or v_owner_id is distinct from v_run_owner_id
       or v_run_id is distinct from v_first_run_id then
      raise exception 'one persisted recommendation set must have one workspace, owner, and run';
    end if;

    insert into public.recommendations (
      workspace_id,
      runtime_recommendation_id,
      run_id,
      account_id,
      owner_id,
      score,
      rank,
      confidence,
      reason_codes,
      reason_narrative,
      next_best_action,
      source_signals,
      verification,
      approval_status,
      published,
      created_at
    ) values (
      v_workspace_id,
      v_runtime_id,
      v_run_id,
      v_account_id,
      v_owner_id,
      v_score,
      v_rank,
      v_confidence,
      v_reason_codes,
      nullif(btrim(v_item ->> 'reasonNarrative'), ''),
      v_item -> 'nextBestAction',
      v_item -> 'sourceSignals',
      v_item -> 'verification',
      v_approval_status,
      true,
      v_created_at
    )
    on conflict (workspace_id, runtime_recommendation_id) do nothing;

    get diagnostics v_inserted = row_count;

    select r.*
      into v_existing
      from public.recommendations r
     where r.workspace_id = v_workspace_id
       and r.runtime_recommendation_id = v_runtime_id;

    if not found then
      raise exception 'recommendation % was not durably persisted', v_runtime_id;
    end if;

    if v_existing.run_id is distinct from v_run_id
       or v_existing.account_id is distinct from v_account_id
       or v_existing.owner_id is distinct from v_owner_id
       or v_existing.score is distinct from v_score
       or v_existing.rank is distinct from v_rank
       or v_existing.confidence is distinct from v_confidence
       or v_existing.reason_codes is distinct from v_reason_codes
       or v_existing.reason_narrative is distinct from nullif(btrim(v_item ->> 'reasonNarrative'), '')
       or v_existing.next_best_action is distinct from (v_item -> 'nextBestAction')
       or v_existing.source_signals is distinct from (v_item -> 'sourceSignals')
       or v_existing.verification is distinct from (v_item -> 'verification')
       or v_existing.approval_status is distinct from v_approval_status
       or v_existing.published is distinct from true
       or v_existing.created_at is distinct from v_created_at then
      raise exception 'recommendation % replay content differs from persisted content', v_runtime_id;
    end if;

    if v_inserted = 1 then
      insert into public.audit_evidence (
        workspace_id,
        run_id,
        account_id,
        actor_id,
        action,
        decision,
        reason,
        evidence,
        occurred_at
      ) values (
        v_workspace_id,
        v_run_id,
        v_account_id,
        'orchestrator',
        'persist_recommendation',
        'allowed',
        'Verified recommendation persisted for live representative read.',
        jsonb_build_object(
          'recommendationId', v_runtime_id,
          'score', v_score,
          'rank', v_rank
        ),
        v_created_at
      );
    end if;
  end loop;

  select count(*)
    into v_persisted_count
    from public.recommendations r
   where r.workspace_id = v_run_workspace_id
     and r.owner_id = v_run_owner_id
     and r.run_id = v_first_run_id
     and r.published = true;

  if v_persisted_count <> v_input_count then
    raise exception 'persisted run row count % does not match input count %',
      v_persisted_count, v_input_count;
  end if;

  return v_input_count;
end;
$$;

revoke all on function public.persist_published_recommendations(jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_published_recommendations(jsonb)
  to service_role;
