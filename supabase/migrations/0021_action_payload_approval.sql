-- 0021_action_payload_approval.sql
-- Bind a representative's protected-action approval to the exact visible
-- payload without adding a second approval store. The existing append-only
-- audit_evidence table is the durable record. Only a SHA-256 payload binding is
-- retained so approval evidence does not duplicate customer-facing content.

create or replace function public.action_payload_hash(
  p_action_type text,
  p_content text
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(
    digest(
      convert_to(
        jsonb_build_object(
          'actionType', p_action_type,
          'content', p_content
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function public.action_payload_hash(text, text)
  from public, anon, authenticated;

create or replace function public.resolve_action_approval_recommendation(
  p_workspace_id uuid,
  p_runtime_recommendation_id text
)
returns public.recommendations
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_rec public.recommendations%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'action approval requires an authenticated user'
      using errcode = '42501';
  end if;

  if p_workspace_id is null
     or nullif(btrim(p_runtime_recommendation_id), '') is null then
    raise exception 'workspace and recommendation are required'
      using errcode = '22023';
  end if;

  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'action approval workspace is not authorized'
      using errcode = '42501';
  end if;

  select r.*
    into v_rec
    from public.recommendations r
    join public.accounts a
      on a.id = r.account_id
     and a.workspace_id = r.workspace_id
   where r.workspace_id = p_workspace_id
     and r.runtime_recommendation_id = btrim(p_runtime_recommendation_id)
     and r.owner_id = v_user_id
     and a.owner_id = v_user_id
     and r.published = true;

  if not found then
    raise exception 'authorized published recommendation was not found'
      using errcode = 'P0002';
  end if;

  if jsonb_typeof(v_rec.verification) is distinct from 'object'
     or v_rec.verification ->> 'status' is distinct from 'passed'
     or not coalesce((v_rec.verification ->> 'schemaValid')::boolean, false)
     or not coalesce((v_rec.verification ->> 'guardrailsPassed')::boolean, false)
     or not coalesce((v_rec.verification ->> 'sourceSignalsVerified')::boolean, false)
     or not coalesce((v_rec.verification ->> 'permissionGranted')::boolean, false) then
    raise exception 'recommendation is not eligible for protected action approval'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_rec.next_best_action) is distinct from 'object'
     or nullif(btrim(v_rec.next_best_action ->> 'type'), '') is null then
    raise exception 'recommendation action contract is invalid'
      using errcode = '22023';
  end if;

  return v_rec;
end;
$$;

revoke all on function public.resolve_action_approval_recommendation(uuid, text)
  from public, anon, authenticated;

create unique index if not exists audit_action_payload_decision_uq
  on public.audit_evidence (
    workspace_id,
    actor_id,
    action,
    (evidence ->> 'recommendationId'),
    (evidence ->> 'payloadHash')
  )
  where action = 'action_payload_approval';

create or replace function public.get_action_payload_approval_state(
  p_workspace_id uuid,
  p_runtime_recommendation_id text,
  p_content text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rec public.recommendations%rowtype;
  v_action_type text;
  v_requires_approval boolean;
  v_payload_hash text;
  v_decision public.audit_decision;
  v_decided_at timestamptz;
begin
  v_rec := public.resolve_action_approval_recommendation(
    p_workspace_id,
    p_runtime_recommendation_id
  );

  v_action_type := v_rec.next_best_action ->> 'type';
  v_requires_approval :=
    coalesce((v_rec.next_best_action ->> 'customerFacing')::boolean, false)
    or coalesce((v_rec.next_best_action ->> 'crmWriteBack')::boolean, false);

  if not v_requires_approval then
    return jsonb_build_object(
      'status', 'not_required',
      'payloadHash', null,
      'decidedAt', null
    );
  end if;

  if p_content is null
     or char_length(btrim(p_content)) = 0
     or char_length(p_content) > 12000 then
    raise exception 'visible protected action payload is invalid'
      using errcode = '22023';
  end if;

  v_payload_hash := public.action_payload_hash(v_action_type, p_content);

  select ae.decision, ae.occurred_at
    into v_decision, v_decided_at
    from public.audit_evidence ae
   where ae.workspace_id = p_workspace_id
     and ae.run_id = v_rec.run_id
     and ae.account_id = v_rec.account_id
     and ae.actor_id = auth.uid()::text
     and ae.action = 'action_payload_approval'
     and ae.evidence ->> 'recommendationId' = v_rec.runtime_recommendation_id
     and ae.evidence ->> 'payloadHash' = v_payload_hash
   limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'pending_approval',
      'payloadHash', v_payload_hash,
      'decidedAt', null
    );
  end if;

  return jsonb_build_object(
    'status', case v_decision
      when 'approved'::public.audit_decision then 'approved'
      when 'rejected'::public.audit_decision then 'rejected'
      else 'pending_approval'
    end,
    'payloadHash', v_payload_hash,
    'decidedAt', v_decided_at
  );
end;
$$;

revoke all on function public.get_action_payload_approval_state(uuid, text, text)
  from public, anon;
grant execute on function public.get_action_payload_approval_state(uuid, text, text)
  to authenticated;

create or replace function public.record_action_payload_decision(
  p_workspace_id uuid,
  p_runtime_recommendation_id text,
  p_content text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.recommendations%rowtype;
  v_action_type text;
  v_requires_approval boolean;
  v_payload_hash text;
  v_existing jsonb;
  v_occurred_at timestamptz;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'action payload decision must be approved or rejected'
      using errcode = '22023';
  end if;

  v_rec := public.resolve_action_approval_recommendation(
    p_workspace_id,
    p_runtime_recommendation_id
  );

  v_action_type := v_rec.next_best_action ->> 'type';
  v_requires_approval :=
    coalesce((v_rec.next_best_action ->> 'customerFacing')::boolean, false)
    or coalesce((v_rec.next_best_action ->> 'crmWriteBack')::boolean, false);

  if not v_requires_approval then
    raise exception 'action does not require protected payload approval'
      using errcode = '22023';
  end if;

  if p_content is null
     or char_length(btrim(p_content)) = 0
     or char_length(p_content) > 12000 then
    raise exception 'visible protected action payload is invalid'
      using errcode = '22023';
  end if;

  v_payload_hash := public.action_payload_hash(v_action_type, p_content);
  v_existing := public.get_action_payload_approval_state(
    p_workspace_id,
    p_runtime_recommendation_id,
    p_content
  );

  if v_existing ->> 'status' in ('approved', 'rejected') then
    if v_existing ->> 'status' = p_decision then
      return v_existing;
    end if;
    raise exception 'an immutable decision already exists for this exact payload'
      using errcode = '22023';
  end if;

  v_occurred_at := clock_timestamp();

  begin
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
      auth.uid()::text,
      'action_payload_approval',
      p_decision::public.audit_decision,
      case p_decision
        when 'approved' then 'Representative approved the exact visible protected action payload.'
        else 'Representative rejected the exact visible protected action payload.'
      end,
      jsonb_build_object(
        'recommendationId', v_rec.runtime_recommendation_id,
        'actionType', v_action_type,
        'payloadHash', v_payload_hash,
        'payloadLength', char_length(p_content)
      ),
      v_occurred_at
    );
  exception when unique_violation then
    v_existing := public.get_action_payload_approval_state(
      p_workspace_id,
      p_runtime_recommendation_id,
      p_content
    );
    if v_existing ->> 'status' = p_decision then
      return v_existing;
    end if;
    raise exception 'an immutable decision already exists for this exact payload'
      using errcode = '22023';
  end;

  return jsonb_build_object(
    'status', p_decision,
    'payloadHash', v_payload_hash,
    'decidedAt', v_occurred_at
  );
end;
$$;

revoke all on function public.record_action_payload_decision(uuid, text, text, text)
  from public, anon;
grant execute on function public.record_action_payload_decision(uuid, text, text, text)
  to authenticated;

comment on function public.record_action_payload_decision(uuid, text, text, text) is
  'Records an immutable human decision bound to the exact visible protected-action payload hash. It does not execute a side effect.';
