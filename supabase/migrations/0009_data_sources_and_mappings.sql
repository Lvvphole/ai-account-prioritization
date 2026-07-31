-- 0009_data_sources_and_mappings.sql
--
-- Epic 1 of the secure-ingestion spec: the source registry.
--
-- A source is the authenticated origin of inbound data. Registering one grants
-- no access to product tables: everything a source produces enters the staging
-- pipeline added in 0010 and reaches an operational row only through an
-- approved commit in 0011.
--
-- Two things are deliberately absent from these tables:
--
--   1. Credential values. `source_credentials` stores a pointer into a secret
--      manager and a non-secret fingerprint, so a dump of this table leaks
--      nothing usable.
--   2. Executable mapping logic. A mapping picks a canonical field and one
--      transform from a closed enum, so no administrator can author code that
--      the ingestion pipeline will run.
--
-- RLS is applied in 0013, once every ingestion table exists.

-- ------------------------------------------------------------------ enums --

do $$ begin
  create type public.source_kind as enum ('csv', 'webhook', 'native_crm', 'mcp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.source_provider as enum
    ('salesforce', 'hubspot', 'generic_webhook', 'remote_mcp', 'manual_csv');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.source_state as enum
    ('not_configured', 'connecting', 'testing', 'backfilling', 'healthy',
     'degraded', 'failed', 'paused', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.canonical_object_type as enum
    ('account', 'contact', 'opportunity', 'activity', 'intent_signal',
     'account_health', 'contract');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.field_mapping_disposition as enum
    ('mapped', 'explicitly_ignored', 'quarantined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.field_transform as enum
    ('none', 'trim', 'lowercase', 'uppercase', 'parse_iso_date', 'parse_decimal',
     'parse_integer', 'parse_boolean', 'normalize_currency_usd');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mapping_version_state as enum
    ('draft', 'validated', 'published', 'superseded');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------- data_sources --

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  provider public.source_provider not null,
  kind public.source_kind not null,
  state public.source_state not null default 'not_configured',
  -- Objects an administrator enabled in step 4 of the wizard. A source may not
  -- supply an object type absent from this list.
  enabled_objects public.canonical_object_type[] not null default '{}',
  active_mapping_version_id uuid,
  owner_label text not null check (char_length(owner_label) between 1 and 200),
  last_event_at timestamptz,
  last_successful_sync_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

-- Child tables reference this pair so a source can never be adopted by another
-- tenant's ingestion row.
alter table public.data_sources
  drop constraint if exists data_sources_id_workspace_key;
alter table public.data_sources
  add constraint data_sources_id_workspace_key unique (id, workspace_id);

create index if not exists data_sources_workspace_idx
  on public.data_sources (workspace_id);

drop trigger if exists trg_data_sources_updated_at on public.data_sources;
create trigger trg_data_sources_updated_at before update on public.data_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------- source_credentials --

do $$ begin
  create type public.credential_type as enum
    ('oauth', 'hmac_signing_secret', 'bearer_token');
exception when duplicate_object then null; end $$;

create table if not exists public.source_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null,
  credential_type public.credential_type not null,
  -- Opaque pointer into the secret manager. Never the secret itself.
  provider_ref text not null check (char_length(provider_ref) between 1 and 500),
  -- Non-secret identifier, safe to show an administrator.
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{16}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade
);

create index if not exists source_credentials_source_idx
  on public.source_credentials (source_id);

comment on table public.source_credentials is
  'Secret references only. The value lives in an approved secret manager; nothing here can return it.';

-- --------------------------------------------------------- source_scopes --

create table if not exists public.source_scopes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null,
  scope text not null check (char_length(scope) between 1 and 200),
  -- v1 connections are read-only. `write` is representable so it can be
  -- rejected explicitly rather than omitted and silently permitted later.
  access text not null check (access in ('read', 'write')),
  object_type public.canonical_object_type,
  business_reason text not null check (char_length(business_reason) between 1 and 500),
  customer_facing boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade,
  -- An approval is a person and a moment together, never one without the other.
  constraint source_scopes_approval_complete
    check ((approved_at is null) = (approved_by is null)),
  -- v1 refuses write scope at the schema level, so no code path can grant it.
  constraint source_scopes_read_only_v1 check (access = 'read')
);

create index if not exists source_scopes_source_idx
  on public.source_scopes (source_id);

-- ------------------------------------------------- source_mapping_versions --

create table if not exists public.source_mapping_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null,
  version integer not null check (version > 0),
  state public.mapping_version_state not null default 'draft',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade,
  unique (source_id, version),
  constraint mapping_version_published_state
    check ((state = 'published') = (published_at is not null) or state = 'superseded')
);

alter table public.source_mapping_versions
  drop constraint if exists source_mapping_versions_id_workspace_key;
alter table public.source_mapping_versions
  add constraint source_mapping_versions_id_workspace_key unique (id, workspace_id);

create index if not exists source_mapping_versions_source_idx
  on public.source_mapping_versions (source_id);

-- The active mapping must belong to the same workspace as the source.
alter table public.data_sources
  drop constraint if exists data_sources_active_mapping_fk;
alter table public.data_sources
  add constraint data_sources_active_mapping_fk
  foreign key (active_mapping_version_id, workspace_id)
  references public.source_mapping_versions (id, workspace_id) on delete set null;

-- -------------------------------------------------- source_field_mappings --

create table if not exists public.source_field_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mapping_version_id uuid not null,
  object_type public.canonical_object_type not null,
  source_field text not null check (char_length(source_field) between 1 and 255),
  canonical_field text check (canonical_field is null or char_length(canonical_field) between 1 and 255),
  disposition public.field_mapping_disposition not null,
  transform public.field_transform not null default 'none',
  required boolean not null default false,
  -- Advisory only. An administrator still decides. Section 6.3 step 5.
  suggestion_confidence numeric check (
    suggestion_confidence is null or (suggestion_confidence between 0 and 1)
  ),
  warning text check (warning is null or char_length(warning) <= 500),
  created_at timestamptz not null default now(),
  foreign key (mapping_version_id, workspace_id)
    references public.source_mapping_versions (id, workspace_id) on delete cascade,
  unique (mapping_version_id, object_type, source_field),
  -- Every source field gets a decision, and only a mapped field names a target.
  constraint field_mapping_target_matches_disposition
    check ((disposition = 'mapped') = (canonical_field is not null))
);

create index if not exists source_field_mappings_version_idx
  on public.source_field_mappings (mapping_version_id);

-- ---------------------------------------------------- source_sync_cursors --

create table if not exists public.source_sync_cursors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null,
  object_type public.canonical_object_type not null,
  cursor_value text not null default '' check (char_length(cursor_value) <= 1000),
  last_reconciled_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (source_id, workspace_id)
    references public.data_sources (id, workspace_id) on delete cascade,
  unique (source_id, object_type)
);

drop trigger if exists trg_source_sync_cursors_updated_at on public.source_sync_cursors;
create trigger trg_source_sync_cursors_updated_at before update on public.source_sync_cursors
  for each row execute function public.set_updated_at();

comment on table public.data_sources is
  'Registered origins of inbound data. A source writes staging tables only, never operational CRM tables.';
