-- 0015_ingestion_storage_policies.sql
--
-- Private storage for raw uploads (secure-ingestion spec, section 16.1).
--
-- Three buckets, none public:
--
--   ingestion-quarantine  raw uploads, before and during scanning
--   ingestion-rejected    rejected-row reports
--   ingestion-reports     change-set and commit reports
--
-- The access rule is that no browser role reaches these objects at all.
-- Section 16.1 requires that a browser cannot list a workspace bucket and that
-- access is by short-lived signed URL, so reads and writes go through the
-- service role, which mints those URLs. Object paths are server-generated
-- (`buildQuarantinePath` in `@repo/security`) and workspace-prefixed, so the
-- prefix stays meaningful for the sweeper and for audit even though no policy
-- keys off it.
--
-- The browser learns which files exist from `ingestion_files`, which is
-- workspace-scoped and carries the metadata the import UI needs without
-- exposing the objects.
--
-- Supabase's storage schema exists in a hosted project but not in a bare
-- PostgreSQL used for verification, so the bucket work is guarded.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent; skipping bucket policies (expected outside Supabase)';
    return;
  end if;

  -- ------------------------------------------------------------ buckets --
  -- `public = false` is the whole security posture. Signed URLs are the only
  -- way in, and they expire.

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('ingestion-quarantine', 'ingestion-quarantine', false, 10485760,
     array['text/csv', 'text/plain', 'application/octet-stream']),
    ('ingestion-rejected', 'ingestion-rejected', false, 10485760,
     array['text/csv', 'application/json']),
    ('ingestion-reports', 'ingestion-reports', false, 10485760,
     array['application/json'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- ----------------------------------------------------------- policies --
  -- Written with dynamic SQL because `storage.objects` may not exist at parse
  -- time in the verification database.

  -- A policy on a table without RLS is inert. Supabase enables it on
  -- `storage.objects` already, so this is belt and braces rather than the
  -- normal path, and a permission error here means the platform owns the table
  -- and has already done it.
  begin
    execute $p$alter table storage.objects enable row level security$p$;
  exception when insufficient_privilege then
    raise notice 'storage.objects RLS is managed by the platform; leaving as is';
  end;

  -- No browser role gets any policy on these buckets.
  --
  -- Section 16.1 says the browser cannot list a workspace bucket and that
  -- access is by short-lived signed URL. A SELECT policy scoped to the
  -- workspace would satisfy the tenancy half and break the listing half: an
  -- admin could enumerate every quarantined upload through the Storage API.
  --
  -- So reads and writes both go through the service role, which mints signed
  -- URLs. The browser learns what files exist from `ingestion_files`, which is
  -- already workspace-scoped and carries the metadata the import UI needs
  -- without exposing the objects themselves.
  execute $p$drop policy if exists "ingestion_objects_admin_read" on storage.objects$p$;
  execute $p$drop policy if exists "ingestion_objects_admin_insert" on storage.objects$p$;

  -- Deletion is how retention is enforced, and retention is a server job.
  -- No browser role gets a delete policy.

  raise notice 'ingestion storage buckets and policies applied';
end $$;

-- ---------------------------------------------------------------- retention --
--
-- Section 16.1 gives raw uploads 7 days and rejected-row reports 30 days.
-- Recording the policy as data rather than as a comment means the sweeper reads
-- the same numbers an administrator sees, and a change is audited like any
-- other row.

create table if not exists public.storage_retention_policies (
  bucket text primary key check (
    bucket in ('ingestion-quarantine', 'ingestion-rejected', 'ingestion-reports')
  ),
  retention_days integer not null check (retention_days between 1 and 3650),
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

insert into public.storage_retention_policies (bucket, retention_days)
values
  ('ingestion-quarantine', 7),
  ('ingestion-rejected', 30),
  ('ingestion-reports', 90)
on conflict (bucket) do nothing;

alter table public.storage_retention_policies enable row level security;
revoke all on public.storage_retention_policies from anon;
grant select on public.storage_retention_policies to authenticated;

-- Readable by any member so the import UI can state how long a file is kept.
-- Changing it is a service-role operation, audited like other configuration.
drop policy if exists "retention_policies_read" on public.storage_retention_policies;
create policy "retention_policies_read"
  on public.storage_retention_policies for select
  using (true);

comment on table public.storage_retention_policies is
  'Retention windows for ingestion buckets. Read by the UI and by the sweeper, so both quote the same number.';
