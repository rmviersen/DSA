import { makeSupabaseClient } from "./supabase-client";

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
  ph: "H" | "P" | null;
  overall: number | null;
  potential: number | null;
  prospect_potential: number | null;
  eta: number | null;
  // Simple, transparent heuristic only -- NOT a scouted recommendation.
  // "↑" = old for level and close to their ceiling already (potential -
  // overall <= 10). Blank left for Rees's own judgment; we don't have
  // real promote/demote data from StatsPlus to build this from.
  promoteFlag: "↑" | null;
}

export interface TeamPositionCounts {
  team_id: number;
  team_name: string;
  team_nickname: string;
  level: number | null;
  levelLabel: string;
  counts: Record<string, number>;
}

// Rough "old for level" thresholds -- age at which a player is no longer
// young for that level, used only to flag possible promote candidates.
const AGE_THRESHOLD: Record<number, number> = { 6: 19, 5: 20, 4: 21, 3: 22, 2: 23 };

const INTERNATIONAL_TEAM_ID_OFFSET = -1_000_000; // keeps synthetic ids well clear of any real team id

export async function getOrgMinorsPlayers(orgId: number): Promise<{ rows: MinorsPlayerRow[]; teamCounts: TeamPositionCounts[] }> {
  const refreshRunId = await latestRefreshRunId();
  const internationalTeamId = INTERNATIONAL_TEAM_ID_OFFSET - orgId;

  const minorsPlayers = await fetchAll<{ id: number; first_name: string; last_name: string; age: number | null; level: number | null; team_id: number | null; league_id: number | null }>(
    (from, to) =>
      supabase.from("players").select("id,first_name,last_name,age,level,team_id,league_id")
        .eq("organization_id", orgId).in("level", MINOR_LEVELS).range(from, to) as never
  );
  // level=1 (MLB) rows for this org's own MLB team_id -- includes both the
  // real active roster (league_id=200) and the hidden international group
  // (league_id<0). team_id here equals orgId itself, matching how the MLB
  // parent team's own id is used as the organization_id elsewhere.
  const mlbAndIntlPlayers = await fetchAll<{ id: number; first_name: string; last_name: string; age: number | null; level: number | null; team_id: number | null; league_id: number | null }>(
    (from, to) =>
      supabase.from("players").select("id,first_name,last_name,age,level,team_id,league_id")
        .eq("organization_id", orgId).eq("team_id", orgId).eq("level", 1).range(from, to) as never
  );

  const players = [...minorsPlayers, ...mlbAndIntlPlayers];
  if (players.length === 0) return { rows: [], teamCounts: [] };
  const ids = players.map((p) => p.id);

  const teamIds = [...new Set(players.map((p) => p.team_id).filter((x): x is number => x !== null))];
  const teams = teamIds.length
    ? await fetchAll<{ id: number; name: string; nickname: string }>((from, to) =>
        supabase.from("teams").select("id,name,nickname").in("id", teamIds).range(from, to) as never
      )
    : [];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const computedById = new Map<number, { overall: number | null; potential: number | null; prospect_potential: number | null; eta: number | null; ph: "H" | "P" | null }>();
  const ratingsPosById = new Map<number, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data: comp, error: compErr } = await supabase.from("player_computed")
      .select("player_id,overall,potential,prospect_potential,eta,ph")
      .eq("refresh_run_id", refreshRunId).in("player_id", chunk);
    if (compErr) throw compErr;
    (comp as never as { player_id: number; overall: number | null; potential: number | null; prospect_potential: number | null; eta: number | null; ph: "H" | "P" | null }[])
      .forEach((c) => computedById.set(c.player_id, c));

    const { data: rat, error: ratErr } = await supabase.from("player_ratings_snapshots")
      .select("player_id,pos")
      .eq("refresh_run_id", refreshRunId).in("player_id", chunk);
    if (ratErr) throw ratErr;
    (rat as never as { player_id: number; pos: string | null }[]).forEach((r) => ratingsPosById.set(r.player_id, r.pos));
  }

  const rows: MinorsPlayerRow[] = players.map((p) => {
    const c = computedById.get(p.id);
    const pos = ratingsPosById.get(p.id) ?? null;
    const overall = c?.overall ?? null;
    const potential = c?.potential ?? null;

    // Route level=1 rows to the real MLB box (league_id=200) or the
    // synthetic international box (league_id<0) -- see note above.
    const isInternational = p.level === 1 && p.league_id !== null && p.league_id < 0;
    const effectiveTeamId = isInternational ? internationalTeamId : p.team_id;
    const team = p.team_id ? teamById.get(p.team_id) : undefined;
    const teamName = team?.name ?? null;
    const teamNickname = isInternational ? "International Academy" : (team?.nickname ?? null);
    const levelLabel = isInternational ? "Int'l" : (p.level !== null ? (LEVEL_LABELS[p.level] ?? `Lvl ${p.level}`) : "—");

    let promoteFlag: MinorsPlayerRow["promoteFlag"] = null;
    if (p.level && !isInternational && p.age !== null && overall !== null && potential !== null) {
      const threshold = AGE_THRESHOLD[p.level];
      if (threshold !== undefined && p.age >= threshold && potential - overall <= 10) promoteFlag = "↑";
    }
    return {
      player_id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      age: p.age,
      level: p.level,
      levelLabel,
      team_id: effectiveTeamId,
      team_name: teamName,
      team_nickname: teamNickname,
      pos,
      ph: c?.ph ?? null,
      overall,
      potential,
      prospect_potential: c?.prospect_potential ?? null,
      eta: c?.eta ?? null,
      promoteFlag,
    };
  });

  // Position counts per team (MLB + international + minor-league affiliates).
  const countsByTeam = new Map<number, TeamPositionCounts>();
  for (const r of rows) {
    if (r.team_id === null) continue;
    if (!countsByTeam.has(r.team_id)) {
      countsByTeam.set(r.team_id, {
        team_id: r.team_id,
        team_name: r.team_name ?? "Unknown",
        team_nickname: r.team_nickname ?? "",
        level: r.level,
        levelLabel: r.levelLabel,
        counts: {},
      });
    }
    const bucket = countsByTeam.get(r.team_id)!;
    const key = r.pos ?? "?";
    bucket.counts[key] = (bucket.counts[key] ?? 0) + 1;
  }
  // Display order: MLB first, then affiliates by level, international last
  // (they're pre-level prospects, not a rung on the affiliate ladder).
  const orderKey = (t: TeamPositionCounts) => (t.team_id === internationalTeamId ? 99 : (t.level ?? 98));
  const teamCounts = [...countsByTeam.values()].sort((a, b) => orderKey(a) - orderKey(b));

  return { rows, teamCounts };
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
