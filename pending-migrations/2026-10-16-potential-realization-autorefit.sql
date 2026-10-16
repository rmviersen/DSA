-- APPLIED 2026-10-16 via the Supabase connector (record of what was run). Project onclzyjhfkgonemcpcmo.
-- Auto-refit support for the age-aware Potential curve (see lib/potential-realization-refit.ts and HANDOFF.md):
-- evidence metadata on each curve set, plus an atomic "make this set the active one" function so a failed switch can never leave a league
-- with no active curve (which would silently turn the age adjustment off).

ALTER TABLE public.potential_realization_sets
  ADD COLUMN source text NOT NULL DEFAULT 'manual',   -- 'seed' | 'manual' | 'auto'
  ADD COLUMN fit_through_game_date date,               -- game date of the newest ratings snapshot the fit used (drives the "30 days of new evidence" rate limit)
  ADD COLUMN n_pairs integer,                          -- snapshot pairs (about a year apart) the fit used
  ADD COLUMN gate_report jsonb;                        -- backtest-gate result + the unclamped candidate curve

UPDATE public.potential_realization_sets SET source = 'seed', fit_through_game_date = DATE '2033-01-16' WHERE id = 1;

CREATE FUNCTION public.activate_potential_realization_set(p_set_id bigint) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE lid integer;
BEGIN
  SELECT dsa_league_id INTO lid FROM potential_realization_sets WHERE id = p_set_id;
  IF lid IS NULL THEN RAISE EXCEPTION 'unknown potential_realization set %', p_set_id; END IF;
  UPDATE potential_realization_sets SET is_active = false WHERE dsa_league_id = lid AND is_active AND id <> p_set_id;
  UPDATE potential_realization_sets SET is_active = true WHERE id = p_set_id;
END
$fn$;
REVOKE EXECUTE ON FUNCTION public.activate_potential_realization_set(bigint) FROM PUBLIC, anon, authenticated;
