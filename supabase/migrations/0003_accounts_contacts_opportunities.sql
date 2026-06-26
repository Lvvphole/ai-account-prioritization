-- 0003_accounts_contacts_opportunities.sql
-- Core CRM domain tables, owned by a rep (profiles.id).

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  tier public.account_tier not null,
  lifecycle_stage public.lifecycle_stage not null,
  industry text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  annual_revenue_usd numeric check (annual_revenue_usd is null or annual_revenue_usd >= 0),
  open_pipeline_usd numeric not null default 0 check (open_pipeline_usd >= 0),
  last_contacted_at timestamptz,
  health_score integer check (health_score is null or (health_score between 0 and 100)),
  intent_signals text[] not null default '{}',
  data_quality_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_accounts_owner on public.accounts (owner_id);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  title text,
  email text,
  role public.contact_role not null default 'unknown',
  is_primary boolean not null default false,
  last_engaged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_contacts_account on public.contacts (account_id);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  stage public.opportunity_stage not null,
  amount_usd numeric not null default 0 check (amount_usd >= 0),
  probability numeric not null default 0 check (probability between 0 and 1),
  close_date timestamptz,
  is_closed boolean not null default false,
  is_won boolean not null default false,
  next_step text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_opportunities_account on public.opportunities (account_id);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  type public.activity_type not null,
  subject text,
  body text,
  occurred_at timestamptz not null,
  created_by_id uuid not null,
  verified boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_activities_account on public.activities (account_id);

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_opportunities_updated_at on public.opportunities;
create trigger trg_opportunities_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();
