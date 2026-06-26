-- 0005_rls_policies.sql
-- Row Level Security for all tenant/user/account-scoped tables (Rule #6).
-- Service-role connections bypass RLS by design (trusted server contexts).

-- ---- profiles ----
alter table public.profiles enable row level security;

create policy "profiles_select_self_or_manager"
  on public.profiles for select
  using (id = auth.uid() or public.is_manager_or_admin());

-- Users may update their own profile row, BUT role changes are gated by the
-- trigger below (a with-check on id alone would let a rep self-promote to admin).
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_admin_all"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- Prevent profile-role privilege escalation. A user can edit their own profile,
-- but only an admin or the service role may change the `role` column. Evaluated
-- BEFORE UPDATE, so current_app_role() reflects the pre-update (committed) role,
-- meaning a rep attempting to set role='admin' is rejected.
create or replace function public.enforce_role_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'profile role changes require admin or service role';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_enforce_role on public.profiles;
create trigger trg_profiles_enforce_role
  before update on public.profiles
  for each row execute function public.enforce_role_immutability();

-- ---- accounts ----
alter table public.accounts enable row level security;

create policy "accounts_select_owner_or_manager"
  on public.accounts for select
  using (owner_id = auth.uid() or public.is_manager_or_admin());

create policy "accounts_modify_owner_or_admin"
  on public.accounts for all
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- ---- contacts (scoped through the parent account) ----
alter table public.contacts enable row level security;

create policy "contacts_access_via_account"
  on public.contacts for all
  using (
    exists (
      select 1 from public.accounts a
      where a.id = contacts.account_id
        and (a.owner_id = auth.uid() or public.is_manager_or_admin())
    )
  )
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = contacts.account_id
        and (a.owner_id = auth.uid() or public.is_admin())
    )
  );

-- ---- opportunities ----
alter table public.opportunities enable row level security;

create policy "opportunities_access_via_account"
  on public.opportunities for all
  using (
    exists (
      select 1 from public.accounts a
      where a.id = opportunities.account_id
        and (a.owner_id = auth.uid() or public.is_manager_or_admin())
    )
  )
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = opportunities.account_id
        and (a.owner_id = auth.uid() or public.is_admin())
    )
  );

-- ---- activities ----
alter table public.activities enable row level security;

create policy "activities_access_via_account"
  on public.activities for all
  using (
    exists (
      select 1 from public.accounts a
      where a.id = activities.account_id
        and (a.owner_id = auth.uid() or public.is_manager_or_admin())
    )
  )
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = activities.account_id
        and (a.owner_id = auth.uid() or public.is_admin())
    )
  );

-- ---- recommendations (read-only to reps/managers; writes via service role) ----
alter table public.recommendations enable row level security;

create policy "recommendations_select_owner_or_manager"
  on public.recommendations for select
  using (owner_id = auth.uid() or public.is_manager_or_admin());

-- ---- audit_evidence (managers/admins read; writes via service role) ----
alter table public.audit_evidence enable row level security;

create policy "audit_select_manager_or_admin"
  on public.audit_evidence for select
  using (public.is_manager_or_admin());

-- ---- eval_results (managers/admins read; writes via service role) ----
alter table public.eval_results enable row level security;

create policy "eval_results_select_manager_or_admin"
  on public.eval_results for select
  using (public.is_manager_or_admin());
