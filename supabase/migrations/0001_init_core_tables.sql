-- 0001_init_core_tables.sql
-- Extensions, enums, and shared helpers. No tenant data yet.

create extension if not exists "pgcrypto";

-- Domain enums (mirror @repo/shared-schemas and supabase-client database.types).
do $$ begin
  create type public.app_role as enum ('rep', 'manager', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.account_tier as enum ('strategic', 'enterprise', 'mid_market', 'smb');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lifecycle_stage as enum
    ('prospect', 'open_opportunity', 'customer', 'renewal', 'churn_risk', 'dormant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contact_role as enum
    ('economic_buyer', 'champion', 'technical_evaluator', 'influencer', 'blocker', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.opportunity_stage as enum
    ('discovery', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_type as enum
    ('call', 'email_outbound', 'email_inbound', 'meeting', 'note', 'task', 'intent_event');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum
    ('not_required', 'pending_approval', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_decision as enum ('allowed', 'blocked', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- Shared trigger to maintain updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
