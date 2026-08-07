-- 0023_lock_protected_action_authority.sql
-- Hold the representative membership, account ownership, and recommendation
-- authority rows for the full protected-write transaction. This closes the
-- time-of-check/time-of-use window between exact-payload approval verification
-- and the canonical CRM write.

alter function public.execute_approved_protected_action(uuid, text, text)
  rename to execute_approved_protected_action_unlocked;

-- The original executor remains an implementation detail. Only the locking
-- wrapper below is callable by an authenticated representative.
revoke all on function public.execute_approved_protected_action_unlocked(uuid, text, text)
  from public, anon, authenticated;

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
  v_membership_id uuid;
  v_recommendation_id uuid;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'protected action execution requires an authenticated user'
      using errcode = '42501';
  end if;

  if p_workspace_id is null
     or nullif(btrim(p_runtime_recommendation_id), '') is null then
    raise exception 'workspace and recommendation are required'
      using errcode = '22023';
  end if;

  -- Lock the exact membership row. A concurrent membership removal or role
  -- mutation must wait until this protected-write transaction finishes. If the
  -- revocation acquired the row first, this statement waits and then fails
  -- closed because the membership no longer exists.
  select wm.id
    into v_membership_id
    from public.workspace_memberships wm
   where wm.workspace_id = p_workspace_id
     and wm.user_id = v_actor_id
   for update;

  if not found then
    raise exception 'protected action execution workspace is not authorized'
      using errcode = '42501';
  end if;

  -- Lock both current authoritative rows that bind the recommendation to the
  -- representative. A concurrent account reassignment, recommendation
  -- withdrawal, owner change, or deletion cannot commit between this check and
  -- the side effect. The inner executor performs the full verification and
  -- exact-payload approval checks while these locks remain held.
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

  return public.execute_approved_protected_action_unlocked(
    p_workspace_id,
    p_runtime_recommendation_id,
    p_content
  );
end;
$$;

revoke all on function public.execute_approved_protected_action(uuid, text, text)
  from public, anon;
grant execute on function public.execute_approved_protected_action(uuid, text, text)
  to authenticated;

comment on function public.execute_approved_protected_action(uuid, text, text) is
  'Locks current tenant membership, account ownership, and recommendation authority through the exact-approved protected CRM write, then returns deterministic PASS, FAIL, or BLOCKED.';
