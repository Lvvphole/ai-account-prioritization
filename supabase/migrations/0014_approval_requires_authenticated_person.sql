-- 0014_approval_requires_authenticated_person.sql
--
-- Closes a fail-open branch in the approval identity check added in 0011.
--
-- That check read:
--
--   if tg_op = 'INSERT' and auth.uid() is not null then ...
--
-- The `auth.uid() is not null` guard existed so a service-role connection could
-- still write. The effect was that every identity rule was skipped whenever
-- there was no authenticated user, so a service-role connection could insert an
-- approval naming any two admins and satisfy a two-person requirement with
-- nobody having acted. That is the same weakness the compound-key work set out
-- to remove, reintroduced by the fix for it.
--
-- Service role bypasses RLS throughout this schema by design, and that is
-- appropriate for reading and writing data. An approval is different in kind:
-- its whole purpose is evidence that a person decided. A server process able to
-- fabricate that evidence makes the record worth nothing, and spec section 5.1
-- is explicit that a service actor "cannot review, approve, commit".
--
-- So an approval now requires an authenticated person, with no exception. The
-- cost is that approvals cannot be seeded from a script; nothing does that.
--
-- The trigger created in 0011 already points at this function name, so
-- replacing the body is the whole change.

create or replace function public.enforce_approval_identity()
returns trigger
language plpgsql
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_workspace_admin_user(new.workspace_id, new.approved_by) then
    raise exception 'approver % does not hold admin in workspace %',
      new.approved_by, new.workspace_id
      using errcode = 'check_violation';
  end if;

  if new.second_approved_by is not null
     and not public.is_workspace_admin_user(new.workspace_id, new.second_approved_by) then
    raise exception 'second approver % does not hold admin in workspace %',
      new.second_approved_by, new.workspace_id
      using errcode = 'check_violation';
  end if;

  -- No authenticated subject means no person to attribute the decision to.
  -- Refusing here is what makes every rule below unconditional.
  if actor is null then
    raise exception 'an approval must be recorded by the authenticated person giving it'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.approved_by <> actor then
      raise exception 'an approval records the person giving it, not another user'
        using errcode = 'check_violation';
    end if;
    -- A second approval is a second person acting. It is recorded when they
    -- act, never claimed on their behalf at insert time.
    if new.second_approved_by is not null then
      raise exception 'a second approval must be recorded by the second approver'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.second_approved_by is distinct from old.second_approved_by
     and new.second_approved_by <> actor then
    raise exception 'a second approval records the person giving it'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_approval_identity() is
  'Approvals require an authenticated workspace admin acting as themselves. No service-role exception: a process that can forge approval evidence makes the evidence worthless.';
