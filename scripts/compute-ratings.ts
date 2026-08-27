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

async function main() {
  const supabase = makeSupabaseClient();

  console.log("Loading active weight set...");
  const { data: weightRow, error: weightErr } = await supabase.from("rating_weights").select("*").eq("is_active", true).single();
  if (weightErr || !weightRow) throw new Error(`No active weight set found: ${weightErr?.message}`);
  const weights: WeightSet = weightRow as WeightSet;
  console.log(`Using weight set #${weights.id}: "${(weightRow as { label: string }).label}"`);

  console.log("Finding latest succeeded refresh run with ratings...");
  const { data: runRow, error: runErr } = await supabase
    .from("refresh_runs")
    .select("id")
    .eq("status", "succeeded")
    .eq("ratings_included", true)
    .order("id", { ascending: false })
    .limit(1)
    .single();
  if (runErr || !runRow) throw new Error(`No succeeded refresh run with ratings found: ${runErr?.message}`);
  const refreshRunId = (runRow as { id: number }).id;
  console.log(`Computing against refresh_run_id ${refreshRunId}`);

  console.log("Loading ratings snapshot...");
  const ratings = await fetchAll<RatingsInput & { player_id: number }>((from, to) =>
    supabase.from("player_ratings_snapshots").select("*").eq("refresh_run_id", refreshRunId).range(from, to) as never
  );
  console.log(`  ${ratings.length} ratings rows`);

  console.log("Loading players (for org/rookie-eligibility context)...");
  // .order("id") required -- see HANDOFF.md gotcha 13. Without it, this
  // ~46-page fetch (45,757 rows) has no pagination stability guarantee,
  // which was silently skewing the handedness-split percentages below by
  // ~0.1pt (caught 2026-08-24 while verifying the Ks blend fix -- a
  // hand-computed split via direct SQL didn't match player_computed's
  // actual batting values until this was added).
  const players = await fetchAll<{ id: number; organization_id: number | null; mlb_service_days: number | null; last_team_id: number | null; level: number | null; is_active: boolean | null; league_id: number | null }>((from, to) =>
    supabase.from("players").select("id, organization_id, mlb_service_days, last_team_id, level, is_active, league_id").order("id").range(from, to) as never
  );
  const playerById = new Map(players.map((p) => [p.id, p]));
  console.log(`  ${players.length} players`);

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
    const c = computeRatings(r, weights, splits);
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
    const years = Math.round(levelsToClimb * paceYearsPerLevel(margin));
    return currentYear + years;
  }

  // --- ranks ---------------------------------------------------------
  // League-wide, by our computed Overall / Potential.
  const byOverallDesc = [...computed].sort((a, b) => b.overall - a.overall);
  const rankByPlayer = new Map(byOverallDesc.map((c, i) => [c.player_id, i + 1]));

  const byPotentialDesc = [...computed].sort((a, b) => b.potential - a.potential);
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
  const prospectPool = computed.filter((c) => {
    const p = playerById.get(c.player_id);
    if (!p || (p.mlb_service_days ?? 0) >= 45) return false;
    return p.organization_id !== null || (p.last_team_id !== null && p.last_team_id !== 0);
  });
  const byProspectPotentialDesc = [...prospectPool].sort((a, b) => b.prospect_potential - a.prospect_potential);
  const prospectRankByPlayer = new Map(byProspectPotentialDesc.map((c, i) => [c.player_id, i + 1]));

  // Org rank: by Overall, scoped to each org.
  const orgRankByPlayer = new Map<number, number>();
  const byOrg = new Map<number, typeof computed>();
  for (const c of computed) {
    const orgId = playerById.get(c.player_id)?.organization_id;
    if (orgId == null) continue;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(c);
  }
  for (const [, group] of byOrg) {
    const sorted = [...group].sort((a, b) => b.overall - a.overall);
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
    const sorted = [...group].sort((a, b) => b.prospect_potential - a.prospect_potential);
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
    const sorted = [...group].sort((a, b) => b.prospect_potential - a.prospect_potential);
    sorted.forEach((c, i) => prospectRoleRankByPlayer.set(c.player_id, i + 1));
  }

  const rows = computed.map((c) => ({
    refresh_run_id: refreshRunId,
    player_id: c.player_id,
    weights_id: c.weights_id,
    batting: c.batting, batting_p: c.batting_p, fielding: c.fielding,
    pitching: c.pitching, pitching_p: c.pitching_p, qp: c.qp, qpp: c.qpp,
    c_rating: c.c_rating, inf_rating: c.inf_rating, of_rating: c.of_rating,
    overall: c.overall, potential: c.potential, prospect_potential: c.prospect_potential,
    ph: c.ph, role: c.role, sp_rp: c.sp_rp, tbl_pos: c.tbl_pos, platoon: c.platoon,
    rank: rankByPlayer.get(c.player_id) ?? null,
    potential_rank: potentialRankByPlayer.get(c.player_id) ?? null,
    prospect_rank: prospectRankByPlayer.get(c.player_id) ?? null,
    org_rank: orgRankByPlayer.get(c.player_id) ?? null,
    prospect_org_rank: prospectOrgRankByPlayer.get(c.player_id) ?? null,
    prospect_role_rank: prospectRoleRankByPlayer.get(c.player_id) ?? null,
    eta: prospectRankByPlayer.has(c.player_id) ? estimateEta(c.role, effectiveLevel(playerById.get(c.player_id)?.level, playerById.get(c.player_id)?.league_id), c.overall, c.potential) : null,
    captured_at: capturedAt,
  }));

  console.log(`Writing ${rows.length} rows to player_computed...`);
  const MAX_ATTEMPTS = 3;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    let lastErr: unknown;
    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      const { error } = await supabase.from("player_computed").insert(batch as never[]);
      if (!error) { ok = true; break; }
      lastErr = error;
      console.warn(`player_computed insert (rows ${i}-${i + batch.length}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!ok) throw new Error(`player_computed insert failed at row ${i}: ${lastErr}`);
  }

  console.log(`Done. Top 5 by computed Overall:`);
  byOverallDesc.slice(0, 5).forEach((c, i) => console.log(`  ${i + 1}. player ${c.player_id} — Overall ${c.overall.toFixed(2)}`));
}

main().catch((err) => {
  console.error("compute-ratings failed:", err);
  process.exit(1);
});
