-- 0007_workspaces_and_memberships.sql
--
-- Epic 0 of the secure-ingestion spec: introduce the workspace boundary.
--
-- Before this migration a manager or admin role was global. `is_manager_or_admin()`
-- answered "what role does this user hold" with no notion of which tenant, so the
-- role granted access to every row in the deployment. Tenant scope now comes from
-- membership in a workspace.
--
-- This migration only creates the boundary. 0008 backfills existing rows and
-- switches the policies over, so the two steps can be reviewed separately.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Authoritative tenant-scoped role. profiles.role stays as user identity so
  -- existing sign-in continues to work, but it no longer decides data access.
  role public.app_role not null default 'rep',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create trigger workspace_memberships_set_updated_at
  before update on public.workspace_memberships
  for each row execute function public.set_updated_at();

create index if not exists workspace_memberships_user_idx
  on public.workspace_memberships (user_id);
create index if not exists workspace_memberships_workspace_idx
  on public.workspace_memberships (workspace_id);

-- ---------------------------------------------------------------- helpers --
-- All are STABLE and SECURITY DEFINER with a pinned search_path, matching the
-- existing role helpers in 0002. They answer "in this workspace", never
-- "anywhere".

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.workspace_memberships m
     where m.workspace_id = ws
       and m.user_id = auth.uid()
  );
$$;

create or replace function public.workspace_role(ws uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
    from public.workspace_memberships m
   where m.workspace_id = ws
     and m.user_id = auth.uid();
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) = 'admin';
$$;

create or replace function public.is_workspace_manager_or_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.workspace_role(ws) in ('manager', 'admin');
$$;

-- ------------------------------------------------------------------- RLS --

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

-- A user sees only workspaces they belong to. There is no global list.
create policy "workspaces_select_member"
  on public.workspaces for select
  using (public.is_workspace_member(id));

create policy "workspaces_update_admin"
  on public.workspaces for update
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

-- A user sees their own membership rows, and an admin sees the roster for the
-- workspaces they administer.
create policy "memberships_select_self_or_workspace_admin"
  on public.workspace_memberships for select
  using (user_id = auth.uid() or public.is_workspace_admin(workspace_id));

create policy "memberships_write_workspace_admin"
  on public.workspace_memberships for all
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

comment on table public.workspaces is
  'Tenant boundary. Every tenant-scoped table carries workspace_id.';
comment on table public.workspace_memberships is
  'Authoritative tenant-scoped role. profiles.role is identity only.';
