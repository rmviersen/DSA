import { fetchComputedPlayers, fetchByIdsChunked, latestRefreshRunId, getLevelAgeBenchmarks, ageVsLevelAvg, getRoleLevelBenchmarks } from "./queries";
import type { PlayerRow } from "./queries";
import { makeSupabaseClient } from "./supabase-client";
import { effectiveLevel, levelLabel } from "./display-helpers";
import { getLatestMarketRateCurves, getLatestRoleMultipliers } from "./market-rate-query";
import { playerTypeForRole } from "./contract-classification";
import { fetchAll, ROLE_HEALTH_ROWS, topNAvg } from "./org-minors-query";

// Data layer for /free-agency (2026-09-04, Rees's ask). Kept in its own
// file, same reasoning as every other page-specific query module this
// session (org-minors-query.ts, market-rate-query.ts, etc.) -- a
// self-contained addition, no reason to risk touching queries.ts beyond the
// one export it needed.
//
// makeSupabaseClient() is called inside the function, not at module top
// level -- this file is only ever imported by a Server Component page
// today, but keeping the same client-bundle-safe pattern as every other
// query module built this session costs nothing and forecloses the bug
// class documented in HANDOFF.md (a future client-component import of a
// real value from a module with a top-level client construction crashes
// the browser).

export interface FreeAgentsResult {
  rows: PlayerRow[];
  totalRealFreeAgents: number;
  // How many of totalRealFreeAgents actually have a player_computed row this
  // refresh (2026-09-06, added alongside the DISPLAY_LIMIT cap below) --
  // kept separate from rows.length so the page can distinguish "cut by the
  // display cap" from "genuinely has no ratings yet this refresh" instead of
  // conflating the two into one misleading gap.
  totalWithRatings: number;
}

// "Real, actionable free agent" (established 2026-08-31 -- see HANDOFF.md's
// transaction-analysis section): the raw `free_agent` flag alone is noisy
// (tens of thousands of amateurs who've never been rostered) -- scoping to
// previously-rostered, non-retired players is what makes this a real,
// approachable list rather than a database curiosity.
//
// Real bug found and fixed 2026-09-06 (Rees: SP Jong-su Im, a real KBO free
// agent posting into the league this offseason, was missing from the top of
// the page). Root cause: `last_team_id != 0` was being used as a proxy for
// "not a domestic amateur draft-pool player who's never been rostered" --
// true for the vast majority of that noise (2,550 of them), but Im (and 373
// others like him -- real professionals, mostly international signings,
// confirmed via age/name/nation spread, e.g. Korean/Japanese/Taiwanese
// players in their late 20s-30s with real MLB-caliber ratings) legitimately
// has `last_team_id=0` too, simply because he's never had a team_id in THIS
// league before -- last_team_id alone can't tell "never rostered because
// amateur" apart from "never rostered because new international pro."
// `players.draft_eligible` is OOTP's own field for exactly this distinction
// (true for every domestic amateur sampled, ages 15-23, avg 17.7; false for
// every real professional free agent, ages 15-37, avg 22.0 -- the young end
// of the false group is real international amateur free agent SIGNEES,
// analogous to real MLB's international free agency, not draft-pool
// prospects). Added as an OR, not a replacement, so nothing already correctly
// included via last_team_id can be affected -- confirmed zero overlap
// (nobody currently included via last_team_id has draft_eligible=true).
// Verified: this adds exactly 374 real candidates (320 with usable ratings
// this refresh, 54 between-refresh like the existing "missing ratings" slice
// below), Im among them.
export async function getFreeAgents(): Promise<FreeAgentsResult> {
  const supabase = makeSupabaseClient();
  const PAGE_SIZE = 1000;
  const players: { id: number; last_team_id: number }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("players").select("id,last_team_id")
      .eq("free_agent", true).eq("retired", false)
      .or("and(last_team_id.not.is.null,last_team_id.neq.0),draft_eligible.eq.false")
      .order("id").range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    players.push(...(data as { id: number; last_team_id: number }[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  if (players.length === 0) return { rows: [], totalRealFreeAgents: 0, totalWithRatings: 0 };

  const lastTeamIdByPlayer = new Map(players.map((p) => [p.id, p.last_team_id]));
  const refreshRunId = await latestRefreshRunId();

  // fetchComputedPlayers silently drops any id with no player_computed row
  // (a small, real slice right now -- players between team assignments this
  // exact refresh, confirmed ~12% as of 2026-09-04, mostly very young
  // players with no meaningful position/level context anyway). Counted here
  // (id-only, chunked) SEPARATELY from the display cap below so the two
  // gaps can't get conflated -- "capped for display" and "genuinely has no
  // ratings yet" are different facts the page needs to state separately.
  const ids = players.map((p) => p.id);
  const idsWithRatings = await fetchByIdsChunked<{ player_id: number }>(ids, (chunk) =>
    supabase.from("player_computed").select("player_id").eq("refresh_run_id", refreshRunId).in("player_id", chunk) as never
  );
  const totalWithRatings = idsWithRatings.length;

  // Row cap (2026-09-06, Rees's ask -- "we don't need to display that many,
  // it is causing the page load to take a while"). Was fetching+rendering
  // every real free agent (2,000+ as of the international-FA fix above);
  // capped to the top DISPLAY_LIMIT by Overall instead -- fetchComputedPlayers
  // already sorts by Overall desc and trims to `limit` internally, so this
  // is a straight cut, not a re-sort. 300 is a starting number, easy to
  // adjust -- deep enough to still surface real org-depth-caliber talent (not
  // just MLB-ready studs), not so deep that the page is back to rendering
  // thousands of rows.
  const DISPLAY_LIMIT = 300;
  const rawRows = await fetchComputedPlayers({ playerIds: ids, limit: DISPLAY_LIMIT });
  // Every downstream per-player lookup (WAR/AB/IP, demand, Sign) only needs
  // to cover players actually being shown -- chunking the full candidate
  // pool (thousands of ids) for those would undo the point of the cap above.
  const displayIds = rawRows.map((r) => r.player_id);

  // fetchComputedPlayers resolves team_name/nickname/abbr off players.team_id
  // -- always null for a free agent (no current team). Remap to LAST team
  // instead, which is the actually useful "who did they just leave" context
  // for this page -- players.team_id is correctly left alone for every
  // other consumer of that function (getTopPlayers/getTopDraftees etc.),
  // which genuinely want CURRENT team.
  // 2026-09-06: also excludes 0 here, not just null -- new international-
  // free-agent candidates (added above via draft_eligible) commonly carry
  // last_team_id=0 (never rostered in this league), same "no real team"
  // meaning as null, and 0 was never a real team id to look up anyway.
  const lastTeamIds = [...new Set(rawRows.map((r) => lastTeamIdByPlayer.get(r.player_id)).filter((id): id is number => id != null && id !== 0))];
  const { data: teamRows, error: teamErr } = await supabase.from("teams").select("id,name,nickname").in("id", lastTeamIds);
  if (teamErr) throw teamErr;
  const teamById = new Map((teamRows as { id: number; name: string; nickname: string }[]).map((t) => [t.id, t]));
  const { data: abbrRows, error: abbrErr } = await supabase
    .from("team_batting_stats_snapshots").select("team_id,abbr,year")
    .in("team_id", lastTeamIds).order("year", { ascending: false });
  if (abbrErr) throw abbrErr;
  const abbrByTeamId = new Map<number, string>();
  (abbrRows as { team_id: number; abbr: string }[]).forEach((r) => { if (!abbrByTeamId.has(r.team_id)) abbrByTeamId.set(r.team_id, r.abbr); });

  // fetchComputedPlayers' WAR/AB/IP lookup matches stints against
  // players.level -- meaningless for a free agent, whose level resets to 0
  // the moment they leave a roster (confirmed 2026-09-04: all 1,804 real
  // free agents show level=0). That's why every row comes back with WAR/AB/
  // IP blank rather than their real last season -- fixed here by finding
  // each free agent's own most recent real stint (any level 1-6, whichever
  // is numerically lowest/highest quality if they played at more than one)
  // instead of requiring a level match that can never succeed for them.
  // Scoped to the single latest refresh_run_id -- these tables are
  // cumulative-as-of-refresh-date time series (a player can have many rows
  // for the same season, one per historical refresh), so pooling across
  // every run would inflate WAR by roughly how many times a player's been
  // snapshotted (the exact bug already caught and fixed in rating-
  // validation-query.ts and compute-draft-pick-value.ts -- same rule
  // applies here).
  const { data: statYearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year")
    .eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const statSeasonYear = (statYearRow as { year: number } | null)?.year ?? null;

  // Which level's stint counts as "the" stat line (2026-09-04, Rees's ask,
  // refining the original "always highest level" rule): prefer the highest
  // level played, but only if it clears a real sample-size floor -- 30 PA
  // for hitters, 10 IP for pitchers. A 3-PA September call-up shouldn't
  // outrank a real, meaningful AAA season just for being "MLB". If NO level
  // clears its floor (a hurt/limited-usage player), fall back to whichever
  // level has the MOST playing time -- the most representative sample on
  // file, not an arbitrary tiebreak.
  const MIN_PA = 30;
  const MIN_IP = 10;
  interface LevelAgg { level_id: number; league_id: number | null; playingTime: number; displayStat: number; war: number | null; hasWar: boolean }
  function pickBestLevel(byLevel: Map<number, LevelAgg>, minPlayingTime: number): LevelAgg | null {
    const levels = [...byLevel.values()].sort((a, b) => a.level_id - b.level_id); // ascending id = descending real level
    if (levels.length === 0) return null;
    return levels.find((l) => l.playingTime >= minPlayingTime)
      ?? levels.reduce((best, cur) => (cur.playingTime > best.playingTime ? cur : best));
  }

  // levelNum (2026-09-06, added for the Sign feature) -- the same chosen
  // level as statLevel, kept as the raw canonical NUMBER too (statLevel is
  // already a display label, no good for map lookups against the level-age/
  // role-level benchmarks below).
  const warAbIpById = new Map<number, { war: number | null; ab: number | null; ip: number | null; statLevel: string | null; levelNum: number | null }>();
  if (statSeasonYear !== null) {
    const batData = await fetchByIdsChunked<{ player_id: number; level_id: number; league_id: number | null; pa: number; ab: number; war: number | null }>(displayIds, (chunk) =>
      supabase.from("player_batting_stats_snapshots").select("player_id,level_id,league_id,pa,ab,war")
        .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", chunk) as never
    );
    const pitData = await fetchByIdsChunked<{ player_id: number; level_id: number; league_id: number | null; ip: number; war: number | null }>(displayIds, (chunk) =>
      supabase.from("player_pitching_stats_snapshots").select("player_id,level_id,league_id,ip,war")
        .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", chunk) as never
    );

    // Group each player's stints by level FIRST (a same-level in-season
    // trade produces two stints at the identical level, which must be
    // summed together, not compared against each other as if they were
    // different levels).
    const batLevelsByPlayer = new Map<number, Map<number, LevelAgg>>();
    batData.forEach((s) => {
      const byLevel = batLevelsByPlayer.get(s.player_id) ?? new Map<number, LevelAgg>();
      const agg = byLevel.get(s.level_id) ?? { level_id: s.level_id, league_id: s.league_id, playingTime: 0, displayStat: 0, war: 0, hasWar: false };
      agg.playingTime += s.pa ?? 0;
      agg.displayStat += s.ab ?? 0;
      if (s.war !== null) { agg.war = (agg.war ?? 0) + s.war; agg.hasWar = true; }
      byLevel.set(s.level_id, agg);
      batLevelsByPlayer.set(s.player_id, byLevel);
    });
    const pitLevelsByPlayer = new Map<number, Map<number, LevelAgg>>();
    pitData.forEach((s) => {
      const byLevel = pitLevelsByPlayer.get(s.player_id) ?? new Map<number, LevelAgg>();
      const agg = byLevel.get(s.level_id) ?? { level_id: s.level_id, league_id: s.league_id, playingTime: 0, displayStat: 0, war: 0, hasWar: false };
      agg.playingTime += s.ip ?? 0;
      agg.displayStat += s.ip ?? 0;
      if (s.war !== null) { agg.war = (agg.war ?? 0) + s.war; agg.hasWar = true; }
      byLevel.set(s.level_id, agg);
      pitLevelsByPlayer.set(s.player_id, byLevel);
    });

    // statLevel labels EXACTLY the chosen level, via the shared
    // effectiveLevel()/levelLabel() helpers -- resolves the level=4 A/A+
    // ambiguity using that level's own league_id, not a guess (confirmed
    // real: player_batting_stats_snapshots.level_id=4 mixes league_id
    // 203/204 exactly like players.level did, same fix applies here).
    for (const r of rawRows) {
      if (r.ph === "H") {
        const byLevel = batLevelsByPlayer.get(r.player_id);
        if (!byLevel) continue;
        const chosen = pickBestLevel(byLevel, MIN_PA);
        if (!chosen) continue;
        warAbIpById.set(r.player_id, {
          war: chosen.hasWar ? chosen.war : null,
          ab: chosen.displayStat,
          ip: null,
          statLevel: levelLabel(effectiveLevel(chosen.level_id, chosen.league_id)),
          levelNum: effectiveLevel(chosen.level_id, chosen.league_id),
        });
      } else if (r.ph === "P") {
        const byLevel = pitLevelsByPlayer.get(r.player_id);
        if (!byLevel) continue;
        const chosen = pickBestLevel(byLevel, MIN_IP);
        if (!chosen) continue;
        warAbIpById.set(r.player_id, {
          war: chosen.hasWar ? chosen.war : null,
          ab: null,
          ip: chosen.displayStat,
          statLevel: levelLabel(effectiveLevel(chosen.level_id, chosen.league_id)),
          levelNum: effectiveLevel(chosen.level_id, chosen.league_id),
        });
      }
    }
  }

  // Value vs. demand (2026-09-04, Rees's ask): DEM (from the manual OOTP
  // export, see free_agent_demands) is a real AAV ask, confirmed directly
  // with Rees -- "some players will demand that flat, some players will
  // want a different schedule [but] the DEM matches with the AAV of the
  // contract... For our purposes the AAV should work as we haven't modeled
  // out multi-year value and regression potentials." That means it compares
  // directly against the existing market-rate curve (also an AAV
  // prediction, /admin/market-rates) with no conversion needed -- no new
  // valuation model required for this piece.
  const { data: latestDemandImport } = await supabase
    .from("free_agent_demand_imports").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
  const demandImportId = (latestDemandImport as { id: number } | null)?.id ?? null;
  const demandByPlayer = new Map<number, number>();
  if (demandImportId !== null) {
    const demandRows = await fetchByIdsChunked<{ player_id: number; demand_salary: number | null }>(displayIds, (chunk) =>
      supabase.from("free_agent_demands").select("player_id,demand_salary")
        .eq("import_id", demandImportId).in("player_id", chunk) as never
    );
    demandRows.forEach((d) => { if (d.demand_salary !== null) demandByPlayer.set(d.player_id, d.demand_salary); });
  }

  const [curves, roleMultipliers] = await Promise.all([getLatestMarketRateCurves(), getLatestRoleMultipliers()]);
  const curveByType = new Map(curves.map((c) => [c.playerType, c]));
  const multiplierByRole = new Map(roleMultipliers.map((m) => [m.role, m.finalMultiplier]));
  function fairValueAav(overall: number, role: string | null): number | null {
    if (role === null) return null;
    const curve = curveByType.get(playerTypeForRole(role));
    if (!curve) return null;
    const base = Math.exp(curve.intercept + curve.slope * overall);
    return base * (multiplierByRole.get(role) ?? 1);
  }

  // "Sign" (2026-09-06, Rees's ask): would signing this free agent, at the
  // level his real stat line was earned at, improve OKC's own minor-league
  // system at his role? Two independent pieces, both must hold:
  //   1. Age vs. the level-age average, BY TYPE -- is he young for that
  //      level/hitter-or-pitcher combo? (new getLevelAgeBenchmarks/
  //      ageVsLevelAvg, queries.ts.)
  //   2. His Overall AND Potential both beat OKC's own average at that same
  //      role+level -- a lighter, OKC-scoped version of the Role Health
  //      topN-average idea already built for /my-roster and /org-minors,
  //      reused here via the same exported ROLE_HEALTH_ROWS/topNAvg helpers.
  //      Deliberately simplified vs. those pages: no RP-specific "SP
  //      overflow" pooling rule here, just a plain per-role average --
  //      flagged as a real simplification, not silently applied.
  // A role+level combo where OKC has literally zero players counts as "any
  // real signing would help" (treated as -Infinity), not "unknown" -- no
  // organizational depth at a spot is exactly the kind of gap this feature
  // exists to surface, not a reason to withhold judgment.
  const OKC_ORG_ID = 15;
  const SIGN_ROLE_ROWS = ROLE_HEALTH_ROWS.filter((row) => row.label !== "P Tot" && row.label !== "H Tot");

  const [levelAgeBenchmarks, roleLevelOverallBenchmarks, okcPlayerRows] = await Promise.all([
    getLevelAgeBenchmarks(),
    getRoleLevelBenchmarks("overall"),
    fetchAll<{ id: number; level: number | null; league_id: number | null }>((from, to) =>
      supabase.from("players").select("id,level,league_id").eq("organization_id", OKC_ORG_ID).range(from, to) as never
    ),
  ]);
  const okcPlayerById = new Map(okcPlayerRows.map((p) => [p.id, p]));
  const okcIds = okcPlayerRows.map((p) => p.id);
  const okcComputed = await fetchByIdsChunked<{ player_id: number; role: string | null; overall: number | null; batting: number | null; potential: number | null }>(okcIds, (chunk) =>
    supabase.from("player_computed").select("player_id,role,overall,batting,potential").eq("refresh_run_id", refreshRunId).in("player_id", chunk) as never
  );
  const okcByRoleLevel = new Map<string, { talent: number[]; potential: number[] }>();
  for (const c of okcComputed) {
    if (!c.role) continue;
    const p = okcPlayerById.get(c.player_id);
    const level = effectiveLevel(p?.level ?? null, p?.league_id ?? null);
    if (level === null) continue;
    const key = `${level}|${c.role}`;
    const bucket = okcByRoleLevel.get(key) ?? { talent: [], potential: [] };
    const talentMetric = playerTypeForRole(c.role) === "pitcher" ? c.overall : c.batting;
    if (talentMetric !== null) bucket.talent.push(talentMetric);
    if (c.potential !== null) bucket.potential.push(c.potential);
    okcByRoleLevel.set(key, bucket);
  }
  function okcAvgAt(level: number, role: string): { avgTalent: number; avgPotential: number } {
    const topN = SIGN_ROLE_ROWS.find((row) => row.roles.includes(role))?.topN ?? 1;
    const bucket = okcByRoleLevel.get(`${level}|${role}`);
    return {
      avgTalent: (bucket ? topNAvg(bucket.talent, topN) : null) ?? -Infinity,
      avgPotential: (bucket ? topNAvg(bucket.potential, topN) : null) ?? -Infinity,
    };
  }

  // Suggested level to sign+assign (2026-09-06) -- same interpolation idea
  // as compute-ratings.ts's ETA model (`estimateSuggestedLevel`): find where
  // this player's real Overall lands on his OWN role's level x Overall
  // benchmark ladder (getRoleLevelBenchmarks, the same live aggregation
  // /glossary and the ETA model both already use), rather than inventing a
  // second ladder just for this page.
  const roleLevelOverallByRole = new Map(
    roleLevelOverallBenchmarks.map((r) => [r.role, new Map(r.byLevel.map((c) => [c.level, c.avgValue]))])
  );
  function estimateSuggestedLevelNum(role: string, overall: number): number | null {
    const byLevel = roleLevelOverallByRole.get(role);
    if (!byLevel) return null;
    const points: [number, number][] = [];
    for (let lvl = 1; lvl <= 8; lvl++) {
      const v = byLevel.get(lvl);
      if (v !== null && v !== undefined) points.push([lvl, v]);
    }
    if (points.length === 0) return null;
    if (overall >= points[0][1]) return points[0][0];
    const worst = points[points.length - 1];
    if (overall <= worst[1]) return worst[0];
    for (let i = 0; i < points.length - 1; i++) {
      const [levelA, valA] = points[i];
      const [levelB, valB] = points[i + 1];
      if (overall <= valA && overall >= valB) {
        const frac = valA === valB ? 0 : (valA - overall) / (valA - valB);
        return levelA + frac * (levelB - levelA);
      }
    }
    return worst[0];
  }

  const rows: PlayerRow[] = rawRows.map((r) => {
    const lastTeamId = lastTeamIdByPlayer.get(r.player_id);
    const team = lastTeamId != null ? teamById.get(lastTeamId) : undefined;
    const wai = warAbIpById.get(r.player_id);
    const demandSalary = demandByPlayer.get(r.player_id) ?? null;
    const fairValue = fairValueAav(r.overall, r.role);
    const valueGapPct = demandSalary !== null && fairValue !== null && fairValue > 0
      ? ((fairValue - demandSalary) / fairValue) * 100
      : null;

    let signFlag: boolean | null = null;
    let suggestedSignLevel: string | null = null;
    if (r.role) {
      const suggestedLevelFrac = estimateSuggestedLevelNum(r.role, r.overall);
      if (suggestedLevelFrac !== null) suggestedSignLevel = levelLabel(Math.round(suggestedLevelFrac));
      if (wai?.levelNum != null) {
        const ageDiff = ageVsLevelAvg(r.age, wai.levelNum, r.ph, levelAgeBenchmarks);
        if (ageDiff !== null) {
          const { avgTalent, avgPotential } = okcAvgAt(wai.levelNum, r.role);
          signFlag = ageDiff < 0 && r.overall > avgTalent && r.potential > avgPotential;
        }
      }
    }

    return {
      ...r,
      signFlag,
      suggestedSignLevel,
      team_name: team?.name ?? null,
      team_nickname: team?.nickname ?? null,
      team_abbr: lastTeamId != null ? (abbrByTeamId.get(lastTeamId) ?? null) : null,
      war: wai?.war ?? r.war,
      ab: wai?.ab ?? r.ab,
      ip: wai?.ip ?? r.ip,
      statLevel: wai?.statLevel ?? r.statLevel,
      demandSalary,
      fairValueAav: fairValue,
      valueGapPct,
    };
  });

  return { rows, totalRealFreeAgents: players.length, totalWithRatings };
}
