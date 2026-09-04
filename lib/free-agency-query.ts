import { fetchComputedPlayers, fetchByIdsChunked, latestRefreshRunId } from "./queries";
import type { PlayerRow } from "./queries";
import { makeSupabaseClient } from "./supabase-client";
import { effectiveLevel, levelLabel } from "./display-helpers";

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
}

// "Real, actionable free agent" (established 2026-08-31 -- see HANDOFF.md's
// transaction-analysis section): the raw `free_agent` flag alone is noisy
// (tens of thousands of amateurs who've never been rostered) -- scoping to
// previously-rostered, non-retired players is what makes this a real,
// approachable list rather than a database curiosity.
export async function getFreeAgents(): Promise<FreeAgentsResult> {
  const supabase = makeSupabaseClient();
  const PAGE_SIZE = 1000;
  const players: { id: number; last_team_id: number }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("players").select("id,last_team_id")
      .eq("free_agent", true).eq("retired", false)
      .not("last_team_id", "is", null).neq("last_team_id", 0)
      .order("id").range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    players.push(...(data as { id: number; last_team_id: number }[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  if (players.length === 0) return { rows: [], totalRealFreeAgents: 0 };

  const lastTeamIdByPlayer = new Map(players.map((p) => [p.id, p.last_team_id]));

  // fetchComputedPlayers silently drops any id with no player_computed row
  // (a small, real slice right now -- players between team assignments this
  // exact refresh, confirmed ~12% as of 2026-09-04, mostly very young
  // players with no meaningful position/level context anyway). Surfaced via
  // totalRealFreeAgents vs. rows.length on the page rather than hidden.
  const ids = players.map((p) => p.id);
  const rawRows = await fetchComputedPlayers({ playerIds: ids, limit: ids.length });

  // fetchComputedPlayers resolves team_name/nickname/abbr off players.team_id
  // -- always null for a free agent (no current team). Remap to LAST team
  // instead, which is the actually useful "who did they just leave" context
  // for this page -- players.team_id is correctly left alone for every
  // other consumer of that function (getTopPlayers/getTopDraftees etc.),
  // which genuinely want CURRENT team.
  const lastTeamIds = [...new Set(rawRows.map((r) => lastTeamIdByPlayer.get(r.player_id)).filter((id): id is number => id != null))];
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
  const refreshRunId = await latestRefreshRunId();
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

  const warAbIpById = new Map<number, { war: number | null; ab: number | null; ip: number | null; statLevel: string | null }>();
  if (statSeasonYear !== null) {
    const batData = await fetchByIdsChunked<{ player_id: number; level_id: number; league_id: number | null; pa: number; ab: number; war: number | null }>(ids, (chunk) =>
      supabase.from("player_batting_stats_snapshots").select("player_id,level_id,league_id,pa,ab,war")
        .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", chunk) as never
    );
    const pitData = await fetchByIdsChunked<{ player_id: number; level_id: number; league_id: number | null; ip: number; war: number | null }>(ids, (chunk) =>
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
        });
      }
    }
  }

  const rows: PlayerRow[] = rawRows.map((r) => {
    const lastTeamId = lastTeamIdByPlayer.get(r.player_id);
    const team = lastTeamId != null ? teamById.get(lastTeamId) : undefined;
    const wai = warAbIpById.get(r.player_id);
    return {
      ...r,
      team_name: team?.name ?? null,
      team_nickname: team?.nickname ?? null,
      team_abbr: lastTeamId != null ? (abbrByTeamId.get(lastTeamId) ?? null) : null,
      war: wai?.war ?? r.war,
      ab: wai?.ab ?? r.ab,
      ip: wai?.ip ?? r.ip,
      statLevel: wai?.statLevel ?? r.statLevel,
    };
  });

  return { rows, totalRealFreeAgents: players.length };
}
