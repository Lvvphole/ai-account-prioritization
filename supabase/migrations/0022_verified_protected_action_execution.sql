-- 0022_verified_protected_action_execution.sql
-- Execute one minimum-sufficient protected side effect after exact-payload
-- approval: a deterministic CRM research-note write into canonical activities.
-- Customer-facing actions remain blocked until a concrete external executor is
-- separately implemented and configured. No model receives side-effect authority.

-- Direct authenticated mutation would bypass the exact-payload approval binding.
-- Keep representative reads under RLS, but make the protected write path the
-- narrow SECURITY DEFINER RPC below. Existing ingestion/service-role writes are
-- unaffected.
revoke insert, update, delete on public.activities from anon, authenticated;

create unique index if not exists audit_protected_action_execution_idempotency_uq
  on public.audit_evidence (
    workspace_id,
    actor_id,
    action,
    (evidence ->> 'idempotencyKey')
  )
  where action = 'protected_action_execution';

create or replace function public.execute_approved_protected_action(
  p_workspace_id uuid,
  p_runtime_recommendation_id text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_rec public.recommendations%rowtype;
  v_action_type text;
  v_customer_facing boolean;
  v_crm_write_back boolean;
  v_requires_approval boolean;
  v_payload_hash text;
  v_approval jsonb;
  v_approval_status text;
  v_policy_version constant text := 'crm_note_v1';
  v_idempotency_key text;
  v_execution_id uuid;
  v_executed_at timestamptz;
  v_existing_audit public.audit_evidence%rowtype;
  v_existing_activity_id text;
  v_result_code text;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'protected action execution requires an authenticated user'
      using errcode = '42501';
  end if;

  v_rec := public.resolve_action_approval_recommendation(
    p_workspace_id,
    p_runtime_recommendation_id
  );

  v_action_type := v_rec.next_best_action ->> 'type';
  v_customer_facing :=
    coalesce((v_rec.next_best_action ->> 'customerFacing')::boolean, false);
  v_crm_write_back :=
    coalesce((v_rec.next_best_action ->> 'crmWriteBack')::boolean, false);
  v_requires_approval := v_customer_facing or v_crm_write_back;

  if not v_requires_approval then
    raise exception 'action is not a protected side effect'
      using errcode = '22023';
  end if;

  if p_content is null
     or char_length(btrim(p_content)) = 0
     or char_length(p_content) > 12000 then
    raise exception 'visible protected action payload is invalid'
      using errcode = '22023';
  end if;

  v_payload_hash := public.action_payload_hash(v_action_type, p_content);
  v_idempotency_key := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'workspaceId', p_workspace_id,
          'actorId', v_actor_id,
          'recommendationId', v_rec.runtime_recommendation_id,
          'actionType', v_action_type,
          'payloadHash', v_payload_hash,
          'policyVersion', v_policy_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  v_approval := public.get_action_payload_approval_state(
    p_workspace_id,
    p_runtime_recommendation_id,
    p_content
  );
  v_approval_status := v_approval ->> 'status';

  if v_approval_status is distinct from 'approved' then
    v_result_code := case v_approval_status
      when 'rejected' then 'APPROVAL_REJECTED'
      else 'APPROVAL_REQUIRED'
    end;

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
      p_workspace_id,
      v_rec.run_id,
      v_rec.account_id,
      v_actor_id::text,
      'protected_action_execution_blocked',
      'blocked',
      case v_result_code
        when 'APPROVAL_REJECTED' then
          'Protected action execution was blocked because the exact payload was rejected.'
        else
          'Protected action execution was blocked because exact-payload approval is required.'
      end,
      jsonb_build_object(
        'recommendationId', v_rec.runtime_recommendation_id,
        'actionType', v_action_type,
        'payloadHash', v_payload_hash,
        'idempotencyKey', v_idempotency_key,
        'resultCode', v_result_code,
        'policyVersion', v_policy_version
      ),
      clock_timestamp()
    );

    return jsonb_build_object(
      'status', 'BLOCKED',
      'resultCode', v_result_code,
      'executionId', null,
      'idempotencyKey', v_idempotency_key,
      'executedAt', null,
      'replayed', false
    );
  end if;

  -- Unit 5 admits exactly one in-app protected executor. Research-note write-back
  -- is a deterministic canonical CRM write. Customer-facing actions remain
  -- blocked rather than being reported as sent when no external executor exists.
  if v_action_type <> 'log_research_note'
     or not v_crm_write_back
     or v_customer_facing then
    v_result_code := case
      when v_customer_facing then 'EXTERNAL_EXECUTOR_NOT_CONFIGURED'
      else 'ACTION_EXECUTION_UNSUPPORTED'
    end;

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
      p_workspace_id,
      v_rec.run_id,
      v_rec.account_id,
      v_actor_id::text,
      'protected_action_execution_blocked',
      'blocked',
      case v_result_code
        when 'EXTERNAL_EXECUTOR_NOT_CONFIGURED' then
          'Customer-facing execution has no authorized in-app external executor.'
        else
          'The protected action is outside the admitted Unit 5 execution mechanism.'
      end,
      jsonb_build_object(
        'recommendationId', v_rec.runtime_recommendation_id,
        'actionType', v_action_type,
        'payloadHash', v_payload_hash,
        'idempotencyKey', v_idempotency_key,
        'resultCode', v_result_code,
        'policyVersion', v_policy_version
      ),
      clock_timestamp()
    );

    return jsonb_build_object(
      'status', 'BLOCKED',
      'resultCode', v_result_code,
      'executionId', null,
      'idempotencyKey', v_idempotency_key,
      'executedAt', null,
      'replayed', false
    );
  end if;

  -- Exact replay returns the previously verified result. The activity row is
  -- rechecked before the verifier reports PASS so audit evidence alone cannot
  -- masquerade as a completed CRM write.
  select ae.*
    into v_existing_audit
    from public.audit_evidence ae
   where ae.workspace_id = p_workspace_id
     and ae.actor_id = v_actor_id::text
     and ae.action = 'protected_action_execution'
     and ae.evidence ->> 'idempotencyKey' = v_idempotency_key
   limit 1;

  if found then
    v_existing_activity_id := v_existing_audit.evidence ->> 'activityId';

    if exists (
      select 1
        from public.activities act
       where act.id::text = v_existing_activity_id
         and act.workspace_id = p_workspace_id
         and act.account_id = v_rec.account_id
         and act.created_by_id = v_actor_id
         and act.type = 'note'
         and act.body = p_content
         and act.verified = false
    ) then
      return jsonb_build_object(
        'status', 'PASS',
        'resultCode', 'CRM_NOTE_WRITTEN',
        'executionId', v_existing_activity_id,
        'idempotencyKey', v_idempotency_key,
        'executedAt', v_existing_audit.occurred_at,
        'replayed', true
      );
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
      p_workspace_id,
      v_rec.run_id,
      v_rec.account_id,
      v_actor_id::text,
      'protected_action_execution_failed',
      'blocked',
      'Existing execution evidence did not resolve to the exact expected CRM activity.',
      jsonb_build_object(
        'recommendationId', v_rec.runtime_recommendation_id,
        'actionType', v_action_type,
        'payloadHash', v_payload_hash,
        'idempotencyKey', v_idempotency_key,
        'resultCode', 'EXECUTION_POSTCONDITION_FAILED',
        'policyVersion', v_policy_version
      ),
      clock_timestamp()
    );

    return jsonb_build_object(
      'status', 'FAIL',
      'resultCode', 'EXECUTION_POSTCONDITION_FAILED',
      'executionId', null,
      'idempotencyKey', v_idempotency_key,
      'executedAt', null,
      'replayed', false
    );
  end if;

  begin
    v_execution_id := gen_random_uuid();
    v_executed_at := clock_timestamp();

    insert into public.activities (
      id,
      workspace_id,
      account_id,
      contact_id,
      type,
      subject,
      body,
      occurred_at,
      created_by_id,
      verified,
      created_at
    ) values (
      v_execution_id,
      p_workspace_id,
      v_rec.account_id,
      null,
      'note',
      'Research note from verified recommendation',
      p_content,
      v_executed_at,
      v_actor_id,
      false,
      v_executed_at
    );

    if not exists (
      select 1
        from public.activities act
       where act.id = v_execution_id
         and act.workspace_id = p_workspace_id
         and act.account_id = v_rec.account_id
         and act.created_by_id = v_actor_id
         and act.type = 'note'
         and act.body = p_content
         and act.verified = false
    ) then
      raise exception 'protected action execution postcondition failed'
        using errcode = 'P0001';
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
      p_workspace_id,
      v_rec.run_id,
      v_rec.account_id,
      v_actor_id::text,
      'protected_action_execution',
      'allowed',
      'Exact-payload-approved CRM research note was written and postcondition-verified.',
      jsonb_build_object(
        'recommendationId', v_rec.runtime_recommendation_id,
        'actionType', v_action_type,
        'payloadHash', v_payload_hash,
        'payloadLength', char_length(p_content),
        'idempotencyKey', v_idempotency_key,
        'activityId', v_execution_id,
        'resultCode', 'CRM_NOTE_WRITTEN',
        'policyVersion', v_policy_version
      ),
      v_executed_at
    );
  exception
    when unique_violation then
      -- A concurrent request may have committed the same idempotency key first.
      -- The subtransaction above is rolled back before this handler runs, so no
      -- duplicate activity survives. Return PASS only after re-verifying the
      -- already-committed activity.
      select ae.*
        into v_existing_audit
        from public.audit_evidence ae
       where ae.workspace_id = p_workspace_id
         and ae.actor_id = v_actor_id::text
         and ae.action = 'protected_action_execution'
         and ae.evidence ->> 'idempotencyKey' = v_idempotency_key
       limit 1;

      if found then
        v_existing_activity_id := v_existing_audit.evidence ->> 'activityId';

        if exists (
          select 1
            from public.activities act
           where act.id::text = v_existing_activity_id
             and act.workspace_id = p_workspace_id
             and act.account_id = v_rec.account_id
             and act.created_by_id = v_actor_id
             and act.type = 'note'
             and act.body = p_content
             and act.verified = false
        ) then
          return jsonb_build_object(
            'status', 'PASS',
            'resultCode', 'CRM_NOTE_WRITTEN',
            'executionId', v_existing_activity_id,
            'idempotencyKey', v_idempotency_key,
            'executedAt', v_existing_audit.occurred_at,
            'replayed', true
          );
        end if;
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
        p_workspace_id,
        v_rec.run_id,
        v_rec.account_id,
        v_actor_id::text,
        'protected_action_execution_failed',
        'blocked',
        'Concurrent execution could not be reconciled to a verified idempotent result.',
        jsonb_build_object(
          'recommendationId', v_rec.runtime_recommendation_id,
          'actionType', v_action_type,
          'payloadHash', v_payload_hash,
          'idempotencyKey', v_idempotency_key,
          'resultCode', 'IDEMPOTENCY_RECONCILIATION_FAILED',
          'policyVersion', v_policy_version
        ),
        clock_timestamp()
      );

      return jsonb_build_object(
        'status', 'FAIL',
        'resultCode', 'IDEMPOTENCY_RECONCILIATION_FAILED',
        'executionId', null,
        'idempotencyKey', v_idempotency_key,
        'executedAt', null,
        'replayed', false
      );
    when others then
      -- The activity insert and success audit above are in this exception block,
      -- so PostgreSQL rolls both back before this handler records the failure.
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
        p_workspace_id,
        v_rec.run_id,
        v_rec.account_id,
        v_actor_id::text,
        'protected_action_execution_failed',
        'blocked',
        'Protected CRM write did not satisfy its deterministic postcondition.',
        jsonb_build_object(
          'recommendationId', v_rec.runtime_recommendation_id,
          'actionType', v_action_type,
          'payloadHash', v_payload_hash,
          'idempotencyKey', v_idempotency_key,
          'resultCode', 'EXECUTION_POSTCONDITION_FAILED',
          'policyVersion', v_policy_version
        ),
        clock_timestamp()
      );

      return jsonb_build_object(
        'status', 'FAIL',
        'resultCode', 'EXECUTION_POSTCONDITION_FAILED',
        'executionId', null,
        'idempotencyKey', v_idempotency_key,
        'executedAt', null,
        'replayed', false
      );
  end;

  return jsonb_build_object(
    'status', 'PASS',
    'resultCode', 'CRM_NOTE_WRITTEN',
    'executionId', v_execution_id,
    'idempotencyKey', v_idempotency_key,
    'executedAt', v_executed_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.execute_approved_protected_action(uuid, text, text)
  from public, anon;
grant execute on function public.execute_approved_protected_action(uuid, text, text)
  to authenticated;

comment on function public.execute_approved_protected_action(uuid, text, text) is
  'Re-verifies exact-payload approval and current owner/workspace authority, then idempotently writes only the admitted CRM research-note action. Customer-facing actions remain blocked.';
