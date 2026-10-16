-- APPLIED 2026-10-16 via the Supabase connector (record of what was run; the connector had refused DDL on 2026-10-15).
-- (project onclzyjhfkgonemcpcmo). Curve set #1 for TBL was seeded by SQL and is active.
--
-- 2026-10-15 (Rees): age-aware Potential. R(age, type) = the share of a player's listed Potential gap expected to be realized, given the
-- development time he has left (see lib/potential-realization.ts and age-development-analysis.md). The engine applies
-- Potential_adjusted = Overall + R x (Potential - Overall). The curve is DATA, not code (like rating_weights), so it can be retuned or switched
-- off (deactivate the set -> the engine falls back to R = 1) without a deploy. Safe to run before or after the code ships: the engine does
-- nothing different until a set is ACTIVE.

CREATE TABLE public.potential_realization_sets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dsa_league_id integer NOT NULL REFERENCES public.leagues(id),
  label text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- At most one active set per league.
CREATE UNIQUE INDEX potential_realization_one_active ON public.potential_realization_sets (dsa_league_id) WHERE is_active;

CREATE TABLE public.potential_realization_rows (
  set_id bigint NOT NULL REFERENCES public.potential_realization_sets(id) ON DELETE CASCADE,
  player_type text NOT NULL CHECK (player_type IN ('H', 'P')),
  age integer NOT NULL,
  share numeric NOT NULL CHECK (share >= 0 AND share <= 1),
  PRIMARY KEY (set_id, player_type, age)
);

-- RLS is NOT automatic on a new table (HANDOFF section 3): default-deny, zero policies, like every other table.
ALTER TABLE public.potential_realization_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.potential_realization_rows ENABLE ROW LEVEL SECURITY;

-- Audit trail on every rated player: the RAW formula Potential before the age factor, and the factor applied. Lets any past run be
-- re-derived or backtested without losing the unadjusted series. (Written by compute-ratings.ts only while a set is active.)
ALTER TABLE public.player_computed
  ADD COLUMN potential_unadjusted_raw numeric,
  ADD COLUMN realization_share numeric;
