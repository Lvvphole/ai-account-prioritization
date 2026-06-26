-- seed.sql — LOCAL development seed only. Contains NO real secrets.
-- Demo credentials are obvious local placeholders; never use in any real env.

-- Demo auth users (local only). The on_auth_user_created trigger creates a
-- matching profiles row (default role 'rep'); we then promote manager/admin.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rep@example.com',
   crypt('local-dev-only', gen_salt('bf')), now(), now(), now(),
   '{"full_name":"Alex Rep"}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'manager@example.com',
   crypt('local-dev-only', gen_salt('bf')), now(), now(), now(),
   '{"full_name":"Morgan Manager"}'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'admin@example.com',
   crypt('local-dev-only', gen_salt('bf')), now(), now(), now(),
   '{"full_name":"Avery Admin"}')
on conflict (id) do nothing;

-- Ensure profiles exist and set roles.
insert into public.profiles (id, role, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'rep', 'Alex Rep'),
  ('22222222-2222-2222-2222-222222222222', 'manager', 'Morgan Manager'),
  ('33333333-3333-3333-3333-333333333333', 'admin', 'Avery Admin')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

-- Demo accounts owned by the rep.
insert into public.accounts
  (id, name, domain, owner_id, tier, lifecycle_stage, industry, employee_count,
   annual_revenue_usd, open_pipeline_usd, last_contacted_at, health_score,
   intent_signals, data_quality_flags)
values
  ('aaaaaaa1-0000-0000-0000-000000000001', 'Helios Manufacturing', 'helios-mfg.com',
   '11111111-1111-1111-1111-111111111111', 'strategic', 'open_opportunity', 'Industrial',
   4200, 820000000, 180000, now() - interval '23 days', 62,
   array['pricing_page_visit','demo_request'], array[]::text[]),
  ('aaaaaaa1-0000-0000-0000-000000000003', 'Cobalt Analytics', 'cobalt.example',
   '11111111-1111-1111-1111-111111111111', 'mid_market', 'churn_risk', 'Software',
   300, 40000000, 0, now() - interval '56 days', 31,
   array['support_escalation'], array[]::text[])
on conflict (id) do nothing;
