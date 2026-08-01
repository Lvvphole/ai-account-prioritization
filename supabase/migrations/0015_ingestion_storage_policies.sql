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
-- The access rule is one predicate: an object's first path segment is the
-- workspace it belongs to, and a caller reaches it only by holding admin in
-- that workspace. Paths are server-generated (`buildQuarantinePath` in
-- `@repo/security`), so the prefix is trustworthy in a way a client-supplied
-- filename never is.
--
-- Listing is deliberately absent. A browser that could list a workspace bucket
-- would learn how many imports a tenant ran and when, which is not information
-- the import UI needs.
--
-- Supabase's storage schema exists in a hosted project but not in a bare
-- PostgreSQL used for migration verification, so every statement here is
-- guarded. The guard skips the policies rather than inventing a fake storage
-- schema: a test double would prove the policy parses, not that it holds.

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

  execute $p$drop policy if exists "ingestion_objects_admin_read" on storage.objects$p$;
  execute $p$
    create policy "ingestion_objects_admin_read"
      on storage.objects for select
      using (
        bucket_id in ('ingestion-quarantine', 'ingestion-rejected', 'ingestion-reports')
        and public.is_workspace_admin((storage.foldername(name))[1]::uuid)
      )
  $p$;

  -- Insert only. There is no update policy: a raw upload is evidence, and an
  -- object that can be replaced after scanning is evidence of nothing.
  execute $p$drop policy if exists "ingestion_objects_admin_insert" on storage.objects$p$;
  execute $p$
    create policy "ingestion_objects_admin_insert"
      on storage.objects for insert
      with check (
        bucket_id = 'ingestion-quarantine'
        and public.is_workspace_admin((storage.foldername(name))[1]::uuid)
      )
  $p$;

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
