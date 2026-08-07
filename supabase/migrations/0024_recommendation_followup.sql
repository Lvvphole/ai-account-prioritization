-- 0024_recommendation_followup.sql
-- Durable Phase 6 recommendation feedback/outcome capture.
--
-- The existing append-only audit_evidence table remains the durable event store.
-- Representatives can record only a fixed feedback/outcome vocabulary against a
-- currently authorized, published, fully verified recommendation. The write
-- rechecks and locks tenant membership, account ownership and recommendation
-- authority. Follow-up events never mutate score, rank, reason codes, source
-- evidence, next-best-action type, approval state or publication authority.

create unique index if not exists audit_recommendation_followup_idempotency_uq
  on public.audit_evidence (
    workspace_id,
    actor_id,
    action,
    (evidence ->> 'idempotencyKey')
  )
  where action = 'recommendation_followup';

create or replace function public.get_recommendation_followup_state(
  p_workspace_id uuid,
  p_runtime_recommendation_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rec public.recommendations%rowtype;
  v_event_id uuid;
  v_kind text;
  v_code text;
  v_recorded_at timestamptz;
begin
  v_rec := public.resolve_action_approval_recommendation(
    p_workspace_id,
    p_runtime_recommendation_id
  );

  select ae.id,
         ae.evidence ->> 'kind',
         ae.evidence ->> 'code',
         ae.occurred_at
    into v_event_id, v_kind, v_code, v_recorded_at
    from public.audit_evidence ae
   where ae.workspace_id = p_workspace_id
     and ae.run_id = v_rec.run_id
     and ae.account_id = v_rec.account_id
     and ae.actor_id = auth.uid()::text
     and ae.action = 'recommendation_followup'
     and ae.evidence ->> 'recommendationId' = v_rec.runtime_recommendation_id
   order by ae.occurred_at desc, ae.id desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'status', 'none',
      'kind', null,
      'code', null,
      'eventId', null,
      'recordedAt', null,
      'replayed', false
    );
  end if;

  return jsonb_build_object(
    'status', 'recorded',
    'kind', v_kind,
    'code', v_code,
    'eventId', v_event_id,
    'recordedAt', v_recorded_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.get_recommendation_followup_state(uuid, text)
  from public, anon;
grant execute on function public.get_recommendation_followup_state(uuid, text)
  to authenticated;

create or replace function public.record_recommendation_followup(
  p_workspace_id uuid,
  p_runtime_recommendation_id text,
  p_kind text,
  p_code text,
  p_expected_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_membership_id uuid;
  v_recommendation_id uuid;
  v_rec public.recommendations%rowtype;
  v_idempotency_key text;
  v_existing_id uuid;
  v_existing_kind text;
  v_existing_code text;
  v_existing_at timestamptz;
  v_current_event_id uuid;
  v_event_id uuid;
  v_recorded_at timestamptz;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'recommendation follow-up requires an authenticated user'
      using errcode = '42501';
  end if;

  if p_workspace_id is null
     or nullif(btrim(p_runtime_recommendation_id), '') is null then
    raise exception 'workspace and recommendation are required'
      using errcode = '22023';
  end if;

  if p_kind is null or p_kind not in ('feedback', 'outcome', 'unknown') then
    raise exception 'recommendation follow-up kind is invalid'
      using errcode = '22023';
  end if;

  if p_code is null or (
    p_kind = 'feedback'
    and p_code not in ('accepted', 'rejected', 'snoozed', 'completed', 'edited')
  ) or (
    p_kind = 'outcome'
    and p_code not in (
      'meeting_booked',
      'opportunity_advanced',
      'renewal_completed',
      'expansion',
      'closed_won',
      'closed_lost',
      'churned',
      'no_response'
    )
  ) or (
    p_kind = 'unknown'
    and p_code <> 'unknown'
  ) then
    raise exception 'recommendation follow-up code is invalid for kind %', p_kind
      using errcode = '22023';
  end if;

  -- Serialize follow-up writes for the current representative/recommendation and
  -- hold current authority through the durable audit insert. A concurrent
  -- membership revocation, account reassignment, recommendation withdrawal or
  -- owner change must either commit first and block this write, or wait until
  -- this transaction completes.
  select wm.id
    into v_membership_id
    from public.workspace_memberships wm
   where wm.workspace_id = p_workspace_id
     and wm.user_id = v_actor_id
   for update;

  if not found then
    raise exception 'recommendation follow-up workspace is not authorized'
      using errcode = '42501';
  end if;

  select r.id
    into v_recommendation_id
    from public.recommendations r
    join public.accounts a
      on a.id = r.account_id
     and a.workspace_id = r.workspace_id
   where r.workspace_id = p_workspace_id
     and r.runtime_recommendation_id = btrim(p_runtime_recommendation_id)
     and r.owner_id = v_actor_id
     and a.owner_id = v_actor_id
     and r.published = true
   for update of r, a;

  if not found then
    raise exception 'authorized published recommendation was not found'
      using errcode = 'P0002';
  end if;

  -- Reuse the existing verifier-aware resolver while the authoritative rows are
  -- locked. This keeps the follow-up boundary aligned with the live detail and
  -- protected-action eligibility rules.
  v_rec := public.resolve_action_approval_recommendation(
    p_workspace_id,
    p_runtime_recommendation_id
  );

  v_idempotency_key := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'workspaceId', p_workspace_id,
          'actorId', v_actor_id,
          'recommendationId', v_rec.runtime_recommendation_id,
          'expectedEventId', p_expected_event_id,
          'kind', p_kind,
          'code', p_code
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Exact retry is safe even after the first request committed and changed the
  -- current event. The deterministic request hash is checked before optimistic
  -- concurrency so a lost response can be retried without duplicating evidence.
  select ae.id,
         ae.evidence ->> 'kind',
         ae.evidence ->> 'code',
         ae.occurred_at
    into v_existing_id, v_existing_kind, v_existing_code, v_existing_at
    from public.audit_evidence ae
   where ae.workspace_id = p_workspace_id
     and ae.actor_id = v_actor_id::text
     and ae.action = 'recommendation_followup'
     and ae.evidence ->> 'recommendationId' = v_rec.runtime_recommendation_id
     and ae.evidence ->> 'idempotencyKey' = v_idempotency_key
   limit 1;

  if found then
    return jsonb_build_object(
      'status', 'recorded',
      'kind', v_existing_kind,
      'code', v_existing_code,
      'eventId', v_existing_id,
      'recordedAt', v_existing_at,
      'replayed', true
    );
  end if;

  select ae.id
    into v_current_event_id
    from public.audit_evidence ae
   where ae.workspace_id = p_workspace_id
     and ae.run_id = v_rec.run_id
     and ae.account_id = v_rec.account_id
     and ae.actor_id = v_actor_id::text
     and ae.action = 'recommendation_followup'
     and ae.evidence ->> 'recommendationId' = v_rec.runtime_recommendation_id
   order by ae.occurred_at desc, ae.id desc
   limit 1;

  if v_current_event_id is distinct from p_expected_event_id then
    raise exception 'recommendation follow-up state changed; refresh before updating'
      using errcode = '40001';
  end if;

  v_recorded_at := clock_timestamp();

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
    'recommendation_followup',
    'allowed',
    case p_kind
      when 'feedback' then 'Representative recorded bounded recommendation feedback.'
      when 'outcome' then 'Representative recorded a bounded recommendation outcome.'
      else 'Representative explicitly recorded that the recommendation outcome is not known.'
    end,
    jsonb_build_object(
      'recommendationId', v_rec.runtime_recommendation_id,
      'kind', p_kind,
      'code', p_code,
      'previousEventId', p_expected_event_id,
      'idempotencyKey', v_idempotency_key,
      'provenance', 'authenticated_representative'
    ),
    v_recorded_at
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'status', 'recorded',
    'kind', p_kind,
    'code', p_code,
    'eventId', v_event_id,
    'recordedAt', v_recorded_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.record_recommendation_followup(uuid, text, text, text, uuid)
  from public, anon;
grant execute on function public.record_recommendation_followup(uuid, text, text, text, uuid)
  to authenticated;

comment on function public.record_recommendation_followup(uuid, text, text, text, uuid) is
  'Appends provenance-bound representative feedback/outcome evidence for a currently authorized verified recommendation. It never mutates recommendation authority fields.';
