-- Rank impact must be able to say "unavailable" (secure-ingestion spec, 7.2 step 8).
--
-- 0011 stored the top-N movement as `integer not null default 0`. The preview
-- computes it by running the canonical scorer over a scratch projection, and
-- that needs full scoring context; where the context is absent the preview
-- reports no number at all rather than one derived from a different ranking
-- than the product uses.
--
-- Against a NOT NULL DEFAULT 0 column, persisting that preview writes zero, and
-- an approver reads zero as "no account moves in or out of the top N". The
-- in-memory refusal to guess is undone by the write. So the column has to carry
-- the same distinction the preview does.
--
-- The CHECK is the point of this migration, not the nullability: it makes the
-- two states the only two representable ones. Either both counts are known and
-- there is no reason, or neither is known and the reason says why. A row that
-- claims a number and a reason at once, or neither, cannot exist.

alter table public.change_sets
  add column if not exists rank_impact_unavailable_reason text;

alter table public.change_sets
  alter column accounts_entering_top_n drop default,
  alter column accounts_entering_top_n drop not null,
  alter column accounts_leaving_top_n drop default,
  alter column accounts_leaving_top_n drop not null;

alter table public.change_sets
  drop constraint if exists change_sets_rank_impact_complete;
alter table public.change_sets
  add constraint change_sets_rank_impact_complete check (
    (
      accounts_entering_top_n is not null
      and accounts_leaving_top_n is not null
      and rank_impact_unavailable_reason is null
    )
    or (
      accounts_entering_top_n is null
      and accounts_leaving_top_n is null
      and rank_impact_unavailable_reason is not null
      and char_length(rank_impact_unavailable_reason) between 1 and 500
    )
  );

comment on column public.change_sets.rank_impact_unavailable_reason is
  'Why top-N movement could not be computed. Non-null exactly when the two counts are null.';
