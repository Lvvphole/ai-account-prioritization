-- 0008_workspace_backfill_and_rls.sql
--
-- Adds workspace_id to every tenant-scoped table, backfills existing rows into a
-- default workspace, then replaces the global manager/admin policies from 0005
-- with membership-scoped ones.
--
-- Order matters: the column is added nullable, backfilled, and only then set NOT
-- NULL. Adding it NOT NULL up front would fail on any existing row.

-- ------------------------------------------------------- 1. add columns --

alter table public.accounts             add column if not exists workspace_id uuid;
alter table public.contacts             add column if not exists workspace_id uuid;
alter table public.opportunities        add column if not exists workspace_id uuid;
alter table public.activities           add column if not exists workspace_id uuid;
alter table public.recommendations      add column if not exists workspace_id uuid;
alter table public.audit_evidence       add column if not exists workspace_id uuid;
alter table public.eval_results         add column if not exists workspace_id uuid;
alter table public.observability_events add column if not exists workspace_id uuid;

-- ---------------------------------------------------------- 2. backfill --

-- One default workspace adopts all pre-existing data.
insert into public.workspaces (name, slug)
values ('Default Workspace', 'default')
on conflict (slug) do nothing;

do $$
declare
  ws uuid;
begin
  select id into ws from public.workspaces where slug = 'default';

  update public.accounts             set workspace_id = ws where workspace_id is null;
  update public.contacts             set workspace_id = ws where workspace_id is null;
  update public.opportunities        set workspace_id = ws where workspace_id is null;
  update public.activities           set workspace_id = ws where workspace_id is null;
  update public.recommendations      set workspace_id = ws where workspace_id is null;
  update public.audit_evidence       set workspace_id = ws where workspace_id is null;
  update public.eval_results         set workspace_id = ws where workspace_id is null;
  update public.observability_events set workspace_id = ws where workspace_id is null;

  -- Every existing profile becomes a member of the default workspace, carrying
  -- its current role. Without this, applying the new policies would lock every
  -- existing user out of their own data.
  insert into public.workspace_memberships (workspace_id, user_id, role)
  select ws, p.id, p.role from public.profiles p
  on conflict (workspace_id, user_id) do nothing;
end $$;

-- ------------------------------------- 3. constrain now that data exists --

alter table public.accounts             alter column workspace_id set not null;
alter table public.contacts             alter column workspace_id set not null;
alter table public.opportunities        alter column workspace_id set not null;
alter table public.activities           alter column workspace_id set not null;
alter table public.recommendations      alter column workspace_id set not null;
alter table public.audit_evidence       alter column workspace_id set not null;
alter table public.eval_results         alter column workspace_id set not null;
alter table public.observability_events alter column workspace_id set not null;

alter table public.accounts
  add constraint accounts_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;
alter table public.contacts
  add constraint contacts_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;
alter table public.opportunities
  add constraint opportunities_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;
alter table public.activities
  add constraint activities_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;
alter table public.recommendations
  add constraint recommendations_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;
alter table public.audit_evidence
  add constraint audit_evidence_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;
alter table public.eval_results
  add constraint eval_results_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;
alter table public.observability_events
  add constraint observability_events_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete restrict;

create index if not exists accounts_workspace_idx        on public.accounts (workspace_id);
create index if not exists contacts_workspace_idx        on public.contacts (workspace_id);
create index if not exists opportunities_workspace_idx   on public.opportunities (workspace_id);
create index if not exists activities_workspace_idx      on public.activities (workspace_id);
create index if not exists recommendations_workspace_idx on public.recommendations (workspace_id);
create index if not exists audit_evidence_workspace_idx  on public.audit_evidence (workspace_id);

-- A child must live in the same workspace as its parent account. The compound
-- unique key below gives child tables a target to reference, so a cross-tenant
-- parent reference is rejected by the database rather than by application code.
alter table public.accounts
  add constraint accounts_id_workspace_key unique (id, workspace_id);

alter table public.contacts
  add constraint contacts_account_same_workspace_fk
  foreign key (account_id, workspace_id)
  references public.accounts (id, workspace_id) on delete cascade;

alter table public.opportunities
  add constraint opportunities_account_same_workspace_fk
  foreign key (account_id, workspace_id)
  references public.accounts (id, workspace_id) on delete cascade;

alter table public.activities
  add constraint activities_account_same_workspace_fk
  foreign key (account_id, workspace_id)
  references public.accounts (id, workspace_id) on delete cascade;

-- ---------------------------------- 4. membership-scoped RLS replaces 0005 --
-- The old policies granted access on role alone. Each is replaced with the same
-- predicate plus a workspace-membership requirement.

drop policy if exists "accounts_select_owner_or_manager"   on public.accounts;
drop policy if exists "accounts_modify_owner_or_admin"     on public.accounts;
drop policy if exists "contacts_access_via_account"        on public.contacts;
drop policy if exists "opportunities_access_via_account"   on public.opportunities;
drop policy if exists "activities_access_via_account"      on public.activities;

create policy "accounts_select_workspace_owner_or_manager"
  on public.accounts for select
  using (
    public.is_workspace_member(workspace_id)
    and (owner_id = auth.uid() or public.is_workspace_manager_or_admin(workspace_id))
  );

create policy "accounts_modify_workspace_owner_or_admin"
  on public.accounts for all
  using (
    public.is_workspace_member(workspace_id)
    and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_workspace_member(workspace_id)
    and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id))
  );

create policy "contacts_access_via_workspace_account"
  on public.contacts for all
  using (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.accounts a
       where a.id = contacts.account_id
         and a.workspace_id = contacts.workspace_id
         and (a.owner_id = auth.uid() or public.is_workspace_manager_or_admin(a.workspace_id))
    )
  )
  with check (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.accounts a
       where a.id = contacts.account_id
         and a.workspace_id = contacts.workspace_id
         and (a.owner_id = auth.uid() or public.is_workspace_admin(a.workspace_id))
    )
  );

create policy "opportunities_access_via_workspace_account"
  on public.opportunities for all
  using (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.accounts a
       where a.id = opportunities.account_id
         and a.workspace_id = opportunities.workspace_id
         and (a.owner_id = auth.uid() or public.is_workspace_manager_or_admin(a.workspace_id))
    )
  )
  with check (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.accounts a
       where a.id = opportunities.account_id
         and a.workspace_id = opportunities.workspace_id
         and (a.owner_id = auth.uid() or public.is_workspace_admin(a.workspace_id))
    )
  );

create policy "activities_access_via_workspace_account"
  on public.activities for all
  using (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.accounts a
       where a.id = activities.account_id
         and a.workspace_id = activities.workspace_id
         and (a.owner_id = auth.uid() or public.is_workspace_manager_or_admin(a.workspace_id))
    )
  )
  with check (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1 from public.accounts a
       where a.id = activities.account_id
         and a.workspace_id = activities.workspace_id
         and (a.owner_id = auth.uid() or public.is_workspace_admin(a.workspace_id))
    )
  );

comment on column public.accounts.workspace_id is
  'Tenant boundary. Membership in this workspace, not a global role, grants access.';

-- The four read policies below were scoped on global role alone. An admin in one
-- workspace could read every other workspace's recommendations, audit trail,
-- eval results and observability events. Each now also requires membership.

drop policy if exists "recommendations_select_owner_or_manager" on public.recommendations;
drop policy if exists "audit_select_manager_or_admin"           on public.audit_evidence;
drop policy if exists "eval_results_select_manager_or_admin"    on public.eval_results;
drop policy if exists "obs_events_select_manager_or_admin"      on public.observability_events;

create policy "recommendations_select_workspace_owner_or_manager"
  on public.recommendations for select
  using (
    public.is_workspace_member(workspace_id)
    and (owner_id = auth.uid() or public.is_workspace_manager_or_admin(workspace_id))
  );

create policy "audit_select_workspace_manager_or_admin"
  on public.audit_evidence for select
  using (public.is_workspace_manager_or_admin(workspace_id));

create policy "eval_results_select_workspace_manager_or_admin"
  on public.eval_results for select
  using (public.is_workspace_manager_or_admin(workspace_id));

create policy "obs_events_select_workspace_manager_or_admin"
  on public.observability_events for select
  using (public.is_workspace_manager_or_admin(workspace_id));
