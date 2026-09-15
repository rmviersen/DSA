import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { fitMultipleLinear } from "../lib/regression.js";
import { persistWeightTuningRun } from "../lib/weight-tuning-persist.js";
import { getLeagueId, leagueSlugFromArgv, getCurrentSeasonYear, getMlbLeagueId, getWeightTuningSeasons } from "../lib/league.js";

// Step 1 of the decomposed offense/defense redesign (2026-09-01, Rees's
// ask, replacing the retired role-calibrated fielding weight -- see the
// "Rating Engine Redesign" writeup). Tunes the hit-tool weights
// (Contact/Gap/Power/Eye/Avoid-Ks) against a standardized offensive
// outcome, OPS+, pooled across EVERY real MLB hitter regardless of role.
//
// Deliberately NOT restriction-of-range confounded the way the fielding
// weight attempt was: role assignment gates on ifr/ofr/pot_ss/etc., never
// on the hit-tool grades, so pooling every role together doesn't compress
// any of these variables' variance the way it compressed ifr/ofr within
// SS/CF. This is a genuinely different, unconfounded regression, not the
// same mistake with different inputs.
//
// Speed IS included (fixed 2026-09-02 -- an earlier version of this script
// excluded it on the reasoning that OPS+ doesn't capture baserunning value,
// which is true but beside the point: Speed is already one of Batting's own
// weighted inputs today (`battingRaw = ... + speed * w.speed`), for a real,
// separate reason Rees confirmed directly -- faster batters beat out more
// infield hits and stretch more doubles into triples, both of which DO show
// up in OPS+ (OBP and SLG respectively). Speed's STEALING-adjacent value is
// what's baserunning-only and correctly lives in the separate Baserunning
// composite instead (see compute-baserunning-weights.ts) -- that's a
// different mechanism from this one, not a duplicate of it.
//
// Fielding is still deliberately excluded -- it's never been one of
// Batting's own weighted inputs (it's added as its own separate composite
// in Overall), so it doesn't belong in a regression re-deriving Batting's
// internal weights.
//
// OPS+ doesn't exist anywhere in this schema yet (confirmed 2026-09-01 --
// player_batting_stats_snapshots has only raw counting stats, no OBP/SLG/
// OPS+ columns). This script computes the minimum real version needed
// here: league-wide OBP/SLG from every real qualifying season's MLB plate
// appearance (not just the 100+ PA qualifiers below -- restricting the
// LEAGUE baseline to only qualified regulars would bias it upward), then
// each qualifying player's OPS+ relative to that season's own baseline.
// This is the same league-average-by-level-and-year normalization
// HANDOFF.md already flags as an open item for the real OPS+/FIP- work --
// scoped here to exactly what this one regression needs (MLB level only),
// not the general system.
//
// MULTI-SEASON BLEND (2026-09-15, Rees's ask -- "the weights are being
// tuned off of just [the current] season... training data should run off
// any full or partial season we have rating data for"). Previously this
// only ever regressed against getCurrentSeasonYear() -- right while that
// was the only season with ratings history, wrong the moment a new season
// starts with a thin early sample. Now pools the current season with the
// most recent earlier season (see lib/league.ts's getWeightTuningSeasons),
// weighting each by a real, PA-based season-progress signal: the current
// season starts near-irrelevant and ramps up to being equally weighted
// with the prior FULL season only once it's genuinely complete itself --
// never beyond that. Each season's grades are read from THAT season's own
// refresh run (ratings/roles have no `year` column -- they're point-in-time
// snapshots), not "whatever's current now," so a player's 2031 OPS+ is
// matched against his real 2031 grades, not his 2032 ones.
//
// This is diagnostic only -- prints results, writes nothing to
// rating_weights or any other table. A weight change only ships after
// Rees reviews the actual numbers, same discipline as every other
// engine-affecting analysis this session.

const PAGE_SIZE = 1000;
async function fetchAll<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

const MIN_PA = 100; // same qualifying threshold as /admin/rating-validation, for the regression sample -- NOT applied to the league OPS+ baseline itself

interface BattingRow {
  player_id: number; team_id: number | null; pa: number | null; ab: number | null; h: number | null; bb: number | null;
  hp: number | null; sf: number | null; d: number | null; t: number | null; hr: number | null;
}

// Aggregated in terms of the four hit CATEGORIES rather than raw h/d/t/hr,
// so park adjustment (below) can divide each category by its own factor
// before they're ever recombined -- this is what "separate adjustments,
// not one blended factor" (Rees's ask) actually requires structurally.
interface HitCategories { ab: number; bb: number; hp: number; sf: number; singles: number; doubles: number; triples: number; hr: number }

function obpSlg(b: HitCategories) {
  const h = b.singles + b.doubles + b.triples + b.hr;
  const obDenom = b.ab + b.bb + b.hp + b.sf;
  const obp = obDenom > 0 ? (h + b.bb + b.hp) / obDenom : 0;
  const totalBases = b.singles + 2 * b.doubles + 3 * b.triples + 4 * b.hr;
  const slg = b.ab > 0 ? totalBases / b.ab : 0;
  return { obp, slg };
}

interface ParkFactors { average: number; doubles: number; triples: number; homeRuns: number }

// Real per-category park adjustment (2026-09-01, Rees's ask -- separate
// Doubles/Triples/HR adjustments, not one blended run factor). Each
// category is divided by ITS OWN factor to get the park-neutral-equivalent
// count for that stint, before the categories are ever recombined into H/
// TB. "Average" is used as the singles/contact-driven proxy (OOTP doesn't
// publish a separate singles factor) -- walks/HBP are left unadjusted,
// same as real-world practice, since they're not meaningfully park-driven.
//
// Only half of a team's park-factor deviation from 1.0 is applied
// (1 + (factor-1)*0.5) -- a player accumulates this stint's stats roughly
// half at this team's home park and half on the road against a mix of
// every other park, which nets out close to neutral. Full play-by-play
// location data would let this be exact; that's the deferred game-log/
// box-score work (see HANDOFF.md), not something this needs to wait on --
// this is the same approximation real park-adjusted stats use.
function applyParkFactor(stint: { ab: number; bb: number; hp: number; sf: number; h: number; d: number; t: number; hr: number }, pf: ParkFactors | undefined): HitCategories {
  const singles = stint.h - stint.d - stint.t - stint.hr;
  if (!pf) return { ab: stint.ab, bb: stint.bb, hp: stint.hp, sf: stint.sf, singles, doubles: stint.d, triples: stint.t, hr: stint.hr };
  const half = (f: number) => 1 + (f - 1) * 0.5;
  return {
    ab: stint.ab, bb: stint.bb, hp: stint.hp, sf: stint.sf,
    singles: singles / half(pf.average),
    doubles: stint.d / half(pf.doubles),
    triples: stint.t / half(pf.triples),
    hr: stint.hr / half(pf.homeRuns),
  };
}

function addCategories(a: HitCategories, b: HitCategories): HitCategories {
  return { ab: a.ab + b.ab, bb: a.bb + b.bb, hp: a.hp + b.hp, sf: a.sf + b.sf, singles: a.singles + b.singles, doubles: a.doubles + b.doubles, triples: a.triples + b.triples, hr: a.hr + b.hr };
}
const emptyCategories = (): HitCategories => ({ ab: 0, bb: 0, hp: 0, sf: 0, singles: 0, doubles: 0, triples: 0, hr: 0 });

interface Row { playerId: number; year: number; seasonWeight: number; opsPlus: number; opsPlusRaw: number; cntct: number; gap: number; pow: number; eye: number; ks: number; speed: number; pa: number }

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const currentYear = await getCurrentSeasonYear(supabase, leagueId);
  const mlbLeagueId = await getMlbLeagueId(supabase, leagueId);

  console.log("Resolving which seasons to pool and how heavily to weight each...");
  const seasons = await getWeightTuningSeasons(supabase, leagueId, currentYear);
  if (seasons.length === 0) {
    // Not an error -- a brand-new season with zero games played yet looks
    // exactly like this. See the historical version of this comment (now
    // folded into getWeightTuningSeasons' own doc comment) for the full
    // reasoning on why this logs and returns cleanly instead of throwing.
    console.log(`No ${currentYear} MLB batting stats yet -- likely just the start of a new season. Skipping this regression until real games have been played.`);
    return;
  }
  for (const s of seasons) console.log(`  ${s.year}: refresh_run_id ${s.statsRefreshRunId}, season weight ${s.weight.toFixed(3)}`);

  console.log(`Loading players (for the real-MLB-roster filter: league_id=${mlbLeagueId}, mlb_service_days>0)...`);
  const players = await fetchAll<{ id: number; league_id: number | null; mlb_service_days: number | null }>((from, to) =>
    supabase.from("players").select("id, league_id, mlb_service_days").eq("dsa_league_id", leagueId).range(from, to) as never
  );
  const playerMeta = new Map(players.map((p) => [p.id, p]));
  const isRealMlbPlayer = (playerId: number) => {
    const meta = playerMeta.get(playerId);
    return !!meta && meta.league_id === mlbLeagueId && (meta.mlb_service_days ?? 0) > 0;
  };

  const PITCHER_ROLES = new Set(["SP", "RP", "CL"]);
  const rows: Row[] = [];

  // Everything that used to happen once for "the current season" now runs
  // once PER SEASON being pooled -- same logic, just parameterized by that
  // season's own year + refresh_run_id, since ratings/roles/park factors
  // all need to be read as of THAT point in time, not "now."
  for (const season of seasons) {
    const { year, statsRefreshRunId } = season;
    console.log(`\n--- ${year} (refresh_run_id ${statsRefreshRunId}) ---`);

    console.log(`Loading every real ${year} MLB batting stint (for the league OPS+ baseline)...`);
    const allBatting = await fetchAll<BattingRow>((from, to) =>
      supabase.from("player_batting_stats_snapshots")
        .select("player_id, team_id, pa, ab, h, bb, hp, sf, d, t, hr")
        .eq("year", year).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRefreshRunId)
        .range(from, to) as never
    );

    console.log("Loading ballpark factors (latest snapshot at or before this run, per team)...");
    const parkRows = await fetchAll<{ team_id: number; refresh_run_id: number; average: number | null; doubles: number | null; triples: number | null; home_runs: number | null }>((from, to) =>
      supabase.from("ballpark_factor_snapshots").select("team_id, refresh_run_id, average, doubles, triples, home_runs")
        .eq("dsa_league_id", leagueId).lte("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );
    const parkByTeam = new Map<number, ParkFactors>();
    const parkRunIdByTeam = new Map<number, number>(); // tracks which refresh_run_id each parkByTeam entry came from, so the latest-as-of-this-run always wins
    for (const p of parkRows) {
      if (p.average == null || p.doubles == null || p.triples == null || p.home_runs == null) continue;
      if (p.refresh_run_id <= (parkRunIdByTeam.get(p.team_id) ?? -1)) continue;
      parkByTeam.set(p.team_id, { average: p.average, doubles: p.doubles, triples: p.triples, homeRuns: p.home_runs });
      parkRunIdByTeam.set(p.team_id, p.refresh_run_id);
    }
    console.log(`  ${parkByTeam.size} teams with park factors`);

    // Sum multi-stint rows within this one refresh run (a real mid-season
    // trade), same pattern as rating-validation-query.ts -- but each stint is
    // park-adjusted FIRST, using that stint's own team_id, before being added
    // into the player's season total. This is what correctly handles a
    // traded player: each stint is weighted by its own PA automatically
    // (adjustment happens on the stint's own raw counts) and attributed to
    // the correct park, not the whole season blended under one team's factor.
    // Filtered to real MLB roster players here too -- international/complex
    // signees shouldn't be part of a "real MLB league average" baseline
    // either.
    const byPlayerRaw = new Map<number, HitCategories>();
    const byPlayerAdjusted = new Map<number, HitCategories>();
    const paByPlayer = new Map<number, number>();
    for (const b of allBatting) {
      if (!isRealMlbPlayer(b.player_id)) continue;
      const stint = { ab: b.ab ?? 0, bb: b.bb ?? 0, hp: b.hp ?? 0, sf: b.sf ?? 0, h: b.h ?? 0, d: b.d ?? 0, t: b.t ?? 0, hr: b.hr ?? 0 };
      const rawCats: HitCategories = { ab: stint.ab, bb: stint.bb, hp: stint.hp, sf: stint.sf, singles: stint.h - stint.d - stint.t - stint.hr, doubles: stint.d, triples: stint.t, hr: stint.hr };
      const adjustedCats = applyParkFactor(stint, b.team_id != null ? parkByTeam.get(b.team_id) : undefined);
      byPlayerRaw.set(b.player_id, addCategories(byPlayerRaw.get(b.player_id) ?? emptyCategories(), rawCats));
      byPlayerAdjusted.set(b.player_id, addCategories(byPlayerAdjusted.get(b.player_id) ?? emptyCategories(), adjustedCats));
      paByPlayer.set(b.player_id, (paByPlayer.get(b.player_id) ?? 0) + (b.pa ?? 0));
    }
    console.log(`  ${byPlayerRaw.size} real MLB hitters with any ${year} PA`);

    // League baseline stays RAW/unadjusted -- it's the empirical run-scoring
    // environment as actually observed, exactly like a real MLB league
    // average is never itself park-adjusted. Only individual players get
    // adjusted, so their park-neutral rate can be compared fairly against
    // this shared, real baseline. Computed separately PER SEASON -- 2031's
    // run environment isn't 2032's.
    let leagueTotals = emptyCategories();
    for (const b of byPlayerRaw.values()) leagueTotals = addCategories(leagueTotals, b);
    const league = obpSlg(leagueTotals);
    console.log(`League baseline (real ${year} MLB hitters, unadjusted): OBP=${league.obp.toFixed(3)} SLG=${league.slg.toFixed(3)}`);

    console.log(`Loading ${year} hit-tool grades (as of this season's own refresh run)...`);
    const ratings = await fetchAll<{ player_id: number; cntct: number | null; gap: number | null; pow: number | null; eye: number | null; ks: number | null; speed: number | null }>((from, to) =>
      supabase.from("player_ratings_snapshots").select("player_id, cntct, gap, pow, eye, ks, speed").eq("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );
    const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));

    console.log(`Loading ${year} roles (hitters only, exclude SP/RP/CL from this offense-only regression)...`);
    const computed = await fetchAll<{ player_id: number; role: string | null }>((from, to) =>
      supabase.from("player_computed").select("player_id, role").eq("refresh_run_id", statsRefreshRunId).range(from, to) as never
    );
    const roleByPlayer = new Map(computed.map((c) => [c.player_id, c.role]));

    let seasonRowCount = 0;
    for (const [playerId, adjusted] of byPlayerAdjusted) {
      const pa = paByPlayer.get(playerId) ?? 0;
      if (pa < MIN_PA) continue;
      const role = roleByPlayer.get(playerId);
      if (!role || PITCHER_ROLES.has(role)) continue;
      const r = ratingsByPlayer.get(playerId);
      if (!r || r.cntct == null || r.gap == null || r.pow == null || r.eye == null || r.ks == null || r.speed == null) continue;
      const { obp, slg } = obpSlg(adjusted);
      const opsPlus = 100 * (obp / league.obp + slg / league.slg - 1);
      const rawCats = byPlayerRaw.get(playerId)!;
      const rawSplit = obpSlg(rawCats);
      const opsPlusRaw = 100 * (rawSplit.obp / league.obp + rawSplit.slg / league.slg - 1);
      rows.push({ playerId, year, seasonWeight: season.weight, opsPlus, opsPlusRaw, cntct: r.cntct, gap: r.gap, pow: r.pow, eye: r.eye, ks: r.ks, speed: r.speed, pa });
      seasonRowCount++;
    }
    console.log(`  ${seasonRowCount} qualifying ${year} hitters (>=${MIN_PA} PA, real grades)`);
  }

  console.log(`\n${rows.length} total qualifying hitter-seasons pooled across ${seasons.length} season(s) for the regression`);
  const avgAbsDelta = rows.reduce((s, r) => s + Math.abs(r.opsPlus - r.opsPlusRaw), 0) / rows.length;
  const maxDelta = rows.reduce((m, r) => Math.max(m, Math.abs(r.opsPlus - r.opsPlusRaw)), 0);
  console.log(`  Park adjustment moved OPS+ by an average of ${avgAbsDelta.toFixed(2)} points per player-season (max ${maxDelta.toFixed(2)})`);
  if (rows.length < 30) throw new Error(`Only ${rows.length} qualifying hitter-seasons -- too small to trust a 6-variable regression. Aborting.`);

  // Per-row weight spreads each season's target weight (season.weight, 0-1)
  // evenly across however many rows that season actually contributed --
  // this is what makes "2031 and 2032 are equally important" mean equal
  // TOTAL influence on the fit regardless of how many hitters happen to
  // qualify in a still-partial 2032, not "each individual hitter-season
  // counts the same." When only one season is pooled, every row gets the
  // same weight (season.weight / n), which is mathematically identical to
  // plain unweighted OLS (see fitMultipleLinear's own comment) -- so this
  // is exactly backward compatible with single-season behavior.
  const rowCountByYear = new Map<number, number>();
  for (const r of rows) rowCountByYear.set(r.year, (rowCountByYear.get(r.year) ?? 0) + 1);
  const weightedRows = rows.map((r) => ({ x: [r.cntct, r.gap, r.pow, r.eye, r.ks, r.speed], y: r.opsPlus, weight: r.seasonWeight / rowCountByYear.get(r.year)! }));

  const fit = fitMultipleLinear(weightedRows);
  const labels = ["Contact", "Gap", "Power", "Eye", "Avoid Ks", "Speed"];

  console.log(`\nRegression: OPS+ ~ Contact + Gap + Power + Eye + AvoidKs  (n=${rows.length}, R²=${fit.rSquared.toFixed(3)})`);
  console.log(`Intercept: ${fit.intercept.toFixed(2)}`);
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(10)} raw coef=${fit.coefficients[i].toFixed(3)} OPS+ pts/grade-pt   standardized=${fit.standardizedCoefficients[i].toFixed(3)}`);
  }

  // Implied weight uses RAW coefficients, not standardized ones -- bug fixed
  // 2026-09-02 (see compute-overall-blend-weights.ts's comment for the full
  // story). Applying standardized-derived weights to raw values silently
  // reintroduces each variable's own scale; raw coefficients are already in
  // real units and are what's dimensionally correct to normalize and apply
  // directly to raw grades. Low practical impact here specifically -- these
  // six grades are all individual 20-80 scouting grades with comparable
  // population SDs (7-11) -- but fixed for consistency regardless.
  const clamped = fit.coefficients.map((c) => Math.max(0, c));
  const sum = clamped.reduce((s, c) => s + c, 0);
  const normalized = sum > 0 ? clamped.map((c) => c / sum) : clamped.map(() => 0);

  console.log("\nLoading the live active weight set (for the current-weight comparison column)...");
  const { data: weightRow } = await supabase.from("rating_weights").select("contact, gap, power, eye, avoid_ks, speed").eq("dsa_league_id", leagueId).eq("is_active", true).maybeSingle();
  const current = weightRow as { contact: number; gap: number; power: number; eye: number; avoid_ks: number; speed: number } | null;
  const currentByKey: Record<string, number | null> = {
    Contact: current?.contact ?? null, Gap: current?.gap ?? null, Power: current?.power ?? null,
    Eye: current?.eye ?? null, "Avoid Ks": current?.avoid_ks ?? null, Speed: current?.speed ?? null,
  };

  console.log("\nImplied weight vector if normalized to sum to 1 (diagnostic -- not written to rating_weights):");
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i].padEnd(10)} implied=${normalized[i].toFixed(3)}   current=${(currentByKey[labels[i]] ?? NaN).toFixed(3)}`);
  }

  const seasonLabel = seasons.length > 1
    ? `${seasons.map((s) => `${s.year} (w=${s.weight.toFixed(2)})`).join(" + ")} blend`
    : `${seasons[0].year}`;
  console.log("\nSaving this run to weight_tuning_runs/weight_tuning_coefficients (for /admin/weight-tuning)...");
  await persistWeightTuningRun(supabase, {
    refreshRunId: seasons[seasons.length - 1].statsRefreshRunId, // the current season's own run -- "as of now" for the page's own refresh-run display
    leagueId,
    stream: "hitting",
    targetMetric: `OPS+ (park-adjusted, ${seasonLabel})`,
    rSquared: fit.rSquared,
    sampleSize: rows.length,
    coefficients: labels.map((label, i) => ({
      key: label.toLowerCase().replace(/\s+/g, "_"),
      label,
      rawCoefficient: fit.coefficients[i],
      standardizedCoefficient: fit.standardizedCoefficients[i],
      impliedWeight: normalized[i],
      currentWeight: currentByKey[label],
    })),
  });

  console.log("\nDone -- rating_weights itself is untouched; this only saved the diagnostic history.");
}

main().catch((err) => {
  console.error("compute-hitting-weights failed:", err);
  process.exit(1);
});
