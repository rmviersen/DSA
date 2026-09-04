import { makeSupabaseClient } from "./supabase-client";
import { roundGrade, levelLabel, teamLogoUrl, effectiveLevel, CANONICAL_LEVELS } from "./display-helpers";

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

// For an `.in("col", ids)` fetch where `ids` itself might exceed 1000 --
// PostgREST caps a single response at 1000 rows regardless of how many ids
// are requested, and a bare `.in()` (no `.order()`+`.range()` semantics to
// paginate against) needs the id LIST chunked instead. Added 2026-09-04 for
// /free-agency's ~1800-id calls into fetchComputedPlayers -- every id-scoped
// query below this point in that function used to assume "at most a few
// hundred ids" and would have silently dropped rows past 1000 otherwise.
export async function fetchByIdsChunked<T>(ids: number[], build: (chunk: number[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const CHUNK = 900;
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await build(ids.slice(i, i + CHUNK));
    if (error) throw error;
    if (data) all.push(...data);
  }
  return all;
}

// PERFORMANCE FIX (2026-08-25): used to fetch the ENTIRE players table's
// organization_id column (up to ~45,757 rows across ~46 sequential pages,
// unfiltered) just to build a Set of which org ids actually have players --
// this ran on every load of /players, /prospects, /TBL/prospects (via
// getTeamRankings too), and was a second, separate contributor to the
// multi-second load times Rees flagged 2026-08-25 (see the note on
// fetchComputedPlayers below for the bigger one). Fixed by getting the
// small candidate team list FIRST (there are only ~30-40 parent-null
// "teams" rows total), then checking each candidate for at least one
// matching player IN PARALLEL (Promise.all) rather than scanning the
// whole players table -- wall-clock cost is now roughly one round trip,
// not 46 sequential ones.
export async function getOrgTeams() {
  const { data, error } = await supabase.from("teams").select("id,name,nickname").is("parent_team_id", null).order("name");
  if (error) throw error;
  const candidateTeams = data as { id: number; name: string; nickname: string }[];

  // "MLB parent org" = has parent_team_id null AND actually has players
  // attributed to it as an organization — filters out placeholder/conference
  // rows (e.g. "ODC Fire Conference") that also have a null parent but no
  // real roster.
  const hasPlayersResults = await Promise.all(
    candidateTeams.map(async (t) => {
      const { data: pd, error: pErr } = await supabase.from("players").select("id").eq("organization_id", t.id).limit(1);
      if (pErr) throw pErr;
      return { id: t.id, hasPlayers: (pd?.length ?? 0) > 0 };
    })
  );
  const validIds = new Set(hasPlayersResults.filter((r) => r.hasPlayers).map((r) => r.id));
  return candidateTeams.filter((t) => validIds.has(t.id));
}

export async function latestRefreshRunId(): Promise<number> {
  const { data, error } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`No player_computed data found: ${error?.message}`);
  return (data as { refresh_run_id: number }).refresh_run_id;
}

// Small nav-bar label showing how current the data is (2026-08-24) --
// distinct from latestRefreshRunId(): this reads refresh_runs directly and
// tolerates a null game_date (a run whose game-date pull failed shouldn't
// crash the whole nav), rather than joining through player_computed.
export async function getLatestGameDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from("refresh_runs")
    .select("game_date")
    .eq("status", "succeeded")
    .not("game_date", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { game_date: string } | null)?.game_date ?? null;
}

export interface TeamRankingRow {
  team_id: number;
  name: string;
  nickname: string;
  logoUrl: string | null;
  minorsRank: number | null;
  battingProspectRank: number | null;
  pitchingProspectRank: number | null;
  readinessRank: number | null;
  top100Count: number;
  // Org's own top 3 prospects (2026-08-20) -- always 0-3 entries, selected
  // and ordered by prospect_org_rank, but `rank` here is each player's
  // LEAGUEWIDE prospect_rank (per Rees's follow-up: the number shown should
  // be their overall rank, not their 1/2/3 org-relative slot). Highlighted
  // in the table's detail row instead of the old plain rank-summary text.
  topProspects: { rank: number | null; role: string | null; name: string }[];
}

// League-wide farm-system rankings, for the table next to /prospects.
// minorsRank/battingProspectRank/pitchingProspectRank/readinessRank all come
// straight from team_computed -- a faithful port of the original Power BI
// "RLB" methodology (see compute-team-ratings.ts's comments): minors/batting/
// pitching are avg Prospect Potential of the org's top 20/10-hitters/
// 10-pitchers by prospect_org_rank; readiness is avg CURRENT Overall of that
// same top-20 pool (how close the system already is, not its ceiling). Not
// something invented for this table -- reused as-is.
export async function getTeamRankings(): Promise<TeamRankingRow[]> {
  const refreshRunId = await latestRefreshRunId();
  const orgTeams = await getOrgTeams();
  const teamIds = orgTeams.map((t) => t.id);
  if (teamIds.length === 0) return [];

  const { data: tcData, error: tcErr } = await supabase.from("team_computed")
    .select("team_id,minors_rank,batting_prospect_rank,pitching_prospect_rank,tbl_readiness_rank")
    .eq("refresh_run_id", refreshRunId).in("team_id", teamIds);
  if (tcErr) throw tcErr;
  const tcByTeam = new Map((tcData as { team_id: number; minors_rank: number | null; batting_prospect_rank: number | null; pitching_prospect_rank: number | null; tbl_readiness_rank: number | null }[])
    .map((r) => [r.team_id, r]));

  // # of this org's players in the current leaguewide top 100 prospects.
  // "players!player_computed_player_id_fkey" (not the bare "players"
  // shorthand), 2026-08-31 gotcha: player_computed gained a SECOND foreign
  // key to players the same day (comp_player_id, for the player-comp
  // feature), so PostgREST can no longer infer which relationship a bare
  // "players(...)" embed means -- it started hard-erroring with PGRST201
  // ("more than one relationship was found") on every embedded join from
  // this table, breaking /prospects and /TBL/prospects outright. Every
  // embedded players(...) join off player_computed anywhere in this file
  // needs this same explicit constraint-name disambiguation now.
  const top100Rows = await fetchAll<{ player_id: number; players: { organization_id: number | null } | null }>((from, to) =>
    supabase.from("player_computed")
      .select("player_id,players!player_computed_player_id_fkey(organization_id)")
      .eq("refresh_run_id", refreshRunId).not("prospect_rank", "is", null).lte("prospect_rank", 100)
      .range(from, to) as never
  );
  const top100CountByOrg = new Map<number, number>();
  top100Rows.forEach((r) => {
    const orgId = r.players?.organization_id;
    if (orgId != null) top100CountByOrg.set(orgId, (top100CountByOrg.get(orgId) ?? 0) + 1);
  });

  // Each org's own top 3 prospects, SELECTED by prospect_org_rank (org-
  // relative, so no teamIds filter needed: the <=3 cutoff is already scoped
  // per org) but DISPLAYED with prospect_rank -- the leaguewide rank, per
  // Rees 2026-08-20 ("should be the prospect's overall rank, not just
  // 1,2,3"). org_rank still drives which 3 players and their order; it just
  // isn't the number shown next to them anymore.
  const top3Rows = await fetchAll<{ player_id: number; prospect_org_rank: number | null; prospect_rank: number | null; role: string | null; players: { first_name: string; last_name: string; organization_id: number | null } | null }>((from, to) =>
    supabase.from("player_computed")
      .select("player_id,prospect_org_rank,prospect_rank,role,players!player_computed_player_id_fkey(first_name,last_name,organization_id)")
      .eq("refresh_run_id", refreshRunId).not("prospect_org_rank", "is", null).lte("prospect_org_rank", 3)
      .range(from, to) as never
  );
  const top3ByOrg = new Map<number, { orgRank: number; rank: number | null; role: string | null; name: string }[]>();
  top3Rows.forEach((r) => {
    const orgId = r.players?.organization_id;
    if (orgId == null || r.prospect_org_rank == null || !r.players) return;
    const list = top3ByOrg.get(orgId) ?? [];
    list.push({ orgRank: r.prospect_org_rank, rank: r.prospect_rank, role: r.role, name: `${r.players.first_name} ${r.players.last_name}` });
    top3ByOrg.set(orgId, list);
  });
  top3ByOrg.forEach((list) => list.sort((a, b) => a.orgRank - b.orgRank));

  return orgTeams
    .map((t) => {
      const tc = tcByTeam.get(t.id);
      return {
        team_id: t.id,
        name: t.name,
        nickname: t.nickname,
        logoUrl: teamLogoUrl(t.name, t.nickname),
        minorsRank: tc?.minors_rank ?? null,
        battingProspectRank: tc?.batting_prospect_rank ?? null,
        pitchingProspectRank: tc?.pitching_prospect_rank ?? null,
        readinessRank: tc?.tbl_readiness_rank ?? null,
        top100Count: top100CountByOrg.get(t.id) ?? 0,
        topProspects: top3ByOrg.get(t.id) ?? [],
      };
    })
    .sort((a, b) => (a.minorsRank ?? 999) - (b.minorsRank ?? 999));
}

async function latestDraftClassImportId(): Promise<{ id: number; draft_year: number } | null> {
  const { data, error } = await supabase
    .from("draft_class_imports").select("id,draft_year").order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as { id: number; draft_year: number } | null;
}

interface RatingsSlice {
  cntct: number | null; pow: number | null; eye: number | null; speed: number | null;
  stf: number | null; mov: number | null; ctrl: number | null; stm: number | null;
  pos: string | null;
}

export interface PlayerRow extends RatingsSlice {
  player_id: number;
  first_name: string;
  last_name: string;
  team_name: string | null;
  team_nickname: string | null;
  team_abbr: string | null;
  age: number | null;
  overall: number;
  potential: number;
  prospect_potential: number;
  prospect_rank: number | null;
  org_rank: number | null;
  prospect_org_rank: number | null;
  prospect_role_rank: number | null; // leaguewide rank within role bucket, by prospect_potential (2026-08-27)
  role: string | null; // projected defensive role grouping (SP/RP/INF/OF/C/UTIL) -- distinct from `pos` (raw current position)
  ph: "H" | "P" | null; // hitter/pitcher, from player_computed -- added 2026-08-27 for /players and /draft's H/P filter
  // Current-season, current-LEVEL only (2026-08-27) -- same convention
  // ProspectRow's seasonTotals already uses (see getTopProspectsDetailed).
  // war applies to both hitters and pitchers; ab is hitters-only, ip is
  // pitchers-only -- whichever doesn't apply to this player's ph is null.
  war: number | null;
  ab: number | null;
  ip: number | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_overall_pick: number | null;
  // Nearest established-MLB-player comp (2026-08-31) -- see
  // scripts/compute-ratings.ts's "Player comp" section for the full
  // methodology. compPlayerId/compSimilarity come straight from
  // player_computed; compPlayerName is resolved here since the comp
  // target is often someone NOT already in this query's own result set
  // (an established veteran, not a fellow prospect). All null for anyone
  // with no comp -- a non-prospect (comps are only computed for the
  // prospect pool) or, in principle, a prospect whose role bucket had no
  // established candidates at all (not currently observed in real data).
  compPlayerId: number | null;
  compPlayerName: string | null;
  compSimilarity: number | null;
}

// PERFORMANCE FIX (2026-08-25): this function used to fetch `players` FIRST
// (unfiltered, up to the full ~45,757-row table when no orgId/playerIds
// scope applied -- the exact case /TBL/prospects and /prospects use by
// default), then chunk-fetch player_computed and player_ratings_snapshots
// for ALL of them in batches of 500, THEN finally sort and slice down to
// `opts.limit` in JS. For the unfiltered leaguewide case that was ~46
// pages just for `players`, plus ~92 more each for player_computed and
// player_ratings_snapshots -- 230+ sequential round trips to build a
// 500-row list, which is exactly what was making /TBL/prospects take
// 20+ seconds to load (confirmed in dev server logs all session, Rees
// flagged it live 2026-08-25). Fixed by querying player_computed FIRST,
// with the sort and limit applied IN the query (pushed down to Postgres)
// instead of in JS after the fact -- then only fetching players/ratings
// for that much smaller resulting set. Queries a small buffer beyond
// opts.limit (+50) and still re-sorts/re-slices in JS afterward as a
// safety net, in case a handful of player_computed rows lack a matching
// players/ratings row (shouldn't happen in healthy data, but the original
// code silently tolerated it by filtering those out, so this preserves
// that behavior rather than risking returning fewer than `limit` rows).
// Exported 2026-09-04 for /free-agency (lib/free-agency-query.ts) to reuse
// directly via its `playerIds` scope, rather than duplicating this whole
// player_computed + players + ratings + WAR/AB/IP join.
export async function fetchComputedPlayers(opts: { orgId?: number; prospectsOnly?: boolean; playerIds?: number[]; limit: number }) {
  const refreshRunId = await latestRefreshRunId();

  // Org-scoped case: get that org's player IDs first. Cheap -- one org's
  // full roster + minors + international complex is at most a few hundred
  // players, nothing like the leaguewide ~45,757.
  let orgPlayerIds: number[] | undefined;
  if (opts.orgId) {
    const orgPlayers = await fetchAll<{ id: number }>((from, to) =>
      supabase.from("players").select("id").eq("organization_id", opts.orgId).order("id").range(from, to) as never
    );
    orgPlayerIds = orgPlayers.map((p) => p.id);
    if (orgPlayerIds.length === 0) return [];
  }
  const idFilter = opts.playerIds ?? orgPlayerIds;

  // Paginated instead of one .limit() call (2026-09-04, fixed for
  // /free-agency, the first caller ever to request more than 1000 rows) --
  // Supabase/PostgREST silently caps a single request at 1000 rows
  // regardless of the requested .limit() value (the same "select() caps at
  // 1000 rows by default" gotcha documented elsewhere in this codebase,
  // just triggered here via .limit() instead of an unbounded .select()).
  // Every existing caller (getTopPlayers/getTopDraftees, limit <= 500) only
  // ever needed a single page and behaves identically -- this only changes
  // behavior for a request that actually exceeds 1000 rows.
  type ComputedRow = { player_id: number; overall: number; potential: number; prospect_potential: number; prospect_rank: number | null; org_rank: number | null; prospect_org_rank: number | null; prospect_role_rank: number | null; role: string | null; ph: "H" | "P" | null; comp_player_id: number | null; comp_similarity: number | null };
  const sortCol = opts.prospectsOnly ? "prospect_potential" : "overall";
  const targetCount = opts.limit + 50;
  const computed: ComputedRow[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (computed.length < targetCount) {
      let cq = supabase
        .from("player_computed")
        .select("player_id,overall,potential,prospect_potential,prospect_rank,org_rank,prospect_org_rank,prospect_role_rank,role,ph,comp_player_id,comp_similarity")
        .eq("refresh_run_id", refreshRunId)
        .order(sortCol, { ascending: false })
        .range(from, Math.min(from + PAGE, targetCount) - 1);
      if (opts.prospectsOnly) cq = cq.not("prospect_rank", "is", null);
      if (idFilter) cq = cq.in("player_id", idFilter);
      const { data, error } = await cq;
      if (error) throw error;
      if (!data || data.length === 0) break;
      computed.push(...(data as ComputedRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  const relevantIds = computed.map((c) => c.player_id);
  if (relevantIds.length === 0) return [];

  // Comp targets are frequently NOT in relevantIds at all (an established
  // veteran comp'd against a prospect is almost never also a top-200
  // prospect himself) -- a separate small lookup, not reusable with the
  // `players` fetch below.
  const compPlayerIds = [...new Set(computed.map((c) => c.comp_player_id).filter((id): id is number => id !== null))];
  const compNameById = new Map<number, string>();
  if (compPlayerIds.length > 0) {
    const { data: compPlayers, error: compErr } = await supabase
      .from("players").select("id,first_name,last_name").in("id", compPlayerIds);
    if (compErr) throw compErr;
    (compPlayers as { id: number; first_name: string; last_name: string }[]).forEach((p) =>
      compNameById.set(p.id, `${p.first_name} ${p.last_name}`)
    );
  }

  // Now scoped to just the (at most opts.limit + 50) winning IDs -- fits in
  // one page/chunk in every realistic case, no more per-500 looping needed.
  const players = await fetchAll<{ id: number; first_name: string; last_name: string; age: number | null; organization_id: number | null; team_id: number | null; level: number | null; draft_year: number | null; draft_round: number | null; draft_overall_pick: number | null }>(
    (from, to) =>
      supabase.from("players").select("id,first_name,last_name,age,organization_id,team_id,level,draft_year,draft_round,draft_overall_pick").in("id", relevantIds).order("id").range(from, to) as never
  );
  const playerById = new Map(players.map((p) => [p.id, p]));

  const teams = await fetchAll<{ id: number; name: string; nickname: string }>((from, to) =>
    supabase.from("teams").select("id,name,nickname").range(from, to) as never
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // team_id -> abbreviation, same pattern getTopProspectsDetailed already
  // uses below -- teams itself has no abbr column; team_batting_stats_
  // snapshots does (StatsPlus's own "OKC"/"NY"-style codes). Ordered by
  // year descending so a relocated/rebranded team's CURRENT abbreviation
  // wins the dedup, not an arbitrary old one (see that other call site's
  // comment for the real Kingston->OKC case this was caught on).
  const abbrRows = await fetchAll<{ team_id: number; abbr: string }>((from, to) =>
    supabase.from("team_batting_stats_snapshots").select("team_id,abbr").eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).range(from, to) as never
  );
  const abbrByTeamId = new Map<number, string>();
  abbrRows.forEach((r) => { if (!abbrByTeamId.has(r.team_id)) abbrByTeamId.set(r.team_id, r.abbr); });

  const ratingsById = new Map<number, RatingsSlice>();
  const ratingsData = await fetchByIdsChunked<{ player_id: number } & RatingsSlice>(relevantIds, (chunk) =>
    supabase
      .from("player_ratings_snapshots")
      .select("player_id,cntct,pow,eye,speed,stf,mov,ctrl,stm,pos")
      .eq("refresh_run_id", refreshRunId)
      .in("player_id", chunk) as never
  );
  ratingsData.forEach((r) => ratingsById.set(r.player_id, r));

  // WAR/AB/IP (2026-08-27, Rees's spec) -- current season, current LEVEL
  // only, same convention getTopProspectsDetailed's seasonTotals already
  // uses. relevantIds is at most opts.limit+50 (a few hundred at most), so
  // this is one direct query per stat table, not the chunked-by-500 pattern
  // getTopProspectsDetailed needs for its up-to-200-ID case plus historical
  // baseline lookups -- no real need for that here.
  const { data: statYearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year")
    .eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const statSeasonYear = (statYearRow as { year: number } | null)?.year ?? null;

  const warAbIpById = new Map<number, { war: number | null; ab: number | null; ip: number | null }>();
  if (statSeasonYear !== null) {
    const batData = await fetchByIdsChunked<{ player_id: number; level_id: number; ab: number; war: number | null }>(relevantIds, (chunk) =>
      supabase
        .from("player_batting_stats_snapshots")
        .select("player_id,level_id,ab,war")
        .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", chunk) as never
    );
    const pitData = await fetchByIdsChunked<{ player_id: number; level_id: number; ip: number; war: number | null }>(relevantIds, (chunk) =>
      supabase
        .from("player_pitching_stats_snapshots")
        .select("player_id,level_id,ip,war")
        .eq("refresh_run_id", refreshRunId).eq("year", statSeasonYear).eq("split_id", 1).in("player_id", chunk) as never
    );

    const batByPlayer = new Map<number, { level_id: number; ab: number; war: number | null }[]>();
    batData.forEach((r) => {
      const arr = batByPlayer.get(r.player_id) ?? [];
      arr.push(r);
      batByPlayer.set(r.player_id, arr);
    });
    const pitByPlayer = new Map<number, { level_id: number; ip: number; war: number | null }[]>();
    pitData.forEach((r) => {
      const arr = pitByPlayer.get(r.player_id) ?? [];
      arr.push(r);
      pitByPlayer.set(r.player_id, arr);
    });

    const sumStat = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    for (const c of computed) {
      const p = playerById.get(c.player_id);
      if (!p || p.level === null) continue;
      // A player can have more than one stint AT their current level in a
      // season (optioned/recalled, etc.) -- sum across matching stints
      // rather than taking the first, same fix as HANDOFF gotcha 15.
      if (c.ph === "H") {
        const stints = (batByPlayer.get(c.player_id) ?? []).filter((x) => x.level_id === p.level);
        if (stints.length > 0) {
          warAbIpById.set(c.player_id, {
            war: stints.some((x) => x.war !== null) ? sumStat(stints.map((x) => x.war ?? 0)) : null,
            ab: sumStat(stints.map((x) => x.ab)),
            ip: null,
          });
        }
      } else if (c.ph === "P") {
        const stints = (pitByPlayer.get(c.player_id) ?? []).filter((x) => x.level_id === p.level);
        if (stints.length > 0) {
          warAbIpById.set(c.player_id, {
            war: stints.some((x) => x.war !== null) ? sumStat(stints.map((x) => x.war ?? 0)) : null,
            ab: null,
            ip: sumStat(stints.map((x) => x.ip)),
          });
        }
      }
    }
  }

  const sortKey = opts.prospectsOnly ? "prospect_potential" : "overall";
  const rows: PlayerRow[] = computed
    .map((c) => {
      const p = playerById.get(c.player_id);
      const rt = ratingsById.get(c.player_id);
      const team = p?.team_id ? teamById.get(p.team_id) : undefined;
      const wai = warAbIpById.get(c.player_id);
      if (!p || !rt) return null;
      return {
        player_id: c.player_id,
        first_name: p.first_name, last_name: p.last_name, age: p.age,
        team_name: team?.name ?? null, team_nickname: team?.nickname ?? null,
        team_abbr: p.team_id ? (abbrByTeamId.get(p.team_id) ?? null) : null,
        overall: c.overall, potential: c.potential, prospect_potential: c.prospect_potential,
        prospect_rank: c.prospect_rank, org_rank: c.org_rank, prospect_org_rank: c.prospect_org_rank,
        prospect_role_rank: c.prospect_role_rank, role: c.role, ph: c.ph,
        war: wai?.war ?? null, ab: wai?.ab ?? null, ip: wai?.ip ?? null,
        // StatsPlus returns literal 0, not null, for players who were never
        // drafted (international signees, etc.) -- confirmed 2026-08-19.
        // Normalize to null here so every consumer of PlayerRow gets a
        // consistent "not drafted" signal instead of a misleading "0".
        draft_year: p.draft_year || null, draft_round: p.draft_round || null, draft_overall_pick: p.draft_overall_pick || null,
        compPlayerId: c.comp_player_id,
        compPlayerName: c.comp_player_id !== null ? (compNameById.get(c.comp_player_id) ?? null) : null,
        compSimilarity: c.comp_similarity,
        ...rt,
      };
    })
    .filter((r): r is PlayerRow => r !== null)
    .sort((a, b) => b[sortKey] - a[sortKey])
    .slice(0, opts.limit);

  return rows;
}

export function getTopPlayers(orgId?: number) {
  return fetchComputedPlayers({ orgId, limit: 100 });
}

export function getTopProspects(orgId?: number) {
  return fetchComputedPlayers({ orgId, prospectsOnly: true, limit: 100 });
}

export interface RoleLevelBenchmarkCell {
  level: number;
  avgValue: number | null;
  n: number;
}
export interface RoleLevelBenchmarkRow {
  role: string;
  byLevel: RoleLevelBenchmarkCell[]; // always 8 entries, in canonical-level order (see display-helpers.ts's effectiveLevel/LEVEL_LABELS): MLB/AAA/AA/A+/A/A-/Rookie/International
}

// "overall" powers the original Role x Level table; "batting"/"fielding"
// (added 2026-08-24, Rees's spec) power two more built the exact same way,
// just averaging player_computed's batting/fielding column instead --
// requested alongside the catcher batting multiplier work, to see the
// batting/fielding pipelines on their own rather than only blended into
// Overall.
export type RoleLevelBenchmarkMetric = "overall" | "batting" | "fielding";

// Powers the Glossary page and the role-aware ETA model in
// scripts/compute-ratings.ts -- this is a read-only view of the exact same
// aggregation that script performs at refresh time, kept here so the page
// can show current numbers without needing a persisted table. Level 1 (MLB)
// is restricted to the real active roster (`is_active = true`) -- confirmed
// 2026-08-24 that `is_active` is a level-1-only concept in this data (every
// level 2-6 row has it false unconditionally), so this filter only ever
// affects the MLB row, never wipes out a minor-league level. Without it, the
// MLB row included ~1,400 non-active level-1 rows (DFA'd players, and
// international/complex signees mistagged at level 1) alongside the ~890
// real active-roster ones, which was dragging several roles' "MLB average"
// below their own AAA average.
export async function getRoleLevelBenchmarks(metric: RoleLevelBenchmarkMetric = "overall"): Promise<RoleLevelBenchmarkRow[]> {
  const refreshRunId = await latestRefreshRunId();

  const players = await fetchAll<{ id: number; level: number | null; is_active: boolean | null; league_id: number | null }>((from, to) =>
    supabase.from("players").select("id,level,is_active,league_id").not("level", "is", null).range(from, to) as never
  );
  const playerById = new Map(players.map((p) => [p.id, p]));

  // `value:${metric}` aliases whichever player_computed column we're
  // averaging (overall/batting/fielding) to a single consistent field name,
  // so the aggregation loop below doesn't need to know which metric it's
  // summing.
  const computed = await fetchAll<{ player_id: number; role: string | null; value: number }>((from, to) =>
    supabase.from("player_computed").select(`player_id,role,value:${metric}`).eq("refresh_run_id", refreshRunId).range(from, to) as never
  );

  const sums = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const c of computed) {
    if (!c.role) continue;
    const p = playerById.get(c.player_id);
    const level = effectiveLevel(p?.level ?? null, p?.league_id ?? null);
    if (level == null || level < 1 || level > 8) continue;
    if (level === 1 && p?.is_active !== true) continue; // real MLB row only -- international players already remapped to 7 above, so this can't accidentally exclude them
    if (!sums.has(c.role)) sums.set(c.role, new Map());
    const byLevel = sums.get(c.role)!;
    const cell = byLevel.get(level) ?? { sum: 0, n: 0 };
    cell.sum += c.value;
    cell.n += 1;
    byLevel.set(level, cell);
  }

  // ROLE_ORDER (module-level, below) matches ProspectTable.tsx's own order --
  // roughly pitchers first, then hitters by defensive spectrum.
  return ROLE_ORDER.filter((role) => sums.has(role)).map((role) => {
    const byLevel = sums.get(role)!;
    return {
      role,
      byLevel: CANONICAL_LEVELS.map((level) => {
        const cell = byLevel.get(level);
        return { level, avgValue: cell ? cell.sum / cell.n : null, n: cell?.n ?? 0 };
      }),
    };
  });
}

export interface ActiveWeightSet {
  id: number;
  label: string;
  contact: number; power: number; eye: number; gap: number; avoid_ks: number; speed: number;
  // Top-level Overall/Potential blend weights (2026-09-02) -- batting/
  // fielding/baserunning below are multiplied by these, not implicit 1s.
  batting: number; fielding: number; baserunning: number;
  // Retired flat pitching weights -- historical rows only, superseded by the
  // sp_/rp_ split below. Kept in the type for older weight-set rows.
  stuff: number; movement: number; control: number; stamina: number; pbabip: number;
  sp_stuff: number; sp_movement: number; sp_control: number; sp_stamina: number;
  rp_stuff: number; rp_movement: number; rp_control: number; rp_stamina: number;
  relief_value_multiplier: number;
  baserunning_speed_weight: number; baserunning_run_weight: number;
  baserunning_steal_weight: number; baserunning_stlrt_weight: number;
  qp_multiplier: number; qp_threshold: number; qpp_threshold: number;
  sp_rp_stamina_threshold: number; sp_rp_min_pitches: number;
  catcher_batting_multiplier: number; ss_batting_multiplier: number; cf_batting_multiplier: number;
  catcher_fielding_bonus: number; infield_fielding_bonus: number; outfield_fielding_bonus: number;
  contact_gate_mid_threshold: number; contact_gate_mid_multiplier: number;
  contact_gate_low_threshold: number; contact_gate_low_multiplier: number;
  control_gate_mid_threshold: number; control_gate_mid_multiplier: number;
  control_gate_low_threshold: number; control_gate_low_multiplier: number;
  developed_age_threshold: number;
  notes: string | null;
}

// Powers the Glossary page's Weights table -- always reads whatever weight
// set is currently active, so the page never drifts out of sync with what
// the rating engine is actually using.
export async function getActiveWeightSet(): Promise<ActiveWeightSet | null> {
  const { data, error } = await supabase.from("rating_weights").select("*").eq("is_active", true).maybeSingle();
  if (error) throw error;
  return data as ActiveWeightSet | null;
}

export interface CalibrationLevelAnchorRow {
  label: string; // AAA/AA/A+/A/A-/Rookie/International
  target: number; // 45/40/35/30/25/20/15
  hitterAvg: number | null;
  pitcherAvg: number | null;
}
export interface CalibrationAnchor {
  hitterMean: number | null; hitterSd: number | null;
  pitcherMean: number | null; pitcherSd: number | null;
  refreshRunId: number;
  levelAnchors: CalibrationLevelAnchorRow[];
}

// canonical level (2-8) -> [label, target] -- see display-helpers.ts's
// effectiveLevel/LEVEL_LABELS for the same canonical scale.
const LEVEL_ANCHOR_META: Record<number, { label: string; target: number }> = {
  2: { label: "AAA", target: 45 }, 3: { label: "AA", target: 40 }, 4: { label: "A+", target: 35 },
  5: { label: "A", target: 30 }, 6: { label: "A-", target: 25 }, 7: { label: "Rookie", target: 20 },
  8: { label: "International", target: 15 },
};

// Powers the Glossary page's calibration note (2026-09-03, reworked
// 2026-09-04 for the below-mean piecewise-linear level anchors) -- reads
// exactly what compute-ratings.ts wrote at compute time (refresh_runs'
// mean/SD, calibration_level_anchors' per-level averages). Recomputed fresh
// every refresh (never hand-tuned), so this always reflects what the live
// Overall/Potential/Prospect Potential numbers were actually calibrated
// against, not a stale snapshot.
export async function getCalibrationAnchor(): Promise<CalibrationAnchor> {
  const refreshRunId = await latestRefreshRunId();
  const { data, error } = await supabase
    .from("refresh_runs")
    .select("hitter_overall_mean, hitter_overall_sd, pitcher_overall_mean, pitcher_overall_sd")
    .eq("id", refreshRunId).maybeSingle();
  if (error) throw error;
  const row = data as { hitter_overall_mean: number | null; hitter_overall_sd: number | null; pitcher_overall_mean: number | null; pitcher_overall_sd: number | null } | null;

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("calibration_level_anchors")
    .select("player_type, level, avg_raw_overall")
    .eq("refresh_run_id", refreshRunId);
  if (anchorErr) throw anchorErr;
  const avgByTypeLevel = new Map<string, number>();
  (anchorRows as { player_type: string; level: number; avg_raw_overall: number }[] ?? []).forEach((r) => {
    avgByTypeLevel.set(`${r.player_type}|${r.level}`, r.avg_raw_overall);
  });
  const levelAnchors: CalibrationLevelAnchorRow[] = Object.entries(LEVEL_ANCHOR_META).map(([lvlStr, meta]) => ({
    label: meta.label, target: meta.target,
    hitterAvg: avgByTypeLevel.get(`H|${lvlStr}`) ?? null,
    pitcherAvg: avgByTypeLevel.get(`P|${lvlStr}`) ?? null,
  }));

  return {
    hitterMean: row?.hitter_overall_mean ?? null, hitterSd: row?.hitter_overall_sd ?? null,
    pitcherMean: row?.pitcher_overall_mean ?? null, pitcherSd: row?.pitcher_overall_sd ?? null,
    refreshRunId, levelAnchors,
  };
}

export interface HandednessSplitsDisplay {
  battingPctVsL: number;
  battingPctVsR: number;
  pitchingPctVsL: number;
  pitchingPctVsR: number;
  years: number[];
}

// Powers the Glossary page's handedness-split note (Rees 2026-08-24) -- a
// read-only re-run of the exact same aggregation compute-ratings.ts uses to
// weight Batting/Pitching by real MLB-only vs-L/vs-R AB and IP totals over
// the last 3 seasons, so the page shows the live percentages actually baked
// into the current player_computed rows rather than a hardcoded snapshot.
// split_id 2 = vs-LHP/vs-LHB, split_id 3 = vs-RHP/vs-RHB (reverse-engineered,
// not documented by StatsPlus -- see compute-ratings.ts for the same note).
export async function getHandednessSplits(): Promise<HandednessSplitsDisplay> {
  const refreshRunId = await latestRefreshRunId();

  const { data: yearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year")
    .eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const currentYear = (yearRow as { year: number } | null)?.year ?? new Date().getFullYear();
  const last3Years = [currentYear - 2, currentYear - 1, currentYear];

  const mlbPlayers = await fetchAll<{ id: number }>((from, to) =>
    supabase.from("players").select("id").eq("level", 1).order("id").range(from, to) as never
  );
  const mlbPlayerIds = mlbPlayers.map((p) => p.id);

  // Paginates INSIDE each 500-player chunk too, not just across chunks --
  // a single unpaginated .select() silently caps at Supabase's default 1000
  // rows, and a 500-player chunk over 3 years x 2 splits can exceed that.
  // Confirmed 2026-08-24 (matches compute-ratings.ts's identical fix, see
  // HANDOFF.md gotcha 2/21): without this, two of five real chunks here
  // land on an exact, truncated 1000 rows, undercounting real playing time
  // and skewing the split shown on this page away from what
  // compute-ratings.ts actually used.
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

  const battingTotals = await sumBySplit("player_batting_stats_snapshots", "ab");
  const pitchingTotals = await sumBySplit("player_pitching_stats_snapshots", "ip");
  const battingTotal = battingTotals.vsL + battingTotals.vsR;
  const pitchingTotal = pitchingTotals.vsL + pitchingTotals.vsR;

  return {
    battingPctVsL: battingTotal > 0 ? battingTotals.vsL / battingTotal : 0.5,
    battingPctVsR: battingTotal > 0 ? battingTotals.vsR / battingTotal : 0.5,
    pitchingPctVsL: pitchingTotal > 0 ? pitchingTotals.vsL / pitchingTotal : 0.5,
    pitchingPctVsR: pitchingTotal > 0 ? pitchingTotals.vsR / pitchingTotal : 0.5,
    years: last3Years,
  };
}

export interface RoleRepresentationRow {
  role: string;
  topCount: number;
  topPct: number; // this role's share of the top-N list
  baselineCount: number;
  baselinePct: number; // this role's share of the full reference population
  index: number; // topPct ÷ baselinePct × 100 -- 100 = proportional, >100 = overrepresented in the top N, <100 = underrepresented
}

const ROLE_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "COF", "CF", "DH"];

// Weight-testing diagnostic (Rees 2026-08-24): are any roles being over- or
// under-valued by the current Overall/Potential weights? Raw top-100 counts
// alone don't answer that -- a role that's just naturally common in the
// league would dominate a top-100 list even with perfectly fair weights.
// So each table compares a role's share of the top 100 against that SAME
// role's share of the full reference population it's drawn from (every
// ranked player for the Overall list; the prospect pool for the Prospect
// Potential list, since prospect_rank is only ever assigned within that
// pool) -- the index column is the real signal: 100 means proportional
// representation, meaningfully above/below 100 means the weights are
// pulling that role up or down relative to how common it actually is.
export async function getRoleRepresentation(limit = 100): Promise<{
  byOverall: RoleRepresentationRow[];
  byProspectPotential: RoleRepresentationRow[];
}> {
  const refreshRunId = await latestRefreshRunId();

  const rows = await fetchAll<{ role: string | null; rank: number | null; prospect_rank: number | null }>((from, to) =>
    supabase.from("player_computed").select("role,rank,prospect_rank").eq("refresh_run_id", refreshRunId).range(from, to) as never
  );

  function buildRepresentation(
    inTop: (r: { rank: number | null; prospect_rank: number | null }) => boolean,
    inBaseline: (r: { rank: number | null; prospect_rank: number | null }) => boolean
  ): RoleRepresentationRow[] {
    const topCounts = new Map<string, number>();
    const baselineCounts = new Map<string, number>();
    let topTotal = 0;
    let baselineTotal = 0;
    for (const r of rows) {
      if (!r.role) continue;
      if (inBaseline(r)) {
        baselineCounts.set(r.role, (baselineCounts.get(r.role) ?? 0) + 1);
        baselineTotal++;
      }
      if (inTop(r)) {
        topCounts.set(r.role, (topCounts.get(r.role) ?? 0) + 1);
        topTotal++;
      }
    }
    const roles = new Set([...topCounts.keys(), ...baselineCounts.keys()]);
    return ROLE_ORDER.filter((role) => roles.has(role)).map((role) => {
      const topCount = topCounts.get(role) ?? 0;
      const baselineCount = baselineCounts.get(role) ?? 0;
      const topPct = topTotal > 0 ? (topCount / topTotal) * 100 : 0;
      const baselinePct = baselineTotal > 0 ? (baselineCount / baselineTotal) * 100 : 0;
      return {
        role, topCount, topPct, baselineCount, baselinePct,
        index: baselinePct > 0 ? (topPct / baselinePct) * 100 : 0,
      };
    });
  }

  return {
    byOverall: buildRepresentation((r) => r.rank !== null && r.rank <= limit, (r) => r.rank !== null),
    byProspectPotential: buildRepresentation((r) => r.prospect_rank !== null && r.prospect_rank <= limit, (r) => r.prospect_rank !== null),
  };
}

// roundGrade/levelLabel/teamLogoUrl moved to lib/display-helpers.ts
// (2026-08-20) -- that module has no Supabase import, so a "use client"
// component can safely import them as values. Imported above for use within
// this file, and re-exported here so every existing server-side
// `from "./queries"` import keeps working unchanged. Don't move these back.
export { roundGrade, levelLabel, teamLogoUrl };

// Fixed approximation, not derived from this league's real run environment.
// A proper FIP constant needs league-average-by-level-and-year normalization
// -- the same not-yet-built work already blocking OPS+/FIP- elsewhere (see
// HANDOFF.md). 3.10 is a standard real-baseball-ish placeholder so FIP can
// display now; swap in the real per-year/level constant once that
// normalization work happens.
const FIP_CONSTANT = 3.10;

// Full-season totals, summed across EVERY level a player played at this
// season (reversed 2026-08-30 back from a 2026-08-19 "current level only"
// decision -- see the comment above where this is computed). If a player
// has no stat row anywhere this season yet (just signed, or a pitcher/DH
// with no fielding inning logged), the relevant fields are null.
export interface SeasonTotals {
  war: number | null;
  // batters
  ab: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  hr: number | null;
  sb: number | null;
  zr: number | null; // Zone Rating, straight from player_fielding_stats_snapshots
  // pitchers
  ip: number | null;
  era: number | null;
  fip: number | null;
  k9: number | null;
  // Every level the player accrued these stats at this season, best level
  // first (e.g. ["AAA", "AA"]) -- empty if no stats at all. Length > 1 is
  // what triggers the "... across AA & AAA" suffix on the card's stat line.
  levels: string[];
}

// Change-since-a-baseline-snapshot support. Composite grades + ranks only
// (2026-08-19 decision) -- no raw tool-grade or stat deltas for now. Grade
// deltas are computed on ROUNDED values (round each side to nearest 5, then
// diff) so the delta a reader sees always matches what they could re-derive
// from the two rounded numbers on screen -- diffing full-precision values
// and rounding the diff separately can show a delta that doesn't match the
// visible before/after (e.g. a "+5" next to two numbers that look identical
// once rounded). Ranks are already integers, diffed as-is; lower is better,
// so sign convention is inverted from grades in the UI layer.
export interface ProspectDelta {
  overall: number | null;
  potential: number | null;
  prospectPotential: number | null;
  prospectRank: number | null;
  prospectOrgRank: number | null;
  prospectRoleRank: number | null; // 2026-08-27
  isNew: boolean; // true if the player has no row in the baseline snapshot
}

export interface ProspectSnapshotOption {
  refreshRunId: number;
  gameDate: string | null;
  startedAt: string;
}

// PERFORMANCE FIX (2026-08-25): used to fetch refresh_run_id from EVERY row
// of player_computed (one row per player PER historical refresh run --
// with ~45,757 players and a growing number of past refreshes, this could
// be hundreds of thousands of rows) just to dedupe down to a handful of
// distinct ids. Same shape of bug as getOrgTeams/fetchComputedPlayers
// above, and confirmed live 2026-08-25 to be the dominant remaining cost
// once those two were fixed (this function runs in parallel with
// getTopProspectsDetailed in FarmSystemReportBody's Promise.all, so it
// alone was setting the page's load time once the others got fast).
// Fixed by querying the small refresh_runs table FIRST (one row per
// actual refresh EVENT, not per player) with a reasonable recency cap,
// then confirming each candidate actually has a player_computed snapshot
// via small parallel existence checks -- same pattern as getOrgTeams.
export async function getProspectSnapshotOptions(): Promise<ProspectSnapshotOption[]> {
  // Runs from before game-date tracking existed (runs 4/8) have no in-game
  // date -- excluded from the picker entirely (2026-08-20 decision) rather
  // than shown with a "no game date recorded" fallback label, since a
  // "change from" comparison with no real date attached isn't meaningful
  // for this report. Capped at the 30 most recent -- nobody realistically
  // wants to compare against something from dozens of refreshes ago, and
  // this list is expected to keep growing indefinitely otherwise.
  //
  // status="succeeded" added 2026-08-29 -- belt-and-suspenders against a run
  // that failed outright showing up here (a failed run can still write some
  // player_computed rows before whatever step broke it, since refresh.ts
  // writes incrementally, not in one atomic transaction, so the hasSnapshot
  // check below alone can't be trusted to keep every failed run out).
  //
  // Investigated 2026-08-29 after Rees spotted two options for the same game
  // date (10/8/2031): NOT actually a failed run in this case -- both refresh_
  // runs 13 and 14 came back status="succeeded" with identical player_
  // computed counts (13870 each), started 9 minutes apart. That's the
  // automated pipeline firing twice for a game date that hadn't actually
  // advanced in-game -- a duplicate/redundant run, not a broken one. That
  // fix deduped on exact game_date; superseded 2026-08-30 by deduping on
  // calendar MONTH instead (see below) at Rees's request -- a season sims
  // through many distinct dates per month, and one-per-exact-date was still
  // showing a long list of options nobody needed to choose between.
  const { data: runsData, error: runsErr } = await supabase
    .from("refresh_runs")
    .select("id,game_date,started_at")
    .eq("status", "succeeded")
    .not("game_date", "is", null)
    .order("id", { ascending: false })
    .limit(30);
  if (runsErr) throw runsErr;
  const candidates = runsData as { id: number; game_date: string; started_at: string }[];
  if (candidates.length === 0) return [];

  const hasSnapshot = await Promise.all(
    candidates.map(async (r) => {
      const { data, error } = await supabase.from("player_computed").select("player_id").eq("refresh_run_id", r.id).limit(1);
      if (error) throw error;
      return { id: r.id, has: (data?.length ?? 0) > 0 };
    })
  );
  const validIds = new Set(hasSnapshot.filter((r) => r.has).map((r) => r.id));

  // One option per CALENDAR MONTH now (2026-08-30, Rees's ask), not one per
  // exact game_date -- a season can sim through a dozen distinct game
  // dates in a single month, and nobody needs to pick between all of them
  // for a "change from" baseline. Sorted by game_date itself (not just by
  // id, which the exact-date version above relied on) so "the latest game
  // date in that month" is exactly what gets kept, independent of whether
  // id order and date order ever drift apart.
  const seenMonths = new Set<string>();
  return candidates
    .filter((r) => validIds.has(r.id))
    .sort((a, b) => (a.game_date < b.game_date ? 1 : a.game_date > b.game_date ? -1 : 0))
    .filter((r) => {
      const month = r.game_date.slice(0, 7); // "YYYY-MM"
      if (seenMonths.has(month)) return false;
      seenMonths.add(month);
      return true;
    })
    .map((r) => ({ refreshRunId: r.id, gameDate: r.game_date, startedAt: r.started_at }));
}

export interface ProspectRow extends PlayerRow {
  level: number | null;
  eta: number | null;
  seasonYear: number | null;
  seasonTotals: SeasonTotals;
  ph: "H" | "P" | null;
  orgName: string | null;
  orgNickname: string | null;
  orgAbbr: string | null; // the parent org's abbreviation, not the player's current affiliate's
  teamAbbr: string | null;
  delta?: ProspectDelta; // present only when a baselineRefreshRunId was requested
  bio: string | null; // hand/AI-written blurb from prospect_bios, per prospect-bio-style-guide.md -- null for anyone not yet covered
  bioStale: boolean; // true if the stored bio was generated against an older refresh_run_id than "current"
  bioDate: string | null; // the league's in-game date (refresh_runs.game_date) for the refresh run this bio's data came from, shown next to the stale flag ("stale since mm/dd/yy") -- NOT when the bio text was typed
  isRecentDraftPick: boolean; // true if draft_year matches the most recent draft year actually present in this prospect pool (fixed 2026-08-28 -- NOT the most recently imported draft-pool class, see getTopProspectsDetailed)
}

// Was 500 (expanded from 100 on 2026-08-20), shortened back down to 200
// on 2026-08-27 (Rees's call). Ranks beyond 200 are still real,
// already-computed data in the rating engine either way -- this only
// controls how many cards the page renders/fetches, not what's computed.
// Bio coverage (prospect_bios) is still just the original top-100 batch,
// see the note below -- unaffected by this number either way. Exported
// (not just a local const) so FarmSystemReportBody's page-header subtitle
// can read the real number instead of a hardcoded string that silently
// went stale the last time this changed (found showing "top 500" live in
// production after this had already been 200 for a while).
export const TOP_PROSPECTS_LIMIT = 200;

export async function getTopProspectsDetailed(orgId?: number, baselineRefreshRunId?: number): Promise<ProspectRow[]> {
  const base = await fetchComputedPlayers({ orgId, prospectsOnly: true, limit: TOP_PROSPECTS_LIMIT });
  if (base.length === 0) return [];
  const ids = base.map((r) => r.player_id);
  // "Most recent draft class" for the highlight, fixed 2026-08-28: this used
  // to be latestDraftClassImportId() -- the newest *imported draft pool*,
  // e.g. 2032 once that pool was loaded. That's right for getTopDraftees
  // (the /draft page genuinely wants "the newest pool we loaded," pre-draft
  // amateurs and all), but wrong here: importing a future draft pool doesn't
  // mean any real prospect has actually been drafted with that year yet, so
  // the highlight silently stopped matching anyone the moment 2032 was
  // imported (no real player has draft_year=2032 -- that only gets set once
  // StatsPlus reflects the real in-game draft). Now derived from the actual
  // prospect pool being shown instead of the draft-pool-import table.
  const latestDraftYear = base.reduce<number | null>((max, r) => (r.draft_year !== null && (max === null || r.draft_year > max) ? r.draft_year : max), null);
  const refreshRunId = await latestRefreshRunId();

  // Hand/AI-written blurbs, per prospect-bio-style-guide.md -- occasional
  // batch writing pass, not recomputed live. Only covers the original top
  // 100 as of 2026-08-20 (the list itself now goes to 500) -- deliberately
  // NO fallback text for anyone without a row here (removed earlier this
  // session, reconfirmed when the list was expanded to 500): the detail row
  // just shows the stat line with no bio until that player's bio is
  // actually written.
  const bioById = new Map<number, { bio_text: string; refresh_run_id: number }>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await supabase.from("prospect_bios")
      .select("player_id,bio_text,refresh_run_id").in("player_id", chunk);
    if (error) throw error;
    (data as never as { player_id: number; bio_text: string; refresh_run_id: number }[])
      .forEach((b) => bioById.set(b.player_id, b));
  }

  // "Stale since" wants the league's IN-GAME date the bio's data came from,
  // not the real-world timestamp the bio text was typed (2026-08-24, Rees's
  // correction) -- so look up game_date on the specific refresh_run_id each
  // bio was written against, not "now."
  const bioRunIds = [...new Set([...bioById.values()].map((b) => b.refresh_run_id))];
  const bioRunGameDateById = new Map<number, string | null>();
  if (bioRunIds.length > 0) {
    const { data, error } = await supabase.from("refresh_runs").select("id,game_date").in("id", bioRunIds);
    if (error) throw error;
    (data as { id: number; game_date: string | null }[]).forEach((r) => bioRunGameDateById.set(r.id, r.game_date));
  }

  // Only for players currently on the list -- a player who fell off the top
  // 100 since the baseline doesn't need a delta, they're just not shown.
  const baselineById = new Map<number, { overall: number; potential: number; prospect_potential: number; prospect_rank: number | null; prospect_org_rank: number | null; prospect_role_rank: number | null }>();
  if (baselineRefreshRunId !== undefined) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data, error } = await supabase.from("player_computed")
        .select("player_id,overall,potential,prospect_potential,prospect_rank,prospect_org_rank,prospect_role_rank")
        .eq("refresh_run_id", baselineRefreshRunId).in("player_id", chunk);
      if (error) throw error;
      (data as never as { player_id: number; overall: number; potential: number; prospect_potential: number; prospect_rank: number | null; prospect_org_rank: number | null; prospect_role_rank: number | null }[])
        .forEach((b) => baselineById.set(b.player_id, b));
    }
  }

  const playersExtra = await fetchAll<{ id: number; level: number | null; league_id: number | null; team_id: number | null; organization_id: number | null }>((from, to) =>
    supabase.from("players").select("id,level,league_id,team_id,organization_id").in("id", ids).range(from, to) as never
  );
  // effectiveLevel, not raw p.level -- players.level=4 alone can't tell a
  // real A+ affiliate from a real A affiliate (see display-helpers.ts's
  // effectiveLevel for the full finding); both would otherwise show "A+".
  const levelById = new Map(playersExtra.map((p) => [p.id, effectiveLevel(p.level, p.league_id)]));
  const teamIdById = new Map(playersExtra.map((p) => [p.id, p.team_id]));
  const orgIdById = new Map(playersExtra.map((p) => [p.id, p.organization_id]));

  const orgTeamIds = [...new Set(playersExtra.map((p) => p.organization_id).filter((x): x is number => x !== null))];
  const orgTeams = orgTeamIds.length
    ? await fetchAll<{ id: number; name: string; nickname: string }>((from, to) =>
        supabase.from("teams").select("id,name,nickname").in("id", orgTeamIds).range(from, to) as never
      )
    : [];
  const orgTeamById = new Map(orgTeams.map((t) => [t.id, t]));

  // team_id -> abbreviation. teams itself has no abbr column; team_batting_stats_snapshots
  // does (StatsPlus's own "OKC"/"NY"-style codes), so borrow it from there.
  // A team's abbreviation can change over time (relocation/rebrand -- e.g.
  // team_id 15 was "KIN" (Kingston) through 2011, "OKC" (Oklahoma City) from
  // 2012 on, same team_id throughout), and since the 2001-2031 backfill this
  // table has one row per team per YEAR. Without an explicit order, "first
  // row seen per team_id wins" was picking an arbitrary year's abbreviation
  // -- confirmed 2026-08-20, this was surfacing Kingston's old "KIN" for
  // Oklahoma City. Same root-cause class as gotcha 13 (unordered pagination
  // has no stability guarantee) -- order by year descending so the most
  // recent (current) abbreviation is always the one that wins the dedup.
  const abbrRows = await fetchAll<{ team_id: number; abbr: string }>((from, to) =>
    supabase.from("team_batting_stats_snapshots").select("team_id,abbr").eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).range(from, to) as never
  );
  const abbrByTeamId = new Map<number, string>();
  abbrRows.forEach((r) => { if (!abbrByTeamId.has(r.team_id)) abbrByTeamId.set(r.team_id, r.abbr); });

  const computedExtra = await fetchAll<{ player_id: number; eta: number | null; ph: "H" | "P" }>((from, to) =>
    supabase.from("player_computed").select("player_id,eta,ph").eq("refresh_run_id", refreshRunId).in("player_id", ids).range(from, to) as never
  );
  const etaById = new Map(computedExtra.map((c) => [c.player_id, c.eta]));
  const phById = new Map(computedExtra.map((c) => [c.player_id, c.ph]));

  // Most recent season we have any stats for.
  const { data: yearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year").eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const seasonYear = (yearRow as { year: number } | null)?.year ?? null;

  // A player can have one row PER LEVEL they played at this season
  // (promotions/demotions mid-year each get their own stint row) — collect
  // all of them per player_id (split_id=1, overall not vL/vR). Reversed
  // 2026-08-30 (Rees's call) back to summing across every level played this
  // season, not just the current one: a mid-season promotion was silently
  // truncating a real full-season workload down to whatever the new level
  // alone showed (caught while writing an expanded bio for a pitcher who
  // legitimately threw 150+ innings combined across AA and AAA this year,
  // but whose card read as a 43-inning season). The stat line now reads
  // "... across AA & AAA" when more than one level contributed -- see
  // seasonLevels below and ProspectTable.tsx's statLine().
  const battingByPlayer = new Map<number, { level_id: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; hp: number; sf: number; sb: number; war: number | null }[]>();
  const pitchingByPlayer = new Map<number, { level_id: number; ip: number; er: number; k: number; bb: number; hp: number; hra: number; war: number | null }[]>();
  const fieldingByPlayer = new Map<number, { level_id: number; zr: number | null }[]>();
  if (seasonYear !== null) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: bat } = await supabase.from("player_batting_stats_snapshots")
        .select("player_id,level_id,ab,h,d,t,hr,bb,hp,sf,sb,war")
        .eq("refresh_run_id", refreshRunId).eq("year", seasonYear).eq("split_id", 1).in("player_id", chunk);
      (bat as never as ({ player_id: number } & { level_id: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; hp: number; sf: number; sb: number; war: number | null })[] | null)
        ?.forEach((r) => { const arr = battingByPlayer.get(r.player_id) ?? []; arr.push(r); battingByPlayer.set(r.player_id, arr); });

      const { data: pit } = await supabase.from("player_pitching_stats_snapshots")
        .select("player_id,level_id,ip,er,k,bb,hp,hra,war")
        .eq("refresh_run_id", refreshRunId).eq("year", seasonYear).eq("split_id", 1).in("player_id", chunk);
      (pit as never as ({ player_id: number } & { level_id: number; ip: number; er: number; k: number; bb: number; hp: number; hra: number; war: number | null })[] | null)
        ?.forEach((r) => { const arr = pitchingByPlayer.get(r.player_id) ?? []; arr.push(r); pitchingByPlayer.set(r.player_id, arr); });

      // Fielding wasn't fetched here before 2026-08-19 -- added specifically
      // for ZR (Zone Rating), which is a genuine raw field, not derived.
      // NOTE: fielding snapshots use split_id=0 for "overall" -- confirmed
      // 100% of rows (65,535/65,535) are split_id=0. This is DIFFERENT from
      // batting/pitching, which use split_id=1 for overall (1=overall,
      // 2/3=vL/vR there). Using split_id=1 here silently matched zero rows
      // and always showed ZR as blank -- caught by checking a known player
      // directly against the raw table before shipping.
      const { data: field } = await supabase.from("player_fielding_stats_snapshots")
        .select("player_id,level_id,zr")
        .eq("refresh_run_id", refreshRunId).eq("year", seasonYear).eq("split_id", 0).in("player_id", chunk);
      (field as never as ({ player_id: number } & { level_id: number; zr: number | null })[] | null)
        ?.forEach((r) => { const arr = fieldingByPlayer.get(r.player_id) ?? []; arr.push(r); fieldingByPlayer.set(r.player_id, arr); });
    }
  }

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  return base.map((r) => {
    const ph = phById.get(r.player_id) ?? null;

    // A player can have more than one stint at the SAME level in a season
    // (optioned down and recalled, etc.) -- each stint is its own row, and
    // (as of 2026-08-30) a player can also have stints at MULTIPLE DIFFERENT
    // levels in one season (a mid-season promotion). Sum every stint the
    // player has this season, any level, rather than just the current one
    // -- see the field-declaration comment above for why. ZR is a rate
    // stat, not a counting stat, so it's averaged across stints, not summed.
    const batStints = battingByPlayer.get(r.player_id) ?? [];
    const pitStints = pitchingByPlayer.get(r.player_id) ?? [];
    const fieldStints = fieldingByPlayer.get(r.player_id) ?? [];
    // Distinct levels these stints span, best level first (ascending level
    // number -- 1=MLB is the best rung, matching every other level-sort in
    // this codebase). Whichever of bat/pit actually has rows is the
    // relevant one for a given player; a hitter's fieldStints don't get
    // their own separate level list, they're assumed to match batStints'.
    const relevantStints = phById.get(r.player_id) === "P" ? pitStints : batStints;
    const seasonLevels = [...new Set(relevantStints.map((x) => x.level_id))]
      .sort((a, b) => a - b)
      .map((lvl) => levelLabel(lvl));

    const bat = batStints.length > 0 ? {
      ab: sum(batStints.map((x) => x.ab)), h: sum(batStints.map((x) => x.h)), d: sum(batStints.map((x) => x.d)),
      t: sum(batStints.map((x) => x.t)), hr: sum(batStints.map((x) => x.hr)), bb: sum(batStints.map((x) => x.bb)),
      hp: sum(batStints.map((x) => x.hp)), sf: sum(batStints.map((x) => x.sf)), sb: sum(batStints.map((x) => x.sb)),
      war: batStints.some((x) => x.war !== null) ? sum(batStints.map((x) => x.war ?? 0)) : null,
    } : undefined;
    const pit = pitStints.length > 0 ? {
      ip: sum(pitStints.map((x) => x.ip)), er: sum(pitStints.map((x) => x.er)), k: sum(pitStints.map((x) => x.k)),
      bb: sum(pitStints.map((x) => x.bb)), hp: sum(pitStints.map((x) => x.hp)), hra: sum(pitStints.map((x) => x.hra)),
      war: pitStints.some((x) => x.war !== null) ? sum(pitStints.map((x) => x.war ?? 0)) : null,
    } : undefined;
    const fieldZrs = fieldStints.map((x) => x.zr).filter((z): z is number => z !== null);
    const field = fieldZrs.length > 0 ? { zr: sum(fieldZrs) / fieldZrs.length } : undefined;

    let seasonTotals: SeasonTotals = {
      war: null, ab: null, avg: null, obp: null, slg: null, hr: null, sb: null, zr: null,
      ip: null, era: null, fip: null, k9: null, levels: seasonLevels,
    };
    if (ph === "H" && bat) {
      const obpDenom = bat.ab + bat.bb + bat.hp + bat.sf;
      const totalBases = bat.h + bat.d + 2 * bat.t + 3 * bat.hr; // singles=h-d-t-hr, so TB = h+d+2t+3hr
      seasonTotals = {
        ...seasonTotals,
        war: bat.war,
        ab: bat.ab,
        avg: bat.ab > 0 ? bat.h / bat.ab : null,
        obp: obpDenom > 0 ? (bat.h + bat.bb + bat.hp) / obpDenom : null,
        slg: bat.ab > 0 ? totalBases / bat.ab : null,
        hr: bat.hr,
        sb: bat.sb,
        zr: field?.zr ?? null,
      };
    } else if (ph === "P" && pit) {
      seasonTotals = {
        ...seasonTotals,
        war: pit.war,
        ip: pit.ip,
        era: pit.ip > 0 ? (pit.er * 9) / pit.ip : null,
        fip: pit.ip > 0 ? (13 * pit.hra + 3 * (pit.bb + pit.hp) - 2 * pit.k) / pit.ip + FIP_CONSTANT : null,
        k9: pit.ip > 0 ? (pit.k * 9) / pit.ip : null,
      };
    }

    const orgId2 = orgIdById.get(r.player_id) ?? null;
    const orgTeam = orgId2 !== null ? orgTeamById.get(orgId2) : undefined;
    const teamId = teamIdById.get(r.player_id) ?? null;

    let delta: ProspectDelta | undefined;
    if (baselineRefreshRunId !== undefined) {
      const b = baselineById.get(r.player_id);
      if (!b) {
        delta = { overall: null, potential: null, prospectPotential: null, prospectRank: null, prospectOrgRank: null, prospectRoleRank: null, isNew: true };
      } else {
        // Round each side to nearest 5 before diffing (see comment above
        // ProspectDelta) so the delta always matches the two visible numbers.
        delta = {
          overall: (roundGrade(r.overall) ?? 0) - (roundGrade(b.overall) ?? 0),
          potential: (roundGrade(r.potential) ?? 0) - (roundGrade(b.potential) ?? 0),
          prospectPotential: (roundGrade(r.prospect_potential) ?? 0) - (roundGrade(b.prospect_potential) ?? 0),
          prospectRank: r.prospect_rank !== null && b.prospect_rank !== null ? r.prospect_rank - b.prospect_rank : null,
          prospectOrgRank: r.prospect_org_rank !== null && b.prospect_org_rank !== null ? r.prospect_org_rank - b.prospect_org_rank : null,
          prospectRoleRank: r.prospect_role_rank !== null && b.prospect_role_rank !== null ? r.prospect_role_rank - b.prospect_role_rank : null,
          isNew: false,
        };
      }
    }

    return {
      ...r,
      level: levelById.get(r.player_id) ?? null,
      eta: etaById.get(r.player_id) ?? null,
      seasonYear,
      ph,
      seasonTotals,
      orgName: orgTeam?.name ?? null,
      orgNickname: orgTeam?.nickname ?? null,
      orgAbbr: orgId2 !== null ? (abbrByTeamId.get(orgId2) ?? null) : null,
      teamAbbr: teamId !== null ? (abbrByTeamId.get(teamId) ?? null) : null,
      delta,
      bio: bioById.get(r.player_id)?.bio_text ?? null,
      bioStale: (bioById.get(r.player_id)?.refresh_run_id ?? refreshRunId) < refreshRunId,
      bioDate: (() => {
        const runId = bioById.get(r.player_id)?.refresh_run_id;
        return runId !== undefined ? (bioRunGameDateById.get(runId) ?? null) : null;
      })(),
      isRecentDraftPick: r.draft_year !== null && latestDraftYear !== null && r.draft_year === latestDraftYear,
    };
  });
}

export async function getTopDraftees(): Promise<{ draftYear: number | null; rows: PlayerRow[] }> {
  const latest = await latestDraftClassImportId();
  if (!latest) return { draftYear: null, rows: [] };

  const members = await fetchAll<{ player_id: number }>((from, to) =>
    supabase.from("draft_class_pool_members").select("player_id").eq("draft_class_import_id", latest.id).range(from, to) as never
  );
  const ids = members.map((m) => m.player_id);
  if (ids.length === 0) return { draftYear: latest.draft_year, rows: [] };

  const rows = await fetchComputedPlayers({ playerIds: ids, limit: 100 });
  return { draftYear: latest.draft_year, rows };
}
