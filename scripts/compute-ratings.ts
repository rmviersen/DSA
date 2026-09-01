import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { computeRatings, type RatingsInput, type WeightSet, type HandednessSplits } from "../lib/rating-engine.js";

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

// Not a real players.level value -- international/complex signees are
// actually stored at level=1 with a negative league_id (same convention
// org-minors-query.ts's `isInternational` uses), not a distinct level code
// of their own. Remapped to a synthetic level 7 ("below Rookie") wherever
// level matters for ETA/benchmarks, so they get their own rung on the
// ladder instead of either polluting the MLB row or being silently
// dropped (Rees 2026-08-24 -- they were falling into the latter between
// the is_active fix and this remap).
const INTERNATIONAL_LEVEL = 7;
function effectiveLevel(level: number | null | undefined, leagueId: number | null | undefined): number | null {
  if (level === 1 && leagueId != null && leagueId < 0) return INTERNATIONAL_LEVEL;
  return level ?? null;
}

// Pace tiers (years per level climbed), by how far a player's POTENTIAL
// clears their role's own MLB bar -- a bigger cushion above the bar means
// a more likely fast-track; just barely clearing it means the full,
// normal development runway. Starting values per Rees 2026-08-24, tune
// from here once seen against real players.
function paceYearsPerLevel(marginAboveBar: number): number {
  if (marginAboveBar >= 15) return 0.8; // fast-tracked, true impact-caliber ceiling
  if (marginAboveBar >= 8) return 1.0; // normal development pace
  return 1.3; // fringe -- just clears the bar, needs the full runway
}

// --- Shared, NOT run-scoped ------------------------------------------
// Everything here is either a global setting (the active weight set) or a
// genuine career-spanning total that by definition has to look across
// every refresh, not just one -- loaded ONCE regardless of how many
// refresh runs get (re)computed in a single invocation of this script,
// both for speed (players alone is ~46k rows) and because none of it
// actually varies by which run is being processed.
//
// One real, deliberate simplification worth being explicit about (2026-09-02,
// added for the full-history backfill): `players` is a CURRENT-STATE
// reference table, not time-series (see HANDOFF.md's schema design notes) --
// there is no historical snapshot of what a player's age/org/level/service-
// days actually were as of some OLD refresh_run_id. Backfilling old runs
// under a new weight set necessarily recomputes their Batting/Fielding/
// Baserunning/Pitching/Overall/Potential from that run's OWN ratings
// snapshot (which IS point-in-time and correct), but blends in TODAY's
// player-table state for anything that depends on it (prospect-pool
// eligibility, org, ETA role/level benchmarks, career workload). That's an
// approximation, not a perfect historical reconstruction -- acceptable
// because the actual ask driving this (Rees, 2026-09-02) is "make sure the
// CORE VALUATIONS reflect the new weighting model across history," not
// "reconstruct exactly what the site would have shown on that old date."
async function loadSharedContext(supabase: ReturnType<typeof makeSupabaseClient>) {
  console.log("Loading active weight set...");
  const { data: weightRow, error: weightErr } = await supabase.from("rating_weights").select("*").eq("is_active", true).single();
  if (weightErr || !weightRow) throw new Error(`No active weight set found: ${weightErr?.message}`);
  const weights: WeightSet = weightRow as WeightSet;
  console.log(`Using weight set #${weights.id}: "${(weightRow as { label: string }).label}"`);

  // Role-calibrated fielding weight (2026-08-31) -- fielding_role_weights is
  // computed separately by scripts/compute-fielding-weights.ts (its own
  // refresh_run_id, one run behind this one, same lag already accepted
  // elsewhere in this pipeline e.g. contracts vs. ratings). Missing
  // entirely (table never populated yet) or missing a specific role both
  // fall back to a multiplier of 1 inside computeRatings -- today's flat
  // w.fielding behavior, unchanged. Retired as of 2026-09-02 (see
  // HANDOFF.md) -- every role reads back 1.0 regardless, kept wired in
  // rather than ripped out since it's a harmless no-op.
  console.log("Loading role-calibrated fielding weights (if any exist yet)...");
  const { data: fieldingWeightRows } = await supabase
    .from("fielding_role_weights").select("refresh_run_id, role, relative_multiplier").order("refresh_run_id", { ascending: false });
  const fieldingWeights: Record<string, number> = {};
  if (fieldingWeightRows && fieldingWeightRows.length > 0) {
    const latestFieldingRunId = (fieldingWeightRows[0] as { refresh_run_id: number }).refresh_run_id;
    for (const row of fieldingWeightRows as { refresh_run_id: number; role: string; relative_multiplier: number }[]) {
      if (row.refresh_run_id === latestFieldingRunId) fieldingWeights[row.role] = row.relative_multiplier;
    }
    console.log(`  Using fielding weights from refresh_run_id ${latestFieldingRunId}: ${JSON.stringify(fieldingWeights)}`);
  } else {
    console.log("  None found yet -- every role uses the flat w.fielding baseline this run.");
  }

  // --- Player-comp career workload, 2026-08-31 (Rees's spec) ----------
  // Career MLB AB/IP for EVERY player who's ever appeared at level_id=1,
  // summed across ALL refresh runs -- not scoped to any one refreshRunId,
  // because a career total by definition has to look further back than any
  // single refresh. Same dedup need as lib/player-detail-query.ts's
  // latestPerStint (a player's early-career years only exist under the old
  // one-time backfill run, and a season that got re-pulled under a later
  // run shouldn't be double counted) -- reimplemented locally rather than
  // imported, since that helper lives in a browser-reachable lib module and
  // this is a standalone node script. ~76k total rows across both tables as
  // of 2026-08-31 -- fetchAll's normal pagination handles that fine, this is
  // a one-time cost per script invocation, not per-refresh-run.
  console.log("Loading career MLB workload (for the player-comp established-player pool)...");
  function latestPerStint<T extends { player_id: number; year: number; stint: number | null; refresh_run_id: number }>(rowsIn: T[]): T[] {
    const best = new Map<string, T>();
    for (const row of rowsIn) {
      const key = `${row.player_id}|${row.year}|${row.stint ?? 0}`;
      const existing = best.get(key);
      if (!existing || row.refresh_run_id > existing.refresh_run_id) best.set(key, row);
    }
    return [...best.values()];
  }
  const careerBatRows = await fetchAll<{ player_id: number; year: number; stint: number | null; refresh_run_id: number; ab: number | null }>((from, to) =>
    supabase.from("player_batting_stats_snapshots").select("player_id,year,stint,refresh_run_id,ab").eq("level_id", 1).eq("split_id", 1).range(from, to) as never
  );
  const careerPitRows = await fetchAll<{ player_id: number; year: number; stint: number | null; refresh_run_id: number; ip: number | null }>((from, to) =>
    supabase.from("player_pitching_stats_snapshots").select("player_id,year,stint,refresh_run_id,ip").eq("level_id", 1).eq("split_id", 1).range(from, to) as never
  );
  const careerAbByPlayer = new Map<number, number>();
  for (const row of latestPerStint(careerBatRows)) {
    careerAbByPlayer.set(row.player_id, (careerAbByPlayer.get(row.player_id) ?? 0) + (row.ab ?? 0));
  }
  const careerIpByPlayer = new Map<number, number>();
  for (const row of latestPerStint(careerPitRows)) {
    careerIpByPlayer.set(row.player_id, (careerIpByPlayer.get(row.player_id) ?? 0) + (row.ip ?? 0));
  }
  console.log(`  Career MLB AB known for ${careerAbByPlayer.size} players, IP known for ${careerIpByPlayer.size}`);

  console.log("Loading players (for org/rookie-eligibility context)...");
  // .order("id") required -- see HANDOFF.md gotcha 13. Without it, this
  // ~46-page fetch (45,757 rows) has no pagination stability guarantee,
  // which was silently skewing the handedness-split percentages below by
  // ~0.1pt (caught 2026-08-24 while verifying the Ks blend fix -- a
  // hand-computed split via direct SQL didn't match player_computed's
  // actual batting values until this was added).
  const players = await fetchAll<{ id: number; organization_id: number | null; mlb_service_days: number | null; last_team_id: number | null; level: number | null; is_active: boolean | null; league_id: number | null; age: number | null }>((from, to) =>
    supabase.from("players").select("id, organization_id, mlb_service_days, last_team_id, level, is_active, league_id, age").order("id").range(from, to) as never
  );
  const playerById = new Map(players.map((p) => [p.id, p]));
  console.log(`  ${players.length} players`);

  return { weights, fieldingWeights, players, playerById, careerAbByPlayer, careerIpByPlayer };
}

type SharedContext = Awaited<ReturnType<typeof loadSharedContext>>;

// --- Everything below is scoped to ONE refresh_run_id -----------------
async function computeRatingsForRun(supabase: ReturnType<typeof makeSupabaseClient>, refreshRunId: number, shared: SharedContext) {
  const { weights, fieldingWeights, players, playerById, careerAbByPlayer, careerIpByPlayer } = shared;

  console.log(`Computing against refresh_run_id ${refreshRunId}`);

  // ETA "is the season over" check (2026-08-31, Rees's spec) -- game_date is
  // "YYYY-MM-DD", sliced not Date-parsed to stay timezone-safe. Once the
  // in-game calendar is into October, the real regular season has ended and
  // the league's in its playoffs (confirmed against the actual current run:
  // game_date 2031-10-31) -- there is no more real chance of a call-up
  // "this year," so a same-year ETA stops meaning "could happen any day now"
  // and starts reading as "should already have happened," which is
  // backwards. See estimateEta below for where this is applied.
  const { data: runRow } = await supabase.from("refresh_runs").select("game_date").eq("id", refreshRunId).maybeSingle();
  const gameDate = (runRow as { game_date: string | null } | null)?.game_date ?? null;
  const gameDateMonth = gameDate ? Number(gameDate.slice(5, 7)) : null;
  const isOffseason = gameDateMonth !== null && gameDateMonth >= 10;
  console.log(`game_date=${gameDate}, isOffseason=${isOffseason}`);

  console.log("Loading ratings snapshot...");
  const ratings = await fetchAll<RatingsInput & { player_id: number }>((from, to) =>
    supabase.from("player_ratings_snapshots").select("*").eq("refresh_run_id", refreshRunId).range(from, to) as never
  );
  console.log(`  ${ratings.length} ratings rows`);
  if (ratings.length === 0) {
    console.warn(`  No ratings rows for refresh_run_id ${refreshRunId} -- skipping (nothing to compute).`);
    return;
  }
  // Used by the player-comp section further down to look up an established
  // candidate's raw CURRENT grades by id (the `ratings` array above is only
  // ever iterated in bulk elsewhere in this file).
  const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));

  // "Current year" -- no field gives us this directly, so we use the most
  // recent season we actually have stats for in this refresh. Falls back to
  // the captured_at year if no stats snapshot exists (e.g. first run with
  // --skip-ratings-only stats never pulled). Moved earlier in the file
  // 2026-08-24 so the handedness-split window below can use it too -- used
  // to only be needed for ETA math further down.
  const { data: yearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year")
    .eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const currentYear = (yearRow as { year: number } | null)?.year ?? new Date().getFullYear();
  console.log(`Using current_year=${currentYear}`);

  // --- Real league handedness splits, 2026-08-24 (Rees's spec) -------
  // How much of real MLB offense/pitching, over the last 3 seasons, actually
  // came against a left-handed vs. right-handed opponent -- a LEAGUE-WIDE
  // constant applied to every player's Batting/Pitching formula uniformly
  // (not each player's own personal AB/IP split history). MLB level only
  // (level=1). split_id 2 = vs-LHP/vs-LHB, split_id 3 = vs-RHP/vs-RHB --
  // not documented anywhere in the StatsPlus API, reverse-engineered by
  // checking real totals (split 3 consistently ~2x split 2, matching real
  // baseball's roughly 70/30 right-handed-heavy population) rather than
  // assumed.
  const last3Years = [currentYear - 2, currentYear - 1, currentYear];
  const mlbPlayerIds = players.filter((p) => p.level === 1).map((p) => p.id);

  // Each 500-player chunk below can easily exceed Supabase's default
  // 1000-row-per-select cap (up to 3 years x 2 splits = 6 rows/player, so
  // 500 players could mean up to 3000 matching rows) -- caught 2026-08-24
  // (HANDOFF gotcha 2) via a debug run showing chunk 0-499 and chunk
  // 500-999 both landing on suspiciously exact 1000-row results, silently
  // truncating real data (real total was 2,956 matching batting rows; the
  // unpaginated version only ever saw 2,164 of them, skewing the league
  // split by ~0.1-0.2 points). Fixed by paginating with .range() INSIDE
  // each player-id chunk too, not just across chunks.
  async function sumBySplit(table: string, statCol: string): Promise<{ vsL: number; vsR: number }> {
    let vsL = 0, vsR = 0;
    for (let i = 0; i < mlbPlayerIds.length; i += 500) {
      const chunk = mlbPlayerIds.slice(i, i + 500);
      const rows = await fetchAll<{ split_id: number; [key: string]: number }>((from, to) =>
        supabase.from(table)
          .select(`${statCol},split_id`)
          .eq("refresh_run_id", refreshRunId).in("year", last3Years).in("split_id", [2, 3]).in("player_id", chunk)
          .range(from, to) as never
      );
      rows.forEach((row) => {
        const val = row[statCol] ?? 0;
        if (row.split_id === 2) vsL += val;
        else if (row.split_id === 3) vsR += val;
      });
    }
    return { vsL, vsR };
  }

  console.log(`Computing league handedness splits (MLB, ${last3Years.join("/")})...`);
  const battingSplitTotals = await sumBySplit("player_batting_stats_snapshots", "ab");
  const pitchingSplitTotals = await sumBySplit("player_pitching_stats_snapshots", "ip");
  const battingSplitTotal = battingSplitTotals.vsL + battingSplitTotals.vsR;
  const pitchingSplitTotal = pitchingSplitTotals.vsL + pitchingSplitTotals.vsR;
  // Falls back to an even 50/50 split only if there's truly no data at all
  // (e.g. a brand-new league with no MLB stats history yet) -- should never
  // actually hit in practice once any real seasons exist.
  const splits: HandednessSplits = {
    battingPctVsL: battingSplitTotal > 0 ? battingSplitTotals.vsL / battingSplitTotal : 0.5,
    battingPctVsR: battingSplitTotal > 0 ? battingSplitTotals.vsR / battingSplitTotal : 0.5,
    pitchingPctVsL: pitchingSplitTotal > 0 ? pitchingSplitTotals.vsL / pitchingSplitTotal : 0.5,
    pitchingPctVsR: pitchingSplitTotal > 0 ? pitchingSplitTotals.vsR / pitchingSplitTotal : 0.5,
  };
  console.log(`  Batting: ${(splits.battingPctVsL * 100).toFixed(1)}% vs LHP / ${(splits.battingPctVsR * 100).toFixed(1)}% vs RHP`);
  console.log(`  Pitching: ${(splits.pitchingPctVsL * 100).toFixed(1)}% vs LHB / ${(splits.pitchingPctVsR * 100).toFixed(1)}% vs RHB`);

  console.log("Computing core ratings...");
  const capturedAt = new Date().toISOString();
  const computed = ratings.map((r) => {
    // age lives on `players`, not `player_ratings_snapshots` -- merged in
    // here for the age-gated Contact/Control floor gates (2026-08-27).
    const age = playerById.get(r.player_id)?.age ?? null;
    const c = computeRatings({ ...r, age }, weights, splits, fieldingWeights);
    return { player_id: r.player_id, ...c };
  });

  // --- Role-aware ETA, reworked 2026-08-24 (Rees's spec) -------------
  // Replaces the old flat "Overall vs. a fixed 65 bar" step function with a
  // per-ROLE ladder built straight from real data: the average computed
  // Overall of every player (not just prospects — the whole population,
  // matching "the average MLB level overall for that role") currently AT
  // each level, for each of the 9 role buckets. This is recomputed fresh
  // every refresh (Rees's call) so it tracks the league's actual talent pool
  // over time rather than a value baked in once.
  //
  // Known real-data quirk, confirmed 2026-08-24 (not a bug -- keep this in
  // mind if the numbers ever look "backwards" for a role): for SP/RP/DH/COF,
  // the AAA average often comes in HIGHER than the MLB average for that
  // role, because MLB rosters include a lot of replacement-level bullpen/
  // bench/5th-starter innings dragging the average down, while AAA skews
  // toward near-ready call-up candidates. This is exactly why the model
  // below counts real levels-to-climb rather than trying to place a
  // player's Potential directly onto the curve (a curve-interpolation
  // approach breaks the moment it isn't monotonic).
  const roleLevelSums = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const c of computed) {
    if (!c.role) continue; // rare degenerate case (see rating-engine.ts's sp_rp "" fallback) -- excluded, not a real bucket
    const player = playerById.get(c.player_id);
    const level = effectiveLevel(player?.level, player?.league_id);
    if (level == null || level < 1 || level > INTERNATIONAL_LEVEL) continue;
    // The MLB row specifically must be restricted to the real active roster
    // (Rees 2026-08-24) -- confirmed via direct query that `is_active` is
    // ONLY ever populated at level 1 (every level 2-6 row has is_active=false
    // unconditionally, since "active roster" isn't a concept OOTP tracks for
    // minor-league rosters) -- so this filter only ever excludes level-1
    // rows, never wipes out the minor-league levels. Before this fix, the
    // level-1 cell included ~1,400 non-active level-1 rows alongside the
    // ~890 real active-roster ones (DFA'd players, and the international/
    // complex-signee-mistagged-at-level-1 population documented elsewhere in
    // this doc) -- exactly why SP/RP/DH/COF's "MLB" average was reading
    // artificially low, sometimes even below the AAA average.
    if (level === 1 && player?.is_active !== true) continue;
    if (!roleLevelSums.has(c.role)) roleLevelSums.set(c.role, new Map());
    const byLevel = roleLevelSums.get(c.role)!;
    const cell = byLevel.get(level) ?? { sum: 0, n: 0 };
    cell.sum += c.overall;
    cell.n += 1;
    byLevel.set(level, cell);
  }
  // role -> level -> average Overall. SS at A-/Rookie runs as thin as 3
  // players some refreshes -- noisier than the rest, left as-is rather than
  // smoothed (small niche, not worth the extra complexity yet).
  const roleLevelBar = new Map<string, Map<number, number>>();
  for (const [role, byLevel] of roleLevelSums) {
    const avgByLevel = new Map<number, number>();
    for (const [level, { sum, n }] of byLevel) avgByLevel.set(level, sum / n);
    roleLevelBar.set(role, avgByLevel);
  }
  console.log(`Role/level ETA benchmarks (avg Overall): ` +
    [...roleLevelBar.entries()].map(([role, byLevel]) =>
      `${role}[${[1, 2, 3, 4, 5, 6, 7].map((l) => byLevel.get(l)?.toFixed(1) ?? "—").join("/")}]`
    ).join(", "));

  // Reworked 2026-08-24 (Rees's follow-up spec, same day as the original
  // role-aware version above): the first version measured distance-to-the-
  // majors purely by counting real levels between a player's ROSTER level
  // and MLB -- which meant a player already performing at an MLB-caliber
  // level for their role, but stuck at (say) A+ behind a logjam, still got
  // a multi-year ETA just because of where he's rostered. That's backwards.
  //
  // Fix, generalized per Rees's immediate follow-up (don't special-case just
  // the "already at MLB" direction -- cover every level pair symmetrically):
  // instead of counting roster levels at all, INTERPOLATE the player's
  // CURRENT Overall onto their own role's benchmark ladder (the same table
  // above) to find their SUGGESTED LEVEL -- where their actual current
  // ability already sits on that ladder, entirely independent of what level
  // they're actually rostered at. ETA is then computed purely from THAT
  // suggested level, for every player uniformly -- there is no longer a
  // roster-level shortcut anywhere in this function, not even for someone
  // literally on the active MLB roster today (see the removed `level === 1`
  // check that used to live here). This only works cleanly because the
  // is_active fix (gotcha 18) made every role's ladder actually monotonic
  // (MLB highest, decreasing every level down to International) -- before
  // that fix, SP/RP/DH/COF's ladder had AAA above MLB, which would have
  // made this interpolation nonsensical in spots.
  function estimateSuggestedLevel(role: string, overall: number): number {
    const byLevel = roleLevelBar.get(role);
    const points: [number, number][] = [];
    for (let lvl = 1; lvl <= INTERNATIONAL_LEVEL; lvl++) {
      const v = byLevel?.get(lvl);
      if (v !== undefined) points.push([lvl, v]);
    }
    if (points.length === 0) return INTERNATIONAL_LEVEL; // no benchmark data at all for this role -- treat as maximally far
    if (overall >= points[0][1]) return points[0][0]; // already at or above the best rung on the ladder (usually MLB)
    const worst = points[points.length - 1];
    if (overall <= worst[1]) return worst[0]; // below even the lowest rung -- clamp rather than extrapolate past real data
    for (let i = 0; i < points.length - 1; i++) {
      const [levelA, valA] = points[i];
      const [levelB, valB] = points[i + 1];
      if (overall <= valA && overall >= valB) {
        const frac = (valA - overall) / (valA - valB); // 0 at the higher rung, 1 at the lower one
        return levelA + frac * (levelB - levelA);
      }
    }
    return worst[0]; // defensive fallback, shouldn't be reachable given the bounds checks above
  }

  // Two gates, both must pass or eta is null:
  //   1. Still in the prospect pool (checked at the call site below, via
  //      prospectRankByPlayer.has(...) -- rookie-eligible etc., unchanged).
  //   2. Potential must clear the role's own MLB bar -- a player whose
  //      ceiling was never realistically MLB-caliber for their role gets no
  //      ETA at all, regardless of current ability (Rees's explicit spec).
  // `level` is only used here as a basic sanity gate (does this player have
  // a real level on record at all) -- NOT to compute the actual distance.
  // That comes entirely from estimateSuggestedLevel(role, overall) below,
  // uniformly for every player, including one literally on the active MLB
  // roster today (a below-bar emergency call-up gets a real forward-looking
  // ETA here, not an automatic "now" just because of a roster snapshot).
  function estimateEta(role: string, level: number | null, overall: number, potential: number): number | null {
    const byLevel = roleLevelBar.get(role);
    const mlbBar = byLevel?.get(1);
    if (mlbBar === undefined) return null; // no MLB-level data for this role this refresh -- can't gate or pace against it
    if (potential < mlbBar) return null; // gate 2: ceiling never clears the bar
    if (level === null || level < 1 || level > INTERNATIONAL_LEVEL) return null; // sanity: must have a real level on record

    const suggestedLevel = estimateSuggestedLevel(role, overall);
    const levelsToClimb = Math.max(0, suggestedLevel - 1); // 0 if current Overall already clears the MLB bar
    const margin = potential - mlbBar;
    // Math.ceil, not Math.round (2026-08-31, Rees's spec -- "too many
    // players with [current-year] ETAs... add a little more of a buffer
    // between guys nearing the bubble and actually being MLB ready").
    // Round-to-nearest let any player whose suggested level interpolated to
    // as little as ~1.4 above MLB collapse straight to zero added years
    // ("ready now") -- exactly the "just clears the bar" fringe case
    // paceYearsPerLevel's own comment says needs the FULL runway, not a
    // rounded-away one. Ceiling means any real, nonzero distance left to
    // climb always costs at least one full year; only a player whose
    // CURRENT Overall already fully clears the bar (levelsToClimb computes
    // to exactly 0) still gets "now" here.
    const years = Math.ceil(levelsToClimb * paceYearsPerLevel(margin));
    // Once the real season is over there's no "now" left to be ready for
    // (2026-08-31, Rees's second complaint the same day: with the league in
    // its playoffs, a same-year ETA reads as "should already be up," not as
    // a live possibility). Floors at next year during the offseason/
    // playoffs window -- see isOffseason above -- uniformly for everyone,
    // including a player who's already had real MLB time this season; this
    // function has deliberately never used roster/playing-time shortcuts
    // (see the comment above it), and a same-season "ETA" is a contradiction
    // in terms once that season has actually finished playing out.
    const flooredYears = isOffseason ? Math.max(years, 1) : years;
    return currentYear + flooredYears;
  }

  // --- Player comp, 2026-08-31 (Rees's spec) --------------------------
  // Methodology proposed and approved 2026-08-31: for a prospect, find the
  // established MLB player whose CURRENT raw tool grades most closely match
  // the prospect's POTENTIAL grades (current-only for any tool with no
  // potential equivalent -- speed, stamina, every defensive sub-grade --
  // since there's no other value to use for either side there), restricted
  // to the SAME role bucket (a catcher prospect only ever compares against
  // established catchers), using the SAME per-field weights already in
  // `rating_weights` that drive Overall/Potential everywhere else on this
  // site -- one shared definition of "what matters," not a second one
  // invented just for this. See prospect-comp-methodology.md for the full
  // write-up this was approved from.
  //
  // Deliberately does NOT replicate the rating engine's composite-only
  // adjustments (the SP +5 Stuff bonus, the Contact/Control floor gates,
  // premium-position Batting multipliers) -- those exist to make Overall a
  // fair single scalar, not to describe a player's actual tool grades, and
  // folding them in here would distort a tool-for-tool comparison.
  type CompDim = { weight: number; prospectValue: number; establishedValue: number };
  const add = (dims: CompDim[], weight: number, prospectValue: number | null, establishedValue: number | null) => {
    if (prospectValue === null || establishedValue === null) return;
    dims.push({ weight, prospectValue, establishedValue });
  };
  // No dedicated per-pitch weight exists in rating_weights (the engine only
  // counts *how many* pitches clear a quality bar, via qp/qpp) -- this
  // borrows a fraction of the Stuff weight as a reasonable, tunable default
  // rather than inventing an unrelated number. A pitch dimension is only
  // included when at least one side actually throws it (nonzero raw grade)
  // -- two zeros (neither throws it) isn't a real signal, while a
  // zero-vs-real-grade pairing IS one (only one of them has that pitch).
  const PITCH_GRADE_WEIGHT = weights.stuff / 8;
  function buildCompDims(role: string, ph: "H" | "P", prospect: RatingsInput, established: RatingsInput): CompDim[] {
    const dims: CompDim[] = [];
    if (ph === "H") {
      add(dims, weights.contact, prospect.pot_cntct, established.cntct);
      add(dims, weights.gap, prospect.pot_gap, established.gap);
      add(dims, weights.power, prospect.pot_pow, established.pow);
      add(dims, weights.eye, prospect.pot_eye, established.eye);
      add(dims, weights.avoid_ks, prospect.pot_ks, established.ks);
      add(dims, weights.speed, prospect.speed, established.speed); // current-only, both sides
      // Defensive sub-grades, scoped to whichever ones the rating engine
      // itself treats as relevant for this role (matching cRating/
      // infRating/ofRating's own internal weights in rating-engine.ts, just
      // scaled down here by the overall `fielding` weight since that's how
      // much defense counts relative to the bat everywhere else on the
      // site). 1B/DH intentionally get none -- this data model has no
      // distinct defensive sub-grade for either.
      if (role === "C") {
        add(dims, weights.fielding / 3, prospect.cblk, established.cblk);
        add(dims, weights.fielding / 3, prospect.cfrm, established.cfrm);
        add(dims, weights.fielding / 3, prospect.carm, established.carm);
      } else if (role === "SS" || role === "INF") {
        add(dims, (weights.fielding * 2) / 5, prospect.ifr, established.ifr);
        add(dims, weights.fielding / 5, prospect.ife, established.ife);
        add(dims, weights.fielding / 5, prospect.ifa, established.ifa);
        add(dims, weights.fielding / 5, prospect.tdp, established.tdp);
      } else if (role === "CF" || role === "COF") {
        add(dims, (weights.fielding * 2) / 4, prospect.ofr, established.ofr);
        add(dims, weights.fielding / 4, prospect.ofe, established.ofe);
        add(dims, weights.fielding / 4, prospect.ofa, established.ofa);
      }
    } else {
      add(dims, weights.stuff, prospect.pot_stf, established.stf);
      add(dims, weights.movement, prospect.pot_mov, established.mov);
      add(dims, weights.control, prospect.pot_ctrl, established.ctrl);
      add(dims, weights.pbabip, prospect.pot_pbabip, established.pbabip);
      add(dims, weights.stamina, prospect.stm, established.stm); // current-only, both sides
      const pitchPairs: [number | null, number | null][] = [
        [prospect.pot_fst, established.fst], [prospect.pot_snk, established.snk],
        [prospect.pot_crv, established.crv], [prospect.pot_sld, established.sld],
        [prospect.pot_chg, established.chg], [prospect.pot_cutt, established.cutt],
        [prospect.pot_splt, established.splt], [prospect.pot_frk, established.frk],
        [prospect.pot_circhg, established.circhg], [prospect.pot_knbl, established.knbl],
        [prospect.pot_kncrv, established.kncrv],
      ];
      for (const [prospectVal, establishedVal] of pitchPairs) {
        if ((prospectVal ?? 0) === 0 && (establishedVal ?? 0) === 0) continue;
        add(dims, PITCH_GRADE_WEIGHT, prospectVal, establishedVal);
      }
    }
    return dims;
  }
  function compDistance(dims: CompDim[]): number | null {
    if (dims.length === 0) return null;
    const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
    if (totalWeight <= 0) return null;
    const weightedSqSum = dims.reduce((s, d) => s + d.weight * (d.prospectValue - d.establishedValue) ** 2, 0);
    return Math.sqrt(weightedSqSum / totalWeight);
  }
  // First-pass linear calibration (2026-08-31): `distance` is a weighted
  // RMS difference in 20-80-scale grade points, so 0 is a perfect match.
  // This threshold (the distance treated as "0% similar") is a starting
  // guess, not derived from any real distribution yet -- worth revisiting
  // once real comps have actually been eyeballed against real players.
  const COMP_DISTANCE_FOR_ZERO_SIMILARITY = 30;
  const distanceToSimilarity = (distance: number) =>
    Math.max(0, Math.min(100, 100 - (distance / COMP_DISTANCE_FOR_ZERO_SIMILARITY) * 100));

  // --- Hitter/pitcher rescale, 2026-09-01 (Rees's ask) ----------------
  // The raw formula's Overall/Potential/Prospect Potential are NOT on the
  // same ruler for hitters vs. pitchers -- confirmed with real data before
  // building this: pitchers' raw Overall runs both higher AND ~48% wider
  // (mean 52.08/SD 4.89 vs. hitters' 50.69/3.30, latest run at the time this
  // was written) than hitters'. Sorting/ranking on the raw value directly
  // is what put 72 pitchers in a top-100 combined list and dropped Jeremy
  // Porten (elite bat, ordinary glove) outside the top 100 despite a 7.1 WAR
  // season -- not a weighting bug (that one's already fixed), a genuine
  // "two different rulers read as one" problem.
  //
  // Fix: a per-TYPE z-score rescale, anchored on each type's own real
  // Overall distribution --
  //   CalibratedX = max(20, 50 + 10 * (RawX - typeMean) / typeSD)
  // -- applied identically to that type's Overall, Potential, AND Prospect
  // Potential (never fit separately per metric), so "Potential 65" and
  // "Overall 65" still describe the same real talent level within a type,
  // while a hitter's 65 and a pitcher's 65 now ALSO describe the same real
  // talent level relative to their own population. Deliberately NOT
  // ceiling-clamped at 80 (Rees 2026-09-01: "top players should be
  // differentiated") -- a true outlier is allowed to read above 80.
  //
  // Floor lowered from 20 to 0 (Rees 2026-09-03): a floor of 20 triggers
  // for any hitter below raw Overall ~40.8 (mean - 3 SD, using the narrow
  // reference-population SD) -- since that SD only measures the tight
  // spread among real MLB regulars, applying it all the way down to
  // complex-league teenagers flattened a large swath of the low-level
  // population to an identical "20," making them impossible to tell apart.
  // 0 (mean - 5 SD) moves that threshold down to raw ~34.2, capturing most
  // of the real low-level population's differentiation -- still a floor,
  // not full symmetry with the no-ceiling call above, because a genuinely
  // negative-looking "Overall" reads as broken/an error, which unbounded
  // was fine for the top (a rare, real outlier reading above 80 looks like
  // a good problem to have) but not a good look at the bottom, where a
  // large fraction of every refresh's rows would routinely hit it.
  //
  // typeMean/typeSD are recomputed FRESH every run, from THIS run's own
  // computed values, restricted to the real MLB roster reference population
  // (league_id=200, mlb_service_days>0 -- same reference population every
  // hitter/pitcher-scale comparison this session has used). Deliberately
  // NOT a hand-tuned/versioned rating_weights row: this is a plain
  // descriptive statistic of "today's real population," not a judgment
  // call, so it has to auto-update every time weights or ratings data
  // change, never go stale the way a manually-shipped constant would.
  // Persisted onto refresh_runs (hitter/pitcher_overall_mean/sd) purely so
  // there's a visible history of how the anchor itself drifts over time.
  const REFERENCE_LEAGUE_ID = 200;
  const referencePool = computed.filter((c) => {
    const p = playerById.get(c.player_id);
    return p?.league_id === REFERENCE_LEAGUE_ID && (p?.mlb_service_days ?? 0) > 0;
  });
  function sampleMeanSd(values: number[]): { mean: number; sd: number } {
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
    return { mean, sd: Math.sqrt(variance) };
  }
  // Fallback to the full (not reference-restricted) population of that type
  // if the reference pool comes back too thin to trust (e.g. a sparse early
  // historical run) -- a real anchor, even if computed on a broader pool,
  // beats a wildly noisy or NaN one.
  const MIN_REFERENCE_POOL = 20;
  function typeStats(ph: "H" | "P"): { mean: number; sd: number } {
    let pool = referencePool.filter((c) => c.ph === ph).map((c) => c.overall);
    if (pool.length < MIN_REFERENCE_POOL) pool = computed.filter((c) => c.ph === ph).map((c) => c.overall);
    const { mean, sd } = sampleMeanSd(pool);
    return { mean, sd: sd > 0 ? sd : 1 }; // sd=1 degenerate guard -- never divide by zero
  }
  const hitterStats = typeStats("H");
  const pitcherStats = typeStats("P");
  console.log(`Calibration anchor -- Hitters: mean=${hitterStats.mean.toFixed(3)} sd=${hitterStats.sd.toFixed(3)} (n=${referencePool.filter((c) => c.ph === "H").length}); ` +
    `Pitchers: mean=${pitcherStats.mean.toFixed(3)} sd=${pitcherStats.sd.toFixed(3)} (n=${referencePool.filter((c) => c.ph === "P").length})`);

  function calibrate(raw: number, ph: "H" | "P" | null): number {
    const stats = ph === "P" ? pitcherStats : hitterStats; // null ph (rare degenerate case) treated as hitter, matching sp_rp's own "" fallback elsewhere
    return Math.max(0, 50 + (10 * (raw - stats.mean)) / stats.sd);
  }
  const calibratedByPlayer = new Map(computed.map((c) => [c.player_id, {
    overall: calibrate(c.overall, c.ph),
    potential: calibrate(c.potential, c.ph),
    prospectPotential: calibrate(c.prospect_potential, c.ph),
  }]));

  await supabase.from("refresh_runs").update({
    hitter_overall_mean: hitterStats.mean, hitter_overall_sd: hitterStats.sd,
    pitcher_overall_mean: pitcherStats.mean, pitcher_overall_sd: pitcherStats.sd,
  }).eq("id", refreshRunId);

  // --- ranks ---------------------------------------------------------
  // League-wide, by CALIBRATED Overall / Potential -- this is the actual
  // fix for pitchers dominating combined leaderboards; everything upstream
  // of this point (ETA benchmarks, player comps) stays on the raw formula
  // output, which is mathematically unaffected by a per-type linear rescale
  // since every role bucket is exclusively one type or the other.
  const byOverallDesc = [...computed].sort((a, b) => calibratedByPlayer.get(b.player_id)!.overall - calibratedByPlayer.get(a.player_id)!.overall);
  const rankByPlayer = new Map(byOverallDesc.map((c, i) => [c.player_id, i + 1]));

  const byPotentialDesc = [...computed].sort((a, b) => calibratedByPlayer.get(b.player_id)!.potential - calibratedByPlayer.get(a.player_id)!.potential);
  const potentialRankByPlayer = new Map(byPotentialDesc.map((c, i) => [c.player_id, i + 1]));

  // Prospect pool: still rookie-eligible (RLB's "MLD < 45", mapped to
  // mlb_service_days — see note above) AND either currently in an org, or a
  // genuine free agent with real pro history (last_team_id set). This second
  // condition is the 2026-08-18 fix: without it, "free agent" alone also
  // swept in ~3,700 amateur draft-pool players who've never been rostered —
  // confirmed empirically that free agents with NO last_team_id are almost
  // entirely future-class amateurs (2,697 of 3,735 weren't even in the most
  // recent actual draft class), while free agents WITH a last_team_id are
  // legitimately rare (1,236 total) and never overlap the draft pool at all.
  // Those amateur/future-class players belong on the Draft page, not here.
  // Age <= 25 requirement added 2026-08-27 (Rees's spec): rookie eligibility
  // alone lets in career minor-league journeymen who are technically still
  // under the service-day cap but are clearly not "prospects" in any real
  // sense. Matches PROSPECT_AGE_CUTOFF below, which also drives the
  // rating-engine's developed_age_threshold via rating_weights -- same
  // conceptual line, two different places it has to be enforced.
  const PROSPECT_AGE_CUTOFF = 25;
  const prospectPool = computed.filter((c) => {
    const p = playerById.get(c.player_id);
    if (!p || (p.mlb_service_days ?? 0) >= 45) return false;
    if ((p.age ?? Infinity) > PROSPECT_AGE_CUTOFF) return false;
    return p.organization_id !== null || (p.last_team_id !== null && p.last_team_id !== 0);
  });
  const byProspectPotentialDesc = [...prospectPool].sort((a, b) => calibratedByPlayer.get(b.player_id)!.prospectPotential - calibratedByPlayer.get(a.player_id)!.prospectPotential);
  const prospectRankByPlayer = new Map(byProspectPotentialDesc.map((c, i) => [c.player_id, i + 1]));

  // Org rank: by CALIBRATED Overall, scoped to each org -- an org's depth
  // chart mixes hitters and pitchers just like the leaguewide list does, so
  // this needs the same fix.
  const orgRankByPlayer = new Map<number, number>();
  const byOrg = new Map<number, typeof computed>();
  for (const c of computed) {
    const orgId = playerById.get(c.player_id)?.organization_id;
    if (orgId == null) continue;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(c);
  }
  for (const [, group] of byOrg) {
    const sorted = [...group].sort((a, b) => calibratedByPlayer.get(b.player_id)!.overall - calibratedByPlayer.get(a.player_id)!.overall);
    sorted.forEach((c, i) => orgRankByPlayer.set(c.player_id, i + 1));
  }

  // Prospect org rank: same idea, scoped to the prospect pool only.
  const prospectOrgRankByPlayer = new Map<number, number>();
  const prospectByOrg = new Map<number, typeof prospectPool>();
  for (const c of prospectPool) {
    const orgId = playerById.get(c.player_id)?.organization_id;
    if (orgId == null) continue;
    if (!prospectByOrg.has(orgId)) prospectByOrg.set(orgId, []);
    prospectByOrg.get(orgId)!.push(c);
  }
  for (const [, group] of prospectByOrg) {
    const sorted = [...group].sort((a, b) => calibratedByPlayer.get(b.player_id)!.prospectPotential - calibratedByPlayer.get(a.player_id)!.prospectPotential);
    sorted.forEach((c, i) => prospectOrgRankByPlayer.set(c.player_id, i + 1));
  }

  // Prospect role rank (2026-08-27, Rees's spec): leaguewide rank within
  // role bucket (SP/RP/C/1B/INF/SS/COF/CF/DH), by prospect_potential --
  // same idea as prospect_org_rank above, just grouped by role instead of
  // org. Distinct from the pre-existing role_org_rank (role rank scoped
  // to ORG, by Overall, not prospect-pool-scoped) and pos_rank (leaguewide
  // by Overall, not Potential, not prospect-pool-scoped) -- neither of
  // those already covered this.
  const prospectRoleRankByPlayer = new Map<number, number>();
  const prospectByRole = new Map<string | null, typeof prospectPool>();
  for (const c of prospectPool) {
    if (!prospectByRole.has(c.role)) prospectByRole.set(c.role, []);
    prospectByRole.get(c.role)!.push(c);
  }
  for (const [, group] of prospectByRole) {
    // Scoped to a single role, which is always exclusively one type (SP/RP
    // are pitcher-only, the other 7 roles are hitter-only) -- calibration
    // is a linear transform, so this sorts identically whether raw or
    // calibrated, but calibrated is used anyway for one consistent rule:
    // every rank field on this table comes from calibrated values.
    const sorted = [...group].sort((a, b) => calibratedByPlayer.get(b.player_id)!.prospectPotential - calibratedByPlayer.get(a.player_id)!.prospectPotential);
    sorted.forEach((c, i) => prospectRoleRankByPlayer.set(c.player_id, i + 1));
  }

  // Established-player pool, per role bucket -- "established" means real
  // career MLB workload, separate thresholds for hitters vs. the two
  // pitcher roles since IP accrues at wildly different rates for a starter
  // vs. a reliever (a bar that works for one would exclude nearly every
  // real career reliever). Lowered 2026-08-31 (Rees's follow-up, same day)
  // from 1500/300/150 to widen the pool, especially for the thinner role
  // buckets (C/CF/DH/1B were only 14-20 candidates at the original bars).
  // Confirmed against real data at the ORIGINAL 1500 AB bar: it cleared
  // ~1260 hitters, but only ~340 of them still had a CURRENT ratings row at
  // all (the rest are long-retired players the game itself stopped
  // tracking ratings for -- the same gap already documented for
  // retired-player exports elsewhere in this project). That gap is
  // automatic here regardless of where these thresholds sit: `computed`
  // (built from `ratings`) only ever contains players who HAVE a current
  // ratings row.
  const COMP_HITTER_MIN_AB = 1000;
  const COMP_SP_MIN_IP = 200;
  const COMP_RP_MIN_IP = 100;
  const establishedByRole = new Map<string, { player_id: number; ratings: RatingsInput; overall: number }[]>();
  for (const c of computed) {
    if (!c.role) continue;
    const r = ratingsByPlayer.get(c.player_id);
    if (!r) continue;
    const isEstablished = c.ph === "H"
      ? (careerAbByPlayer.get(c.player_id) ?? 0) >= COMP_HITTER_MIN_AB
      : (c.role === "SP" ? (careerIpByPlayer.get(c.player_id) ?? 0) >= COMP_SP_MIN_IP : (careerIpByPlayer.get(c.player_id) ?? 0) >= COMP_RP_MIN_IP);
    if (!isEstablished) continue;
    if (!establishedByRole.has(c.role)) establishedByRole.set(c.role, []);
    establishedByRole.get(c.role)!.push({ player_id: c.player_id, ratings: r, overall: c.overall });
  }
  console.log("Established comp-pool sizes by role: " +
    [...establishedByRole.entries()].map(([role, list]) => `${role}=${list.length}`).join(", "));

  // Value-gap dimension (2026-08-31, Rees's fix): comparing raw tool grades
  // alone found real cases where the winning "comp" was someone whose
  // established, fully-realized CURRENT Overall sat nowhere near the
  // prospect's own POTENTIAL -- confirmed concretely on R.J. Blum (Potential
  // 84.35), whose comp before this fix was Marty Kilby (Overall 74.35, a
  // 10-point gap) despite Bob Reyes (Overall 84.08, a 0.27-point gap) being
  // right there in the same SP pool. Root cause: Kilby happens to throw the
  // exact same unusual 4-pitch mix as Blum (fastball/sinker/change/splitter
  // -- most pitchers throw curveball/slider instead), which let raw pitch-
  // mix agreement outweigh the fact that his aggregate ability is a full
  // ceiling-tier below Blum's. Since the whole point of a comp is "who does
  // this prospect's FUTURE look like," value alignment has to matter, but
  // it shouldn't be the ONLY thing that matters. Implemented as an extra
  // weighted dimension (not a hard pre-filter, which would have risked zero
  // candidates left in the thinner role buckets for an unusually high- or
  // low-Potential prospect) comparing the prospect's own computed Potential
  // against each candidate's computed Overall -- its weight is set to
  // `COMP_VALUE_GAP_DOMINANCE` times the sum of every other dimension's
  // weight for that specific comparison.
  //
  // Lowered from `10` to `1` the SAME DAY (2026-08-31), Rees's immediate
  // follow-up: at 10, value alignment so thoroughly swamped tool-shape that
  // multiple different prospects in a thin role bucket (all 3 top-10 CF
  // prospects) were landing on the exact same comp, just because that one
  // established player's Overall happened to sit in the "sweet spot" of a
  // sparse Overall distribution -- tool-shape had essentially no say left
  // to differentiate genuinely different skill profiles that all happened
  // to project to a similar ceiling. `1` means the value-gap term now
  // carries exactly as much weight as the ENTIRE rest of the tool-grade
  // vector combined (50/50), not ten times it -- still enough to keep a
  // real Blum-vs-Kilby-style value howler from winning outright, but tool
  // profile is a genuine co-equal factor again, not just a tie-breaker.
  const COMP_VALUE_GAP_DOMINANCE = 1;

  // For every prospect, the nearest established player in the SAME role
  // bucket by weighted distance across both raw tool grades (see
  // buildCompDims/compDistance above) AND the value-gap dimension just
  // above. A prospect who's already cleared the established bar himself is
  // excluded as his own comp candidate (rare, but possible for an older
  // "prospect" with real MLB burn already -- see the age<=25/mlb_service_
  // days<45 prospect-pool gate above, which still lets some real workload
  // through). No comp at all (left null) only happens if the role bucket's
  // established pool is empty, which real data shows doesn't currently
  // happen (every one of the 9 role buckets has real candidates).
  console.log("Computing player comps for the prospect pool...");
  const compByPlayer = new Map<number, { comp_player_id: number; comp_similarity: number }>();
  for (const c of prospectPool) {
    if (!c.role) continue;
    const prospectRatings = ratingsByPlayer.get(c.player_id);
    if (!prospectRatings) continue;
    const candidates = establishedByRole.get(c.role) ?? [];
    let best: { player_id: number; distance: number } | null = null;
    for (const candidate of candidates) {
      if (candidate.player_id === c.player_id) continue;
      const toolDims = buildCompDims(c.role, c.ph, prospectRatings, candidate.ratings);
      const otherWeight = toolDims.reduce((s, d) => s + d.weight, 0);
      const dims = otherWeight > 0
        ? [...toolDims, { weight: otherWeight * COMP_VALUE_GAP_DOMINANCE, prospectValue: c.potential, establishedValue: candidate.overall }]
        : toolDims;
      const distance = compDistance(dims);
      if (distance !== null && (best === null || distance < best.distance)) best = { player_id: candidate.player_id, distance };
    }
    if (best !== null) {
      compByPlayer.set(c.player_id, { comp_player_id: best.player_id, comp_similarity: Math.round(distanceToSimilarity(best.distance) * 10) / 10 });
    }
  }
  console.log(`  ${compByPlayer.size} of ${prospectPool.length} prospects got a comp`);

  const rows = computed.map((c) => ({
    refresh_run_id: refreshRunId,
    player_id: c.player_id,
    weights_id: c.weights_id,
    batting: c.batting, batting_p: c.batting_p, fielding: c.fielding, baserunning: c.baserunning,
    pitching: c.pitching, pitching_p: c.pitching_p, qp: c.qp, qpp: c.qpp,
    c_rating: c.c_rating, inf_rating: c.inf_rating, of_rating: c.of_rating,
    // overall/potential/prospect_potential are the CALIBRATED, hitter/pitcher-
    // comparable values as of 2026-09-01 -- every existing display consumer
    // (Top Players, org depth charts, team rankings, role/level benchmarks,
    // the market-rate curve, player detail pages) reads these column names
    // already, so they all get the fix with no changes of their own. The
    // formula's untransformed output is preserved in the _raw columns for
    // the few consumers that specifically need it (rating-validation-query.ts).
    overall: calibratedByPlayer.get(c.player_id)!.overall,
    potential: calibratedByPlayer.get(c.player_id)!.potential,
    prospect_potential: calibratedByPlayer.get(c.player_id)!.prospectPotential,
    overall_raw: c.overall, potential_raw: c.potential, prospect_potential_raw: c.prospect_potential,
    ph: c.ph, role: c.role, sp_rp: c.sp_rp, tbl_pos: c.tbl_pos, platoon: c.platoon,
    rank: rankByPlayer.get(c.player_id) ?? null,
    potential_rank: potentialRankByPlayer.get(c.player_id) ?? null,
    prospect_rank: prospectRankByPlayer.get(c.player_id) ?? null,
    org_rank: orgRankByPlayer.get(c.player_id) ?? null,
    prospect_org_rank: prospectOrgRankByPlayer.get(c.player_id) ?? null,
    prospect_role_rank: prospectRoleRankByPlayer.get(c.player_id) ?? null,
    eta: prospectRankByPlayer.has(c.player_id) ? estimateEta(c.role, effectiveLevel(playerById.get(c.player_id)?.level, playerById.get(c.player_id)?.league_id), c.overall, c.potential) : null,
    comp_player_id: compByPlayer.get(c.player_id)?.comp_player_id ?? null,
    comp_similarity: compByPlayer.get(c.player_id)?.comp_similarity ?? null,
    captured_at: capturedAt,
  }));

  // Shared batched-upsert-with-retry helper (2026-08-28, factored out of the
  // player_computed loop below so player_projected_splits can reuse the same
  // retry/backoff behavior instead of a second copy-pasted loop).
  async function writeBatched(table: string, allRows: Record<string, unknown>[]) {
    console.log(`Writing ${allRows.length} rows to ${table}...`);
    const MAX_ATTEMPTS = 3;
    for (let i = 0; i < allRows.length; i += 500) {
      const batch = allRows.slice(i, i + 500);
      let lastErr: unknown;
      let ok = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
        // upsert, not insert (2026-08-27): a weight retune re-runs this
        // against a refresh_run_id that's already been computed once, which
        // a plain insert can never do -- it collides on the unique
        // (refresh_run_id, player_id) constraint every time. onConflict
        // overwrites the existing row in place, which is exactly what a
        // recompute should do.
        const { error } = await supabase.from(table).upsert(batch as never[], { onConflict: "refresh_run_id,player_id" });
        if (!error) { ok = true; break; }
        lastErr = error;
        console.warn(`${table} upsert (rows ${i}-${i + batch.length}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
      if (!ok) throw new Error(`${table} upsert failed at row ${i}: ${lastErr}`);
    }
  }

  await writeBatched("player_computed", rows);

  // player_projected_splits (2026-08-28, Rees's spec): the extrapolated
  // Potential L/R split profile, one row per player per refresh, written
  // alongside player_computed as its own sibling table (gotcha 1 pattern --
  // not folded into player_computed itself, kept separately inspectable).
  const projectedSplitRows = computed.map((c) => ({
    refresh_run_id: refreshRunId,
    player_id: c.player_id,
    pot_cntct_l: c.projectedSplits.cntct.l, pot_cntct_r: c.projectedSplits.cntct.r,
    pot_pow_l: c.projectedSplits.pow.l, pot_pow_r: c.projectedSplits.pow.r,
    pot_eye_l: c.projectedSplits.eye.l, pot_eye_r: c.projectedSplits.eye.r,
    pot_gap_l: c.projectedSplits.gap.l, pot_gap_r: c.projectedSplits.gap.r,
    pot_ks_l: c.projectedSplits.ks.l, pot_ks_r: c.projectedSplits.ks.r,
    pot_stf_l: c.projectedSplits.stf.l, pot_stf_r: c.projectedSplits.stf.r,
    pot_mov_l: c.projectedSplits.mov.l, pot_mov_r: c.projectedSplits.mov.r,
    pot_ctrl_l: c.projectedSplits.ctrl.l, pot_ctrl_r: c.projectedSplits.ctrl.r,
    pot_hra_l: c.projectedSplits.hra.l, pot_hra_r: c.projectedSplits.hra.r,
    pot_pbabip_l: c.projectedSplits.pbabip.l, pot_pbabip_r: c.projectedSplits.pbabip.r,
    computed_at: capturedAt,
  }));
  await writeBatched("player_projected_splits", projectedSplitRows);

  console.log(`Done with refresh_run_id ${refreshRunId}. Top 5 by calibrated Overall:`);
  byOverallDesc.slice(0, 5).forEach((c, i) => console.log(`  ${i + 1}. player ${c.player_id} (${c.ph}) — Overall ${calibratedByPlayer.get(c.player_id)!.overall.toFixed(2)} (raw ${c.overall.toFixed(2)})`));
}

async function main() {
  const supabase = makeSupabaseClient();
  const shared = await loadSharedContext(supabase);

  // --all (2026-09-02, Rees's ask: "run a full refresh of all of the data
  // ... including old runs to update the historical valuations ... so we
  // can accurately see the impacts" of the new weighting system across
  // history, not just the current refresh). Default behavior (no flag) is
  // unchanged: only the latest succeeded+ratings run.
  const backfillAll = process.argv.includes("--all");

  let refreshRunIds: number[];
  if (backfillAll) {
    console.log("--all: finding every succeeded refresh run with ratings...");
    const { data: runRows, error } = await supabase
      .from("refresh_runs").select("id").eq("status", "succeeded").eq("ratings_included", true).order("id", { ascending: true });
    if (error || !runRows || runRows.length === 0) throw new Error(`No succeeded refresh runs with ratings found: ${error?.message}`);
    refreshRunIds = (runRows as { id: number }[]).map((r) => r.id);
    console.log(`  ${refreshRunIds.length} runs to recompute: ${refreshRunIds.join(", ")}`);
  } else {
    console.log("Finding latest succeeded refresh run with ratings...");
    const { data: runRow, error } = await supabase
      .from("refresh_runs").select("id").eq("status", "succeeded").eq("ratings_included", true)
      .order("id", { ascending: false }).limit(1).single();
    if (error || !runRow) throw new Error(`No succeeded refresh run with ratings found: ${error?.message}`);
    refreshRunIds = [(runRow as { id: number }).id];
  }

  let failures = 0;
  for (const refreshRunId of refreshRunIds) {
    console.log(`\n=== refresh_run_id ${refreshRunId} (${refreshRunIds.indexOf(refreshRunId) + 1}/${refreshRunIds.length}) ===`);
    try {
      await computeRatingsForRun(supabase, refreshRunId, shared);
    } catch (err) {
      // One bad historical run shouldn't kill an entire multi-run backfill --
      // logged and counted, not silently swallowed (see the nonzero exit
      // code below).
      console.error(`  refresh_run_id ${refreshRunId} failed: ${err}`);
      failures++;
    }
  }
  if (backfillAll) {
    console.log(`\nBackfill complete: ${refreshRunIds.length - failures}/${refreshRunIds.length} runs succeeded.`);
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("compute-ratings failed:", err);
  process.exit(1);
});
