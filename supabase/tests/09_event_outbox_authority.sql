-- PR #40 regression: source-adapter INSERT authority must not be able to
-- manufacture publication state, and the database must retain an insert guard.
do $$
begin
  if not has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'source_event_id',
    'INSERT'
  ) then
    raise exception 'service_role must be able to insert outbox event identity';
  end if;

  if has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'status',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert outbox publication status';
  end if;

  if has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'workflow_run_id',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert workflow publication evidence';
  end if;

  if has_column_privilege(
    'service_role',
    'public.integration_event_outbox',
    'published_at',
    'INSERT'
  ) then
    raise exception 'service_role must not be able to insert published timestamps';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'integration_event_outbox'
      and t.tgname = 'enforce_integration_event_outbox_insert'
      and not t.tgisinternal
  ) then
    raise exception 'integration_event_outbox insert-state guard trigger is missing';
  end if;
end
$$;
