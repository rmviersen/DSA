import { makeSupabaseClient } from "./supabase-client";
import { getRoleLevelBenchmarks } from "./queries";

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

const LEVEL_LABELS: Record<number, string> = { 1: "MLB", 2: "AAA", 3: "AA", 4: "A+", 5: "A-", 6: "Rookie" };
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
  potential: number | null;
  prospect_potential: number | null;
  eta: number | null;
  war: number | null;
  ab: number | null;
  ip: number | null;
  available: boolean;
  // Role-Level-benchmark-based (2026-08-28, replaces the old age+ceiling
  // heuristic entirely): "promote" if this player's current Overall already
  // clears the role's average Overall for the level immediately above
  // theirs -- the goal is nobody sitting meaningfully above where they're
  // rostered. "demote" if current Overall is below the role's own average
  // for the level they're AT -- they're behind their own level's bar.
  // International (no real rung on the ladder) and MLB (no level above it)
  // never get a promote flag; MLB players can still get flagged demote.
  levelFlag: "promote" | "demote" | null;
}

export interface RoleHealthCell {
  level: number;
  levelLabel: string;
  count: number;
  injuredCount: number; // players in this role/level excluded from `count` for not being back within 7 days
  min: number; // 0 = no minimum, not scored
  status: "red" | "amber" | "green" | "none";
  // Talent-vs-league comparison (2026-08-28, Rees's ask) -- separate from
  // the staffing-count RAG above. leagueAvg/orgAvg are both plain Overall
  // averages (all rostered players at that role/level, regardless of
  // health -- injury doesn't change a player's talent grade, unlike the
  // count above). null when nobody exists at that role/level on either
  // side to average.
  leagueAvg: number | null;
  orgAvg: number | null;
  avgStatus: "red" | "amber" | "green" | "none";
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
const INTERNATIONAL_LEVEL = 7; // matches queries.ts's effectiveLevel() remap

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
const ROLE_HEALTH_ROWS: { label: string; roles: string[]; min: number; forceStatus?: RoleHealthCell["status"] }[] = [
  { label: "SP", roles: ["SP"], min: 5 },
  { label: "RP", roles: ["RP"], min: 0 },
  { label: "Pitching (Total)", roles: ["SP", "RP"], min: 13 },
  { label: "C", roles: ["C"], min: 2 },
  { label: "1B", roles: ["1B"], min: 0, forceStatus: "green" },
  { label: "INF", roles: ["INF"], min: 3 },
  { label: "SS", roles: ["SS"], min: 1 },
  { label: "CF", roles: ["CF"], min: 1 },
  { label: "COF", roles: ["COF"], min: 3 },
  { label: "DH", roles: ["DH"], min: 0, forceStatus: "green" },
  // New (2026-08-28): a combined-hitter row, same idea as Pitching (Total)
  // but for every non-pitching role. 14 is Rees's stated minimum.
  { label: "Hitting (Total)", roles: ["C", "1B", "INF", "SS", "CF", "COF", "DH"], min: 14 },
];

function rowStatus(count: number, min: number): RoleHealthCell["status"] {
  if (min <= 0) return "none";
  if (count < min) return "red";
  if (count === min) return "amber"; // technically compliant, no depth margin
  return "green";
}

// Talent-vs-league RAG (2026-08-28) -- separate scale from rowStatus above,
// which grades a headcount against a fixed minimum. This grades the org's
// average Overall at a role/level against the leaguewide average for that
// same role/level. +/-3 (roughly one "grade band" on the app's existing
// 20/40/50/65/80 Overall color-gradient stops -- see display-helpers.ts's
// GRADIENT_STOPS) is a first-pass threshold, not something Rees specified a
// number for -- worth revisiting against how it actually renders.
const AVG_STATUS_THRESHOLD = 3;
function avgStatus(orgAvg: number | null, leagueAvg: number | null): RoleHealthCell["avgStatus"] {
  if (orgAvg === null || leagueAvg === null) return "none";
  const diff = orgAvg - leagueAvg;
  if (diff < -AVG_STATUS_THRESHOLD) return "red";
  if (diff > AVG_STATUS_THRESHOLD) return "green";
  return "amber";
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

  const computedById = new Map<number, { overall: number | null; potential: number | null; prospect_potential: number | null; eta: number | null; ph: "H" | "P" | null; role: string | null }>();
  const ratingsPosById = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: comp, error: compErr } = await supabase.from("player_computed")
      .select("player_id,overall,potential,prospect_potential,eta,ph,role")
      .eq("refresh_run_id", refreshRunId).in("player_id", chunk);
    if (compErr) throw compErr;
    (comp as never as { player_id: number; overall: number | null; potential: number | null; prospect_potential: number | null; eta: number | null; ph: "H" | "P" | null; role: string | null }[])
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

  // Role x Level Overall benchmarks (leaguewide -- queries.ts's existing
  // Glossary-page aggregation, reused as-is rather than re-derived here).
  const benchmarks = await getRoleLevelBenchmarks("overall");
  const benchByRole = new Map(benchmarks.map((b) => [b.role, new Map(b.byLevel.map((c) => [c.level, c.avgValue]))]));
  // Same benchmarks, but keeping `n` too (2026-08-28) -- needed to combine
  // multiple roles' leaguewide averages into one weighted average for the
  // "(Total)" rows below, which benchByRole's plain avgValue can't do.
  const benchCellByRole = new Map(benchmarks.map((b) => [b.role, new Map(b.byLevel.map((c) => [c.level, c]))]));

  const rows: MinorsPlayerRow[] = players.map((p) => {
    const c = computedById.get(p.id);
    const pos = ratingsPosById.get(p.id) ?? null;
    const overall = c?.overall ?? null;
    const potential = c?.potential ?? null;
    const role = c?.role ?? null;

    const isInternational = p.level === 1 && p.league_id !== null && p.league_id < 0;
    const effectiveTeamId = isInternational ? internationalTeamId : p.team_id;
    const team = p.team_id ? teamById.get(p.team_id) : undefined;
    const teamName = team?.name ?? null;
    const teamNickname = isInternational ? "International Academy" : (team?.nickname ?? null);
    const levelLabel = isInternational ? "Int'l" : (p.level !== null ? (LEVEL_LABELS[p.level] ?? `Lvl ${p.level}`) : "—");

    let levelFlag: MinorsPlayerRow["levelFlag"] = null;
    if (!isInternational && p.level !== null && role && overall !== null) {
      const byLevel = benchByRole.get(role);
      const ownLevelAvg = byLevel?.get(p.level) ?? null;
      if (ownLevelAvg !== null && overall < ownLevelAvg) levelFlag = "demote";
      else if (p.level > 1) {
        const levelAbove = p.level - 1; // level 1 = MLB = the top rung, no level "above" it
        const aboveAvg = byLevel?.get(levelAbove) ?? null;
        if (aboveAvg !== null && overall >= aboveAvg) levelFlag = "promote";
      }
    }

    const wai = warAbIpById.get(p.id);
    return {
      player_id: p.id, first_name: p.first_name, last_name: p.last_name, age: p.age,
      level: p.level, levelLabel, team_id: effectiveTeamId, team_name: teamName, team_nickname: teamNickname,
      pos, role, ph: c?.ph ?? null, overall, potential, prospect_potential: c?.prospect_potential ?? null, eta: c?.eta ?? null,
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

  // Leaguewide combined average for a set of roles at one level -- weighted
  // by each role's own leaguewide sample size, so e.g. Pitching (Total)'s
  // league average isn't just a naive 50/50 blend of the SP and RP averages
  // when the league actually has far more RPs than SPs (or vice versa).
  function combinedLeagueAvg(roles: string[], level: number): number | null {
    let sum = 0, n = 0;
    for (const role of roles) {
      const cell = benchCellByRole.get(role)?.get(level);
      if (cell && cell.avgValue !== null && cell.n > 0) { sum += cell.avgValue * cell.n; n += cell.n; }
    }
    return n > 0 ? sum / n : null;
  }

  // Role-health RAG table (2026-08-28) -- healthy-only counts by role, per
  // level (MLB through Rookie; international excluded, it's not a real
  // competitive roster with staffing minimums the way an affiliate is).
  const roleHealth: RoleHealthRow[] = ROLE_HEALTH_ROWS.map(({ label, roles, min, forceStatus }) => ({
    label,
    byLevel: Object.entries(LEVEL_LABELS).map(([lvlStr, lvlLabel]) => {
      const level = Number(lvlStr);
      const inRole = rows.filter((r) => r.level === level && r.levelLabel !== "Int'l" && r.role && roles.includes(r.role));
      const count = inRole.filter((r) => r.available).length;
      // Shown alongside `count` (2026-08-28, Rees's ask) so a red/amber cell
      // reads as "actually short" vs. "fine on paper, just hurt right now" --
      // these players are excluded from `count` for the same reason
      // isAvailable() excludes them (not back within 7 days), not double-
      // counted with it.
      const injuredCount = inRole.length - count;

      // Talent averages (2026-08-28) -- ALL rostered players at this
      // role/level count here, healthy or not (a talent grade doesn't
      // change because someone's hurt, unlike the staffing count above).
      const withOverall = inRole.filter((r) => r.overall !== null);
      const orgAvg = withOverall.length > 0 ? withOverall.reduce((a, r) => a + (r.overall as number), 0) / withOverall.length : null;
      const leagueAvg = combinedLeagueAvg(roles, level);

      return {
        level, levelLabel: lvlLabel, count, injuredCount, min,
        status: forceStatus ?? rowStatus(count, min),
        leagueAvg, orgAvg, avgStatus: avgStatus(orgAvg, leagueAvg),
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
