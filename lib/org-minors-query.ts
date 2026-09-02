import { makeSupabaseClient } from "./supabase-client";
import { getRoleLevelBenchmarks } from "./queries";
import { effectiveLevel, levelLabel as canonicalLevelLabel, CANONICAL_LEVELS } from "./display-helpers";

const supabase = makeSupabaseClient();

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function latestRefreshRunId(): Promise<number> {
  const { data, error } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`No player_computed data found: ${error?.message}`);
  return (data as { refresh_run_id: number }).refresh_run_id;
}

// Raw players.level query filter -- NOT canonical levels. level=4 alone
// covers both real A+ and A leagues (see effectiveLevel's comment); fetching
// by raw level here still correctly pulls both, since the split only
// matters once league_id is also read, below.
const MINOR_LEVELS = [2, 3, 4, 5, 6];

// Discovered 2026-08-19: StatsPlus has no separate team entity for
// international-complex / not-yet-rostered amateur signees -- they're parked
// under the MLB team_id (level=1, same as real MLB players) but distinguished
// by a NEGATIVE league_id (confirmed: org 15's team_id=15 has 34 players at
// league_id=200, ages 22-33 -- a normal active MLB roster -- and 60 players at
// league_id=-200, ages 16-19 -- clearly the international academy). Real MLB
// roster keeps league_id=200 (matches the LEAGUE_IDS used elsewhere for stats
// pulls); anything negative under the same team_id is the international group.
// Synthetic team_id -orgId is used to give the international group its own
// grid box even though there's no real teams row for it.

// "Healthy enough to count" (2026-08-28, Rees's spec): DTD players (injured
// but not placed on any DL -- is_on_dl and is_on_dl60 both false) always
// count, per his explicit instruction. A player actually on a DL counts only
// if they'll be back within 7 days (injury_left <= 7) -- "healthy within a
// 2-week sim." A healthy (not injured at all) player always counts.
const HEALTHY_WITHIN_DAYS = 7;
function isAvailable(p: { injury_is_injured: boolean | null; is_on_dl: boolean | null; is_on_dl60: boolean | null; injury_left: number | null }): boolean {
  if (!p.injury_is_injured) return true;
  if (!p.is_on_dl && !p.is_on_dl60) return true; // DTD -- always counts
  return (p.injury_left ?? Infinity) <= HEALTHY_WITHIN_DAYS;
}

export interface MinorsPlayerRow {
  player_id: number;
  first_name: string;
  last_name: string;
  age: number | null;
  level: number | null;
  levelLabel: string;
  team_id: number | null;
  team_name: string | null;
  team_nickname: string | null;
  pos: string | null;
  role: string | null;
  ph: "H" | "P" | null;
  overall: number | null;
  batting: number | null;
  potential: number | null;
  prospect_potential: number | null;
  eta: number | null;
  war: number | null;
  ab: number | null;
  ip: number | null;
  available: boolean;
  // Role-Level-benchmark-based, reworked 2026-08-28 (v2 -- see HANDOFF.md/
  // git history for the original one-average-per-level version, replaced
  // because comparing to a level's own average structurally caught ~half
  // of any level's players as "below average," which read as far too many
  // demotions). Both bars are against the FULL-POOL leaguewide average
  // (queries.ts's getRoleLevelBenchmarks), same as before -- NOT the
  // Role Health table's top-N-per-team number, which is a deliberately
  // separate benchmark.
  // "promote" if the deciding metric already clears the level ABOVE's own
  // average -- unchanged from before: "ready to contribute there," not
  // just "better than average here."
  // "demote" if the deciding metric is below the MIDPOINT between this
  // level's average and the level BELOW's average -- Rees's fix for the
  // above: a player has to be closer to belonging a level down than to
  // where they are now, not merely below-average for their own level.
  // The DECIDING METRIC is role-dependent as of 2026-09-02 (see
  // isPitcherRole above): Batting for hitters, Overall for pitchers.
  // International (no real rung on the ladder) never gets either flag.
  // MLB (no level above) can only ever demote; Rookie (no level below)
  // can only ever promote -- a Rookie-level player can no longer be
  // flagged demote at all, since there's nowhere lower to send them.
  levelFlag: "promote" | "demote" | null;
}

// 2026-08-28: all three RAG signals below are now 0-100 PERCENTILES (null =
// no grade), fed straight into display-helpers.ts's percentileStyle -- the
// same 5-stop red/orange/yellow/green/blue gradient used for Overall grades
// elsewhere on the site, instead of a discrete 3-bucket red/amber/green.
// Each percentile is this cell's own metric normalized onto that 0-100
// scale by the functions below (countPercentile/avgDiffPercentile/
// rankPercentile) -- see those for the actual calibration.
export interface RoleHealthCell {
  level: number;
  levelLabel: string;
  count: number;
  injuredCount: number; // players in this role/level excluded from `count` for not being back within 7 days
  min: number; // 0 = no minimum, not scored
  countPct: number | null; // staffing count vs. `min`
  // Talent-vs-league comparison (2026-08-28, Rees's ask) -- separate from
  // the staffing-count RAG above. leagueAvg/orgAvg are both top-N-per-team
  // Overall averages (see topN below), regardless of health -- injury
  // doesn't change a player's talent grade, unlike the count above. null
  // when nobody exists at that role/level on either side to average.
  leagueAvg: number | null;
  orgAvg: number | null;
  avgPct: number | null; // org vs. league average diff
  // League rank (2026-08-28, new) -- where Oklahoma City's own top-N average
  // ranks among every team with at least one player at this role/level (1 =
  // best). totalTeams is how many teams had a rank to compare against, so
  // e.g. "5th of 28" can be shown, not just a bare number.
  rank: number | null;
  totalTeams: number | null;
  rankPct: number | null;
}
export interface RoleHealthRow {
  label: string;
  byLevel: RoleHealthCell[];
}

export interface TeamPositionCounts {
  team_id: number;
  team_name: string;
  team_nickname: string;
  level: number | null;
  levelLabel: string;
  counts: Record<string, number>;
}

const INTERNATIONAL_TEAM_ID_OFFSET = -1_000_000; // keeps synthetic ids well clear of any real team id

// Which metric decides promote/demote and Role Health's Org/League avg &
// rank, per role (2026-09-02, Rees's ask). For hitters: Batting, not
// Overall -- Role already distinguishes fielding ability (a shortstop-
// capable player is already bucketed as SS), so the real test of whether a
// hitter belongs at a given level is his bat, not an Overall that also
// carries his glove/baserunning value. For pitchers: Overall is left as-is
// -- it's already effectively Pitching (a real pitcher's batting-side
// Overall contribution is negligible), and Overall is already on the new
// level-anchored calibrated scale, so no metric swap is needed there.
const PITCHER_ROLES = new Set(["SP", "RP"]);
function isPitcherRole(role: string): boolean {
  return PITCHER_ROLES.has(role);
}

// Row order updated 2026-08-28: SP, RP, C, 1B, INF, SS, CF, COF, DH is now
// the one canonical role order used everywhere on this page (also
// ROLE_FILTER_ORDER in MinorsTable.tsx). The two aggregate rows (Pitching
// Total, Hitting Total) sit directly below the specific roles they sum --
// Pitching Total right after RP, Hitting Total right after DH -- rather
// than at the very top, "so it reads as totals below the specific role
// counts" (Rees's wording). RP/1B/DH have no staffing minimum of their own
// (min:0); 1B/DH additionally get forceStatus:"green" on the count RAG
// specifically -- Rees's call that those two roles are "always fine" and
// shouldn't render as an untinted/neutral "none" like RP does.
//
// `topN` (2026-08-28, separate from `min`) is how many of an org's own best
// players at that role/level get averaged for the Org talent column -- "only
// a certain number of players on a roster can even play, so roster strength
// should be limited to expected players" (Rees's wording), rather than
// diluting the average with bench/depth players who won't actually see the
// field. Deliberately its own number, not reusing `min`: e.g. RP has no
// staffing minimum (min:0) but still gets a real top-5 for the talent
// average, and C's talent slot (top 1) is narrower than its 2-deep staffing
// minimum. The two Total rows use a flat top-10 over their pooled combined
// roles (not each sub-role's own top-N re-combined) per Rees's explicit
// "top 10 pitchers and top 10 hitters."
// forcePct: fixed percentile override for 1B/DH's staffing-count grade
// (Rees's call, 2026-08-28: those two roles are never actually a staffing
// risk regardless of count, so they shouldn't render as an ungraded "no
// color" the way RP -- also min:0 -- still does). 82 lands solidly in the
// green band without claiming to be leaguewide-elite (100/blue).
const ROLE_HEALTH_ROWS: { label: string; roles: string[]; min: number; topN: number; forcePct?: number }[] = [
  { label: "SP", roles: ["SP"], min: 5, topN: 5 },
  { label: "RP", roles: ["RP"], min: 0, topN: 5 },
  { label: "P Tot", roles: ["SP", "RP"], min: 13, topN: 10 }, // "Pitching (Total)", shortened 2026-08-28 -- was too wide for the role-health cards
  { label: "C", roles: ["C"], min: 2, topN: 1 },
  { label: "1B", roles: ["1B"], min: 0, topN: 1, forcePct: 82 },
  { label: "INF", roles: ["INF"], min: 3, topN: 3 },
  { label: "SS", roles: ["SS"], min: 1, topN: 1 },
  { label: "CF", roles: ["CF"], min: 1, topN: 1 },
  { label: "COF", roles: ["COF"], min: 3, topN: 2 },
  { label: "DH", roles: ["DH"], min: 0, topN: 1, forcePct: 82 },
  // New (2026-08-28): a combined-hitter row, same idea as Pitching (Total)
  // but for every non-pitching role. 14 is Rees's stated minimum.
  { label: "H Tot", roles: ["C", "1B", "INF", "SS", "CF", "COF", "DH"], min: 14, topN: 10 }, // "Hitting (Total)", shortened 2026-08-28
];

// Staffing-count percentile (2026-08-28, replaces the old 3-bucket
// red/amber/green): 0 healthy players = 0 (red), exactly at the minimum =
// 50 (yellow -- technically compliant, no depth margin), double the
// minimum or more = 100 (blue). Linear between those anchors, clamped.
// min<=0 means "not scored" -- null, same as before.
function countPercentile(count: number, min: number): number | null {
  if (min <= 0) return null;
  const ratio = count / min;
  if (ratio <= 1) return ratio * 50;
  return Math.min(100, 50 + (ratio - 1) * 50);
}

// Org-vs-league-average percentile (2026-08-28): a 0-point gap is dead
// center (50, yellow); +/-5 points (roughly a full "grade band" on the
// site's existing 20/40/50/65/80 Overall gradient) reaches the ends of the
// scale (100/blue, 0/red). Not something Rees specified a number for --
// worth revisiting against how it actually renders, same as the original
// +/-3 first pass before he set the discrete-threshold version this
// replaces.
const AVG_PCT_SPREAD = 5;
function avgDiffPercentile(orgAvg: number | null, leagueAvg: number | null): number | null {
  if (orgAvg === null || leagueAvg === null) return null;
  const diff = orgAvg - leagueAvg;
  return Math.max(0, Math.min(100, 50 + (diff / AVG_PCT_SPREAD) * 50));
}

// League-rank percentile (2026-08-28, new): 1st of N teams = 100 (blue),
// last of N = 0 (red), linear in between. A single-team "league" (should
// never happen in practice) falls back to neutral (50) rather than
// dividing by zero.
function rankPercentile(rank: number | null, totalTeams: number | null): number | null {
  if (rank === null || totalTeams === null) return null;
  if (totalTeams <= 1) return 50;
  return ((totalTeams - rank) / (totalTeams - 1)) * 100;
}

// Average of the top `n` values (by Overall) in a pool -- powers the Org
// talent column's "expected/playable roster strength" average above.
function topNAvg(values: number[], n: number): number | null {
  const top = [...values].sort((a, b) => b - a).slice(0, n);
  return top.length > 0 ? top.reduce((a, b) => a + b, 0) / top.length : null;
}

export async function getOrgMinorsPlayers(orgId: number): Promise<{ rows: MinorsPlayerRow[]; teamCounts: TeamPositionCounts[]; roleHealth: RoleHealthRow[] }> {
  const refreshRunId = await latestRefreshRunId();
  const internationalTeamId = INTERNATIONAL_TEAM_ID_OFFSET - orgId;

  const minorsPlayers = await fetchAll<{ id: number; first_name: string; last_name: string; age: number | null; level: number | null; team_id: number | null; league_id: number | null; injury_is_injured: boolean | null; is_on_dl: boolean | null; is_on_dl60: boolean | null; injury_left: number | null }>(
    (from, to) =>
      supabase.from("players").select("id,first_name,last_name,age,level,team_id,league_id,injury_is_injured,is_on_dl,is_on_dl60,injury_left")
        .eq("organization_id", orgId).in("level", MINOR_LEVELS).range(from, to) as never
  );
  // level=1 (MLB) rows for this org's own MLB team_id -- includes both the
  // real active roster (league_id=200) and the hidden international group
  // (league_id<0). team_id here equals orgId itself, matching how the MLB
  // parent team's own id is used as the organization_id elsewhere.
  const mlbAndIntlPlayers = await fetchAll<{ id: number; first_name: string; last_name: string; age: number | null; level: number | null; team_id: number | null; league_id: number | null; injury_is_injured: boolean | null; is_on_dl: boolean | null; is_on_dl60: boolean | null; injury_left: number | null }>(
    (from, to) =>
      supabase.from("players").select("id,first_name,last_name,age,level,team_id,league_id,injury_is_injured,is_on_dl,is_on_dl60,injury_left")
        .eq("organization_id", orgId).eq("team_id", orgId).eq("level", 1).range(from, to) as never
  );

  const players = [...minorsPlayers, ...mlbAndIntlPlayers];
  if (players.length === 0) return { rows: [], teamCounts: [], roleHealth: [] };
  const ids = players.map((p) => p.id);

  const teamIds = [...new Set(players.map((p) => p.team_id).filter((x): x is number => x !== null))];
  const teams = teamIds.length
    ? await fetchAll<{ id: number; name: string; nickname: string }>((from, to) =>
        supabase.from("teams").select("id,name,nickname").in("id", teamIds).range(from, to) as never
      )
    : [];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const computedById = new Map<number, { overall: number | null; batting: number | null; potential: number | null; prospect_potential: number | null; eta: number | null; ph: "H" | "P" | null; role: string | null }>();
  const ratingsPosById = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: comp, error: compErr } = await supabase.from("player_computed")
      .select("player_id,overall,batting,potential,prospect_potential,eta,ph,role")
      .eq("refresh_run_id", refreshRunId).in("player_id", chunk);
    if (compErr) throw compErr;
    (comp as never as { player_id: number; overall: number | null; batting: number | null; potential: number | null; prospect_potential: number | null; eta: number | null; ph: "H" | "P" | null; role: string | null }[])
      .forEach((c) => computedById.set(c.player_id, c));

    const { data: rat, error: ratErr } = await supabase.from("player_ratings_snapshots")
      .select("player_id,pos")
      .eq("refresh_run_id", refreshRunId).in("player_id", chunk);
    if (ratErr) throw ratErr;
    (rat as never as { player_id: number; pos: string | null }[]).forEach((r) => ratingsPosById.set(r.player_id, r.pos));
  }

  // WAR/AB/IP at the player's current level, current season -- same
  // convention as getTopProspectsDetailed/fetchComputedPlayers in
  // queries.ts (summed across stints at that level, not just the first --
  // gotcha 15).
  const { data: statYearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year")
    .eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const statSeasonYear = (statYearRow as { year: number } | null)?.year ?? null;

  const warAbIpById = new Map<number, { war: number | null; ab: number | null; ip: number | null }>();
  if (statSeasonYear !== null) {
    const { data: batData, error: batErr } = await supabase
      .from("player_batting_stats_snapshots").select("player_id,level_id,ab,war")
      .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", ids);
    if (batErr) throw batErr;
    const { data: pitData, error: pitErr } = await supabase
      .from("player_pitching_stats_snapshots").select("player_id,level_id,ip,war")
      .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", ids);
    if (pitErr) throw pitErr;

    const batByPlayer = new Map<number, { level_id: number; ab: number; war: number | null }[]>();
    (batData as never as { player_id: number; level_id: number; ab: number; war: number | null }[]).forEach((r) => {
      const arr = batByPlayer.get(r.player_id) ?? [];
      arr.push(r);
      batByPlayer.set(r.player_id, arr);
    });
    const pitByPlayer = new Map<number, { level_id: number; ip: number; war: number | null }[]>();
    (pitData as never as { player_id: number; level_id: number; ip: number; war: number | null }[]).forEach((r) => {
      const arr = pitByPlayer.get(r.player_id) ?? [];
      arr.push(r);
      pitByPlayer.set(r.player_id, arr);
    });
    const sumStat = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    for (const p of players) {
      const c = computedById.get(p.id);
      if (!c || p.level === null) continue;
      if (c.ph === "H") {
        const stints = (batByPlayer.get(p.id) ?? []).filter((x) => x.level_id === p.level);
        if (stints.length > 0) warAbIpById.set(p.id, { war: stints.some((x) => x.war !== null) ? sumStat(stints.map((x) => x.war ?? 0)) : null, ab: sumStat(stints.map((x) => x.ab)), ip: null });
      } else if (c.ph === "P") {
        const stints = (pitByPlayer.get(p.id) ?? []).filter((x) => x.level_id === p.level);
        if (stints.length > 0) warAbIpById.set(p.id, { war: stints.some((x) => x.war !== null) ? sumStat(stints.map((x) => x.war ?? 0)) : null, ab: null, ip: sumStat(stints.map((x) => x.ip)) });
      }
    }
  }

  // Role x Level Overall benchmarks (leaguewide full-pool average -- queries.ts's
  // existing Glossary-page aggregation, reused as-is for promote/demote below).
  // Deliberately NOT used for the Role Health table's own "Lg" column (see
  // leagueByTeamLevelRole below) -- Rees's call (2026-08-28) to keep the two
  // benchmarks separate: Glossary/promote-demote still means "typical talent
  // leaguewide," Role Health means "typical team's top-N roster strength."
  // Batting benchmark added 2026-09-02 (same aggregation, different metric)
  // -- see isPitcherRole above for which roles use which.
  const [benchmarks, battingBenchmarks] = await Promise.all([
    getRoleLevelBenchmarks("overall"),
    getRoleLevelBenchmarks("batting"),
  ]);
  const benchByRole = new Map(benchmarks.map((b) => [b.role, new Map(b.byLevel.map((c) => [c.level, c.avgValue]))]));
  const battingBenchByRole = new Map(battingBenchmarks.map((b) => [b.role, new Map(b.byLevel.map((c) => [c.level, c.avgValue]))]));

  // Leaguewide, per-team roster data for the Role Health table's "Lg" column
  // (2026-08-28) -- a separate fetch from benchmarks above, deliberately: this
  // needs each player's team_id to group by team before averaging, which the
  // flat leaguewide sum getRoleLevelBenchmarks returns can't provide. Same
  // level-1/international filtering convention as getRoleLevelBenchmarks
  // (real active MLB roster only; international signees, negative league_id,
  // excluded at every level) so the two stay conceptually comparable.
  const leagueAllPlayers = await fetchAll<{ id: number; level: number | null; team_id: number | null; league_id: number | null; is_active: boolean | null }>((from, to) =>
    supabase.from("players").select("id,level,team_id,league_id,is_active").not("level", "is", null).range(from, to) as never
  );
  const leaguePlayerById = new Map(leagueAllPlayers.map((p) => [p.id, p]));
  const leagueComputed = await fetchAll<{ player_id: number; role: string | null; overall: number | null; batting: number | null }>((from, to) =>
    supabase.from("player_computed").select("player_id,role,overall,batting").eq("refresh_run_id", refreshRunId).range(from, to) as never
  );
  // `${level}|${role}` -> team_id -> that team's deciding-metric values at
  // this role/level (Batting for hitter roles, Overall for pitcher roles --
  // see isPitcherRole above).
  const leagueByTeamLevelRole = new Map<string, Map<number, number[]>>();
  for (const c of leagueComputed) {
    if (!c.role) continue;
    const metricValue = isPitcherRole(c.role) ? c.overall : c.batting;
    if (metricValue === null) continue;
    const p = leaguePlayerById.get(c.player_id);
    if (!p || p.level === null || p.team_id === null) continue;
    if (p.level === 1 && p.is_active !== true) continue; // real MLB roster only
    const effLevel = effectiveLevel(p.level, p.league_id);
    if (effLevel === null || effLevel === 8) continue; // exclude international signees at every org, not just this one
    const key = `${effLevel}|${c.role}`;
    const byTeam = leagueByTeamLevelRole.get(key) ?? new Map<number, number[]>();
    const arr = byTeam.get(p.team_id) ?? [];
    arr.push(metricValue);
    byTeam.set(p.team_id, arr);
    leagueByTeamLevelRole.set(key, byTeam);
  }
  // Every team's own top-`topN` average at a role/level, one entry per team
  // that has at least one player there -- "roster strength" per Rees's
  // framing, one data point per team (not one per player, which would let a
  // few stacked orgs skew a flat pool average). Powers both the league
  // average (mean of these) and Oklahoma City's rank (its position in this
  // list, sorted best-first) below.
  function leagueTeamTopNAverages(roles: string[], level: number, topN: number): { teamId: number; avg: number }[] {
    const perTeam = new Map<number, number[]>();
    for (const role of roles) {
      const byTeam = leagueByTeamLevelRole.get(`${level}|${role}`);
      if (!byTeam) continue;
      for (const [teamId, vals] of byTeam) {
        const arr = perTeam.get(teamId) ?? [];
        arr.push(...vals);
        perTeam.set(teamId, arr);
      }
    }
    const out: { teamId: number; avg: number }[] = [];
    for (const [teamId, vals] of perTeam) {
      const avg = topNAvg(vals, topN);
      if (avg !== null) out.push({ teamId, avg });
    }
    return out;
  }

  const rows: MinorsPlayerRow[] = players.map((p) => {
    const c = computedById.get(p.id);
    const pos = ratingsPosById.get(p.id) ?? null;
    const overall = c?.overall ?? null;
    const batting = c?.batting ?? null;
    const potential = c?.potential ?? null;
    const role = c?.role ?? null;

    // effLevel is the CANONICAL level (see display-helpers.ts's
    // effectiveLevel) -- corrects the 2026-09-04 finding that raw
    // players.level=4 secretly covers two real leagues (A+ and A). Every
    // level-semantic use below (display, promote/demote, benchmark lookups,
    // team/role grouping) reads effLevel, never raw p.level.
    const effLevel = effectiveLevel(p.level, p.league_id);
    const isInternational = effLevel === 8;
    const effectiveTeamId = isInternational ? internationalTeamId : p.team_id;
    const team = p.team_id ? teamById.get(p.team_id) : undefined;
    const teamName = team?.name ?? null;
    const teamNickname = isInternational ? "International Academy" : (team?.nickname ?? null);
    const levelLabel = isInternational ? "Int'l" : canonicalLevelLabel(effLevel);

    // v2 promote/demote (2026-08-28, deciding metric split by role 2026-09-02
    // -- see the levelFlag field comment on MinorsPlayerRow above and
    // isPitcherRole's comment for the full rationale).
    let levelFlag: MinorsPlayerRow["levelFlag"] = null;
    if (!isInternational && effLevel !== null && role) {
      const usesPitching = isPitcherRole(role);
      const metricValue = usesPitching ? overall : batting;
      const byLevel = usesPitching ? benchByRole.get(role) : battingBenchByRole.get(role);
      if (metricValue !== null) {
        const ownAvg = byLevel?.get(effLevel) ?? null;

        if (effLevel > 1) {
          const aboveAvg = byLevel?.get(effLevel - 1) ?? null; // level 1 = MLB = the top rung, no level "above" it
          if (aboveAvg !== null && metricValue >= aboveAvg) levelFlag = "promote";
        }
        if (levelFlag === null && effLevel < 7) { // level 7 = Rookie = the bottom real rung, no level "below" it
          const belowAvg = byLevel?.get(effLevel + 1) ?? null;
          if (ownAvg !== null && belowAvg !== null && metricValue < (ownAvg + belowAvg) / 2) levelFlag = "demote";
        }
      }
    }

    const wai = warAbIpById.get(p.id);
    return {
      player_id: p.id, first_name: p.first_name, last_name: p.last_name, age: p.age,
      level: effLevel, levelLabel, team_id: effectiveTeamId, team_name: teamName, team_nickname: teamNickname,
      pos, role, ph: c?.ph ?? null, overall, batting, potential, prospect_potential: c?.prospect_potential ?? null, eta: c?.eta ?? null,
      war: wai?.war ?? null, ab: wai?.ab ?? null, ip: wai?.ip ?? null,
      available: isAvailable(p),
      levelFlag,
    };
  });

  // Position counts per team (MLB + international + minor-league affiliates)
  // -- unchanged, still by raw `pos` (this table's own separate concern from
  // the new role-health table below, which is what actually needs `role`).
  const countsByTeam = new Map<number, TeamPositionCounts>();
  for (const r of rows) {
    if (r.team_id === null) continue;
    if (!countsByTeam.has(r.team_id)) {
      countsByTeam.set(r.team_id, { team_id: r.team_id, team_name: r.team_name ?? "Unknown", team_nickname: r.team_nickname ?? "", level: r.level, levelLabel: r.levelLabel, counts: {} });
    }
    const bucket = countsByTeam.get(r.team_id)!;
    const key = r.pos ?? "?";
    bucket.counts[key] = (bucket.counts[key] ?? 0) + 1;
  }
  const orderKey = (t: TeamPositionCounts) => (t.team_id === internationalTeamId ? 99 : (t.level ?? 98));
  const teamCounts = [...countsByTeam.values()].sort((a, b) => orderKey(a) - orderKey(b));

  // Oklahoma City's own real team_id AT EACH LEVEL (2026-08-28) -- needed to
  // find "us" inside leagueTeamTopNAverages' per-team list for the rank
  // column. NOT the same as orgId itself except at level 1 (MLB): each
  // minor-league level is a distinct affiliate with its own team_id (e.g.
  // the Bulls at AAA), and every org has exactly one affiliate per level, so
  // this 1:1 lookup is safe. Built from `rows` (already computed above)
  // rather than re-querying.
  const okcTeamIdByLevel = new Map<number, number>();
  for (const r of rows) {
    if (r.level !== null && r.levelLabel !== "Int'l" && r.team_id !== null && !okcTeamIdByLevel.has(r.level)) {
      okcTeamIdByLevel.set(r.level, r.team_id);
    }
  }

  // Role-health RAG table (2026-08-28) -- healthy-only counts by role, per
  // level (MLB through Rookie; international excluded, it's not a real
  // competitive roster with staffing minimums the way an affiliate is).
  const roleHealth: RoleHealthRow[] = ROLE_HEALTH_ROWS.map(({ label, roles, min, topN, forcePct }) => ({
    label,
    byLevel: CANONICAL_LEVELS.filter((l) => l !== 8).map((level) => {
      const lvlLabel = canonicalLevelLabel(level);
      const inRole = rows.filter((r) => r.level === level && r.levelLabel !== "Int'l" && r.role && roles.includes(r.role));
      const count = inRole.filter((r) => r.available).length;
      // Shown alongside `count` (2026-08-28, Rees's ask) so a red/amber cell
      // reads as "actually short" vs. "fine on paper, just hurt right now" --
      // these players are excluded from `count` for the same reason
      // isAvailable() excludes them (not back within 7 days), not double-
      // counted with it.
      const injuredCount = inRole.length - count;

      // Org talent average (2026-08-28) -- top `topN` by the deciding metric
      // (Batting for hitter roles, Overall for pitcher roles -- see
      // isPitcherRole above, 2026-09-02), not every rostered player at this
      // role/level: "only a certain number of players on a roster can even
      // play, so roster strength should be limited to expected players"
      // (Rees's wording) -- a 6-deep bench at SP shouldn't drag the number
      // below what actually takes the mound. Health status doesn't factor in
      // here (unlike `count` above) -- a talent grade doesn't change because
      // someone's hurt. `roles` is always homogeneous (never mixes pitcher
      // and hitter roles -- see ROLE_HEALTH_ROWS), so checking the first
      // entry is enough to decide the metric for the whole row.
      const usesPitching = isPitcherRole(roles[0]);
      const orgAvg = topNAvg(
        inRole.map((r) => (usesPitching ? r.overall : r.batting)).filter((v): v is number => v !== null),
        topN
      );

      // League side (2026-08-28) -- every team's own top-`topN` average at
      // this role/level, sorted best-first. Powers both leagueAvg (the
      // mean) and rank (Oklahoma City's position in the list) below.
      // Explicitly NOT the same benchmark Glossary/promote-demote use (that
      // one stays a flat leaguewide pool average) -- Rees's call to keep
      // "typical team's roster strength" and "typical individual player"
      // as two separate numbers.
      const teamAverages = leagueTeamTopNAverages(roles, level, topN);
      const leagueAvg = teamAverages.length > 0 ? teamAverages.reduce((a, b) => a + b.avg, 0) / teamAverages.length : null;
      const sortedTeams = [...teamAverages].sort((a, b) => b.avg - a.avg);
      const okcTeamId = okcTeamIdByLevel.get(level) ?? null;
      const okcIdx = okcTeamId !== null ? sortedTeams.findIndex((t) => t.teamId === okcTeamId) : -1;
      const rank = okcIdx >= 0 ? okcIdx + 1 : null;
      const totalTeams = sortedTeams.length > 0 ? sortedTeams.length : null;

      return {
        level, levelLabel: lvlLabel, count, injuredCount, min,
        countPct: forcePct ?? countPercentile(count, min),
        leagueAvg, orgAvg, avgPct: avgDiffPercentile(orgAvg, leagueAvg),
        rank, totalTeams, rankPct: rankPercentile(rank, totalTeams),
      };
    }),
  }));

  return { rows, teamCounts, roleHealth };
}

export async function getOrgsForPicker(): Promise<{ id: number; name: string; nickname: string }[]> {
  const orgIdsWithPlayers = await fetchAll<{ organization_id: number }>((from, to) =>
    supabase.from("players").select("organization_id").not("organization_id", "is", null).range(from, to) as never
  );
  const validIds = new Set(orgIdsWithPlayers.map((p) => p.organization_id));
  const { data, error } = await supabase.from("teams").select("id,name,nickname").is("parent_team_id", null).order("name");
  if (error) throw error;
  return (data as { id: number; name: string; nickname: string }[]).filter((t) => validIds.has(t.id));
}
