-- 0025_p4_qualification_invocation_audit.sql
-- Durable write-ahead audit evidence for live P4 qualification provider calls.
--
-- The provider process can append only through one RPC using a dedicated
-- least-privilege database role. A started record must be durable before the
-- provider request is sent. The table is append-only and has no browser policy.

do $$
begin
  create role p4_audit_writer nologin noinherit;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant p4_audit_writer to authenticator;
  end if;
end $$;

grant usage on schema public to p4_audit_writer;

create table if not exists public.p4_qualification_invocation_audit (
  run_id text not null check (run_id ~ '^[0-9]+$'),
  run_attempt integer not null check (run_attempt > 0),
  invocation_sequence integer not null check (invocation_sequence > 0),
  phase text not null check (phase in ('started', 'completed')),
  qualification_source_sha text not null check (
    qualification_source_sha ~ '^[a-f0-9]{40}$'
  ),
  control_revision text not null check (control_revision ~ '^[a-f0-9]{40}$'),
  publisher_revision text not null check (publisher_revision ~ '^[a-f0-9]{40}$'),
  record jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, run_attempt, invocation_sequence, phase)
);

alter table public.p4_qualification_invocation_audit enable row level security;
revoke all on public.p4_qualification_invocation_audit
  from public, anon, authenticated, p4_audit_writer;

drop trigger if exists trg_p4_qualification_invocation_audit_append_only
  on public.p4_qualification_invocation_audit;
create trigger trg_p4_qualification_invocation_audit_append_only
  before update or delete on public.p4_qualification_invocation_audit
  for each row execute function public.forbid_update_delete();

create or replace function public.append_p4_qualification_invocation_audit(
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id text;
  v_run_attempt integer;
  v_sequence integer;
  v_phase text;
  v_source_sha text;
  v_control_revision text;
  v_publisher_revision text;
  v_provider text;
  v_model text;
  v_timestamp timestamptz;
  v_request_body_json text;
  v_request_body_sha text;
  v_request_body jsonb;
  v_existing jsonb;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'P4 invocation audit record must be a JSON object'
      using errcode = '22023';
  end if;

  if p_record ->> 'kind' <> 'p4-provider-invocation-v2' then
    raise exception 'P4 invocation audit kind is invalid'
      using errcode = '22023';
  end if;

  v_run_id := p_record ->> 'runId';
  if v_run_id is null or v_run_id !~ '^[0-9]+$' then
    raise exception 'P4 invocation audit runId is invalid'
      using errcode = '22023';
  end if;

  if coalesce(p_record ->> 'runAttempt', '') !~ '^[1-9][0-9]*$' then
    raise exception 'P4 invocation audit runAttempt is invalid'
      using errcode = '22023';
  end if;
  v_run_attempt := (p_record ->> 'runAttempt')::integer;

  if coalesce(p_record ->> 'sequence', '') !~ '^[1-9][0-9]*$' then
    raise exception 'P4 invocation audit sequence is invalid'
      using errcode = '22023';
  end if;
  v_sequence := (p_record ->> 'sequence')::integer;

  v_phase := p_record ->> 'phase';
  if v_phase is null or v_phase not in ('started', 'completed') then
    raise exception 'P4 invocation audit phase is invalid'
      using errcode = '22023';
  end if;

  v_source_sha := p_record ->> 'qualificationSourceSha';
  v_control_revision := p_record ->> 'controlRevision';
  v_publisher_revision := p_record ->> 'publisherRevision';
  if coalesce(v_source_sha, '') !~ '^[a-f0-9]{40}$'
     or coalesce(v_control_revision, '') !~ '^[a-f0-9]{40}$'
     or coalesce(v_publisher_revision, '') !~ '^[a-f0-9]{40}$' then
    raise exception 'P4 invocation audit revision metadata is invalid'
      using errcode = '22023';
  end if;

  v_provider := p_record ->> 'provider';
  if v_provider is null
     or v_provider not in ('anthropic', 'openai', 'xai', 'google') then
    raise exception 'P4 invocation audit provider is invalid'
      using errcode = '22023';
  end if;

  v_model := nullif(btrim(p_record ->> 'model'), '');
  if v_model is null then
    raise exception 'P4 invocation audit model is required'
      using errcode = '22023';
  end if;

  begin
    v_timestamp := (p_record ->> 'timestamp')::timestamptz;
  exception
    when others then
      raise exception 'P4 invocation audit timestamp is invalid'
        using errcode = '22023';
  end;

  if v_timestamp is null then
    raise exception 'P4 invocation audit timestamp is required'
      using errcode = '22023';
  end if;

  if v_phase = 'started' then
    v_request_body_json := p_record ->> 'requestBodyJson';
    v_request_body_sha := p_record ->> 'requestBodySha256';
    if nullif(v_request_body_json, '') is null
       or coalesce(v_request_body_sha, '') !~ '^[a-f0-9]{64}$' then
      raise exception 'P4 started invocation request evidence is incomplete'
        using errcode = '22023';
    end if;

    begin
      v_request_body := v_request_body_json::jsonb;
    exception
      when others then
        raise exception 'P4 started invocation request body is invalid JSON'
          using errcode = '22023';
    end;

    if jsonb_typeof(v_request_body) <> 'object' then
      raise exception 'P4 started invocation request body must be a JSON object'
        using errcode = '22023';
    end if;

    if encode(digest(convert_to(v_request_body_json, 'UTF8'), 'sha256'), 'hex')
       <> v_request_body_sha then
      raise exception 'P4 started invocation request body hash does not match'
        using errcode = '22023';
    end if;
  else
    if coalesce(p_record ->> 'durationMs', '') !~ '^[0-9]+$' then
      raise exception 'P4 completed invocation durationMs is invalid'
        using errcode = '22023';
    end if;

    if p_record ->> 'outcome' = 'http_response' then
      if coalesce(p_record ->> 'httpStatus', '') !~ '^[1-5][0-9]{2}$' then
        raise exception 'P4 completed invocation httpStatus is invalid'
          using errcode = '22023';
      end if;
    elsif p_record ->> 'outcome' = 'network_error' then
      if nullif(btrim(p_record ->> 'errorName'), '') is null then
        raise exception 'P4 completed invocation errorName is required'
          using errcode = '22023';
      end if;
    else
      raise exception 'P4 completed invocation outcome is invalid'
        using errcode = '22023';
    end if;
  end if;

  insert into public.p4_qualification_invocation_audit (
    run_id,
    run_attempt,
    invocation_sequence,
    phase,
    qualification_source_sha,
    control_revision,
    publisher_revision,
    record
  ) values (
    v_run_id,
    v_run_attempt,
    v_sequence,
    v_phase,
    v_source_sha,
    v_control_revision,
    v_publisher_revision,
    p_record
  )
  on conflict (run_id, run_attempt, invocation_sequence, phase) do nothing;

  if found then
    return jsonb_build_object('status', 'recorded', 'replayed', false);
  end if;

  select a.record
    into v_existing
    from public.p4_qualification_invocation_audit a
   where a.run_id = v_run_id
     and a.run_attempt = v_run_attempt
     and a.invocation_sequence = v_sequence
     and a.phase = v_phase;

  if v_existing is distinct from p_record then
    raise exception 'P4 invocation audit identity already has different evidence'
      using errcode = '23505';
  end if;

  return jsonb_build_object('status', 'recorded', 'replayed', true);
end;
$$;

revoke all on function public.append_p4_qualification_invocation_audit(jsonb)
  from public, anon, authenticated;
grant execute on function public.append_p4_qualification_invocation_audit(jsonb)
  to p4_audit_writer;

comment on table public.p4_qualification_invocation_audit is
  'Append-only write-ahead audit evidence for live P4 provider invocations. Browser roles have no access.';
comment on function public.append_p4_qualification_invocation_audit(jsonb) is
  'Validates and appends one idempotent P4 provider invocation audit record through the least-privilege p4_audit_writer role.';
