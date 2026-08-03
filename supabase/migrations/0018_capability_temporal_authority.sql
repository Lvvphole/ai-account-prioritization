-- Enforce temporal admissibility before a capability snapshot becomes current authority.
-- Ordinary stale evidence remains readable so the deterministic runtime can hold
-- only the affected account. Future evidence is rejected at ingestion because a
-- monotonic current-snapshot table cannot safely recover from a poisoned future value.

create or replace function public.enforce_account_source_capability_freshness()
returns trigger
language plpgsql
as $$
begin
  if new.observed_at > statement_timestamp() then
    raise exception 'account source capability observation time cannot be in the future'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.observed_at < old.observed_at then
      raise exception 'account source capability observation time cannot move backward'
        using errcode = '23514';
    end if;

    if new.observed_at = old.observed_at and (
      new.source is distinct from old.source
      or new.mapping_version is distinct from old.mapping_version
      or new.capabilities is distinct from old.capabilities
    ) then
      raise exception 'equal-time capability replay cannot replace authoritative content'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_account_source_capability_freshness on public.account_source_capabilities;
create trigger enforce_account_source_capability_freshness
  before insert or update on public.account_source_capabilities
  for each row execute function public.enforce_account_source_capability_freshness();
