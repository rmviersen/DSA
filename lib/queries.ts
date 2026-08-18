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

export async function getOrgTeams() {
  // "MLB parent org" = has parent_team_id null AND actually has players
  // attributed to it as an organization — filters out placeholder/conference
  // rows (e.g. "ODC Fire Conference") that also have a null parent.
  const orgIdsWithPlayers = await fetchAll<{ organization_id: number }>((from, to) =>
    supabase.from("players").select("organization_id").not("organization_id", "is", null).range(from, to) as never
  );
  const validIds = new Set(orgIdsWithPlayers.map((p) => p.organization_id));

  const { data, error } = await supabase.from("teams").select("id,name,nickname").is("parent_team_id", null).order("name");
  if (error) throw error;
  return (data as { id: number; name: string; nickname: string }[]).filter((t) => validIds.has(t.id));
}

async function latestRefreshRunId(): Promise<number> {
  const { data, error } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`No player_computed data found: ${error?.message}`);
  return (data as { refresh_run_id: number }).refresh_run_id;
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
  age: number | null;
  overall: number;
  potential: number;
  prospect_potential: number;
  prospect_rank: number | null;
  org_rank: number | null;
}

async function fetchComputedPlayers(opts: { orgId?: number; prospectsOnly?: boolean; playerIds?: number[]; limit: number }) {
  const refreshRunId = await latestRefreshRunId();

  const players = await fetchAll<{ id: number; first_name: string; last_name: string; age: number | null; organization_id: number | null; team_id: number | null }>(
    (from, to) => {
      let q = supabase.from("players").select("id,first_name,last_name,age,organization_id,team_id").range(from, to);
      if (opts.orgId) q = q.eq("organization_id", opts.orgId);
      if (opts.playerIds) q = q.in("id", opts.playerIds);
      return q as never;
    }
  );
  const playerById = new Map(players.map((p) => [p.id, p]));
  const relevantIds = players.map((p) => p.id);
  if (relevantIds.length === 0) return [];

  const teams = await fetchAll<{ id: number; name: string; nickname: string }>((from, to) =>
    supabase.from("teams").select("id,name,nickname").range(from, to) as never
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const computed: { player_id: number; overall: number; potential: number; prospect_potential: number; prospect_rank: number | null; org_rank: number | null }[] = [];
  for (let i = 0; i < relevantIds.length; i += 500) {
    const chunk = relevantIds.slice(i, i + 500);
    let q = supabase.from("player_computed")
      .select("player_id,overall,potential,prospect_potential,prospect_rank,org_rank")
      .eq("refresh_run_id", refreshRunId).in("player_id", chunk);
    if (opts.prospectsOnly) q = q.not("prospect_rank", "is", null);
    const { data, error } = await q;
    if (error) throw error;
    computed.push(...(data as never[]));
  }

  const ratingsById = new Map<number, RatingsSlice>();
  for (let i = 0; i < relevantIds.length; i += 500) {
    const chunk = relevantIds.slice(i, i + 500);
    const { data, error } = await supabase.from("player_ratings_snapshots")
      .select("player_id,cntct,pow,eye,speed,stf,mov,ctrl,stm,pos")
      .eq("refresh_run_id", refreshRunId).in("player_id", chunk);
    if (error) throw error;
    (data as never as ({ player_id: number } & RatingsSlice)[]).forEach((r) => ratingsById.set(r.player_id, r));
  }

  const sortKey = opts.prospectsOnly ? "prospect_potential" : "overall";
  const rows: PlayerRow[] = computed
    .map((c) => {
      const p = playerById.get(c.player_id);
      const rt = ratingsById.get(c.player_id);
      const team = p?.team_id ? teamById.get(p.team_id) : undefined;
      if (!p || !rt) return null;
      return {
        player_id: c.player_id,
        first_name: p.first_name, last_name: p.last_name, age: p.age,
        team_name: team?.name ?? null, team_nickname: team?.nickname ?? null,
        overall: c.overall, potential: c.potential, prospect_potential: c.prospect_potential,
        prospect_rank: c.prospect_rank, org_rank: c.org_rank,
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

// Public-facing display rule (2026-08-18): never show Overall/Potential/
// Prospect Potential at full precision anywhere a reader outside this org
// could see it (Slack reports, eventually the public site) — that precision
// is effectively the scout ratings underneath, which we don't want other
// GMs reverse-engineering. The underlying grades (Cntct/Pow/Stf/etc.) stay
// visible for now but are planned for removal later; this only covers the
// three composite grades. Internal/db values stay full-precision — this is
// a display-time rounding, not a change to what's computed or stored, so
// ranking still uses the precise numbers underneath.
export function roundGrade(n: number | null): number | null {
  return n === null || n === undefined ? null : Math.round(n / 5) * 5;
}

// Confirmed 2026-08-18 by cross-referencing team pages' displayed level labels
// (e.g. "BELLEVILLE BULLS (AAA)", "COBOURG COUGARS (U28, AA)") against the
// players.level codes on their rosters.
const LEVEL_LABELS: Record<number, string> = {
  0: "—", 1: "MLB", 2: "AAA", 3: "AA", 4: "A+", 5: "A-", 6: "Rookie",
};
export function levelLabel(level: number | null): string {
  return level === null ? "—" : (LEVEL_LABELS[level] ?? `Lvl ${level}`);
}

// StatsPlus serves team logos at a predictable slug of "{name}_{nickname}",
// lowercased with non-alphanumerics collapsed to underscores. Not verified
// for every team (only spot-checked a handful) — a mismatched slug just
// means a broken image, not a crash, so left as a best-effort helper rather
// than something scraped for all ~240 teams up front.
export function teamLogoUrl(name: string | null, nickname: string | null): string | null {
  if (!name || !nickname) return null;
  const slug = `${name}_${nickname}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `https://atl-02.statsplus.net/thebigleague/reports/news/html/images/team_logos/${slug}.png`;
}

export interface SeasonStint {
  level: number | null;
  ab: number | null; h: number | null; hr: number | null; rbi: number | null; bb: number | null; k: number | null;
  ip: number | null; er: number | null; w: number | null; l: number | null; pk: number | null; pbb: number | null;
}

// Season totals across every level a player played at, for the headline
// advanced-stat columns. NOTE: OPS+ and FIP- are NOT included here — both
// need league-average-by-level-and-year normalization that hasn't been
// built yet (same gap noted in HANDOFF.md for team power rankings). What's
// here (WAR, K%, HR/ERA) is everything currently derivable directly from
// the raw StatsPlus counting stats.
export interface SeasonTotals {
  war: number | null;
  hr: number | null;      // batters
  k_pct: number | null;   // k / pa (batters) or k / bf (pitchers)
  era: number | null;     // pitchers only
}

export interface ProspectRow extends PlayerRow {
  level: number | null;
  eta: number | null;
  seasonYear: number | null;
  seasonStints: SeasonStint[];
  seasonTotals: SeasonTotals;
  ph: "H" | "P" | null;
  orgName: string | null;
  orgNickname: string | null;
  teamAbbr: string | null;
}

export async function getTopProspectsDetailed(orgId?: number): Promise<ProspectRow[]> {
  const base = await fetchComputedPlayers({ orgId, prospectsOnly: true, limit: 100 });
  if (base.length === 0) return [];
  const ids = base.map((r) => r.player_id);
  const refreshRunId = await latestRefreshRunId();

  const playersExtra = await fetchAll<{ id: number; level: number | null; team_id: number | null; organization_id: number | null }>((from, to) =>
    supabase.from("players").select("id,level,team_id,organization_id").in("id", ids).range(from, to) as never
  );
  const levelById = new Map(playersExtra.map((p) => [p.id, p.level]));
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
  const abbrRows = await fetchAll<{ team_id: number; abbr: string }>((from, to) =>
    supabase.from("team_batting_stats_snapshots").select("team_id,abbr").eq("refresh_run_id", refreshRunId).range(from, to) as never
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

  // A player can have one row PER LEVEL they played at this season (promotions/
  // demotions mid-year each get their own stint row) — collect all of them,
  // not just one, per player_id, split_id=1 (overall, not vL/vR).
  const battingByPlayer = new Map<number, { level_id: number; ab: number; h: number; hr: number; rbi: number; bb: number; k: number; pa: number; war: number | null }[]>();
  const pitchingByPlayer = new Map<number, { level_id: number; ip: number; er: number; w: number; l: number; k: number; bb: number; bf: number; war: number | null }[]>();
  if (seasonYear !== null) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: bat } = await supabase.from("player_batting_stats_snapshots")
        .select("player_id,level_id,ab,h,hr,rbi,bb,k,pa,war")
        .eq("refresh_run_id", refreshRunId).eq("year", seasonYear).eq("split_id", 1).in("player_id", chunk);
      (bat as never as ({ player_id: number } & { level_id: number; ab: number; h: number; hr: number; rbi: number; bb: number; k: number; pa: number; war: number | null })[] | null)
        ?.forEach((r) => { const arr = battingByPlayer.get(r.player_id) ?? []; arr.push(r); battingByPlayer.set(r.player_id, arr); });

      const { data: pit } = await supabase.from("player_pitching_stats_snapshots")
        .select("player_id,level_id,ip,er,w,l,k,bb,bf,war")
        .eq("refresh_run_id", refreshRunId).eq("year", seasonYear).eq("split_id", 1).in("player_id", chunk);
      (pit as never as ({ player_id: number } & { level_id: number; ip: number; er: number; w: number; l: number; k: number; bb: number; bf: number; war: number | null })[] | null)
        ?.forEach((r) => { const arr = pitchingByPlayer.get(r.player_id) ?? []; arr.push(r); pitchingByPlayer.set(r.player_id, arr); });
    }
  }

  return base.map((r) => {
    const ph = phById.get(r.player_id) ?? null;
    const bat = battingByPlayer.get(r.player_id) ?? [];
    const pit = pitchingByPlayer.get(r.player_id) ?? [];
    // Merge batting and pitching stints by level_id (a hitter's batting rows,
    // or a pitcher's pitching rows — a player is one or the other per PH, so
    // in practice only one side will have entries).
    const levels = new Set([...bat.map((b) => b.level_id), ...pit.map((p) => p.level_id)]);
    const seasonStints: SeasonStint[] = [...levels].sort((a, b) => a - b).map((lvl) => {
      const b = bat.find((x) => x.level_id === lvl);
      const p = pit.find((x) => x.level_id === lvl);
      return {
        level: lvl,
        ab: b?.ab ?? null, h: b?.h ?? null, hr: b?.hr ?? null, rbi: b?.rbi ?? null, bb: b?.bb ?? null, k: b?.k ?? null,
        ip: p?.ip ?? null, er: p?.er ?? null, w: p?.w ?? null, l: p?.l ?? null, pk: p?.k ?? null, pbb: p?.bb ?? null,
      };
    });

    // Season totals, summed across every level.
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    let seasonTotals: SeasonTotals = { war: null, hr: null, k_pct: null, era: null };
    if (ph === "H" && bat.length > 0) {
      const totalPa = sum(bat.map((b) => b.pa));
      seasonTotals = {
        war: sum(bat.map((b) => b.war ?? 0)),
        hr: sum(bat.map((b) => b.hr)),
        k_pct: totalPa > 0 ? (sum(bat.map((b) => b.k)) / totalPa) * 100 : null,
        era: null,
      };
    } else if (ph === "P" && pit.length > 0) {
      const totalBf = sum(pit.map((p) => p.bf));
      const totalIp = sum(pit.map((p) => p.ip));
      seasonTotals = {
        war: sum(pit.map((p) => p.war ?? 0)),
        hr: null,
        k_pct: totalBf > 0 ? (sum(pit.map((p) => p.k)) / totalBf) * 100 : null,
        era: totalIp > 0 ? (sum(pit.map((p) => p.er)) * 9) / totalIp : null,
      };
    }

    const orgId2 = orgIdById.get(r.player_id) ?? null;
    const orgTeam = orgId2 !== null ? orgTeamById.get(orgId2) : undefined;
    const teamId = teamIdById.get(r.player_id) ?? null;

    return {
      ...r,
      level: levelById.get(r.player_id) ?? null,
      eta: etaById.get(r.player_id) ?? null,
      seasonYear,
      ph,
      seasonStints,
      seasonTotals,
      orgName: orgTeam?.name ?? null,
      orgNickname: orgTeam?.nickname ?? null,
      teamAbbr: teamId !== null ? (abbrByTeamId.get(teamId) ?? null) : null,
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
