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

  const warAbIpById = new Map<number, { war: number | null; ab: number | null; ip: number | null; statLevel: string | null }>();
  if (statSeasonYear !== null) {
    const batData = await fetchByIdsChunked<{ player_id: number; level_id: number; league_id: number | null; ab: number; war: number | null }>(ids, (chunk) =>
      supabase.from("player_batting_stats_snapshots").select("player_id,level_id,league_id,ab,war")
        .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", chunk) as never
    );
    const pitData = await fetchByIdsChunked<{ player_id: number; level_id: number; league_id: number | null; ip: number; war: number | null }>(ids, (chunk) =>
      supabase.from("player_pitching_stats_snapshots").select("player_id,level_id,league_id,ip,war")
        .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", chunk) as never
    );
    const sumStat = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

    const batByPlayer = new Map<number, { level_id: number; league_id: number | null; ab: number; war: number | null }[]>();
    batData.forEach((r) => { const arr = batByPlayer.get(r.player_id) ?? []; arr.push(r); batByPlayer.set(r.player_id, arr); });
    const pitByPlayer = new Map<number, { level_id: number; league_id: number | null; ip: number; war: number | null }[]>();
    pitData.forEach((r) => { const arr = pitByPlayer.get(r.player_id) ?? []; arr.push(r); pitByPlayer.set(r.player_id, arr); });

    // "Best" stint = numerically lowest level_id = highest level actually
    // played (a free agent released mid-optioning could have both an MLB
    // and a AAA stint the same season -- their real last MLB performance is
    // what matters for "identifying and approaching" them, same reasoning a
    // real scouting report would use). statLevel labels EXACTLY that stint,
    // via the shared effectiveLevel()/levelLabel() helpers -- resolves the
    // level=4 A/A+ ambiguity using that stint's own league_id, not a guess
    // (confirmed real: player_batting_stats_snapshots.level_id=4 mixes
    // league_id 203/204 exactly like players.level did, same fix applies).
    for (const r of rawRows) {
      if (r.ph === "H") {
        const stints = batByPlayer.get(r.player_id) ?? [];
        if (stints.length === 0) continue;
        const bestLevel = Math.min(...stints.map((s) => s.level_id));
        const atBest = stints.filter((s) => s.level_id === bestLevel);
        warAbIpById.set(r.player_id, {
          war: atBest.some((s) => s.war !== null) ? sumStat(atBest.map((s) => s.war ?? 0)) : null,
          ab: sumStat(atBest.map((s) => s.ab)),
          ip: null,
          statLevel: levelLabel(effectiveLevel(bestLevel, atBest[0].league_id)),
        });
      } else if (r.ph === "P") {
        const stints = pitByPlayer.get(r.player_id) ?? [];
        if (stints.length === 0) continue;
        const bestLevel = Math.min(...stints.map((s) => s.level_id));
        const atBest = stints.filter((s) => s.level_id === bestLevel);
        warAbIpById.set(r.player_id, {
          war: atBest.some((s) => s.war !== null) ? sumStat(atBest.map((s) => s.war ?? 0)) : null,
          ab: null,
          ip: sumStat(atBest.map((s) => s.ip)),
          statLevel: levelLabel(effectiveLevel(bestLevel, atBest[0].league_id)),
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
