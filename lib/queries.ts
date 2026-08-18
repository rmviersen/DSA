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

export interface ProspectRow extends PlayerRow {
  level: number | null;
  eta: number | null;
  seasonYear: number | null;
  // batting (present when ph === 'H')
  ab: number | null; h: number | null; hr: number | null; rbi: number | null; bb: number | null; k: number | null;
  // pitching (present when ph === 'P')
  ip: number | null; er: number | null; w: number | null; l: number | null; pk: number | null; pbb: number | null;
  ph: "H" | "P" | null;
}

export async function getTopProspectsDetailed(orgId?: number): Promise<ProspectRow[]> {
  const base = await fetchComputedPlayers({ orgId, prospectsOnly: true, limit: 100 });
  if (base.length === 0) return [];
  const ids = base.map((r) => r.player_id);
  const refreshRunId = await latestRefreshRunId();

  const playersExtra = await fetchAll<{ id: number; level: number | null }>((from, to) =>
    supabase.from("players").select("id,level").in("id", ids).range(from, to) as never
  );
  const levelById = new Map(playersExtra.map((p) => [p.id, p.level]));

  const computedExtra = await fetchAll<{ player_id: number; eta: number | null; ph: "H" | "P" }>((from, to) =>
    supabase.from("player_computed").select("player_id,eta,ph").eq("refresh_run_id", refreshRunId).in("player_id", ids).range(from, to) as never
  );
  const etaById = new Map(computedExtra.map((c) => [c.player_id, c.eta]));
  const phById = new Map(computedExtra.map((c) => [c.player_id, c.ph]));

  // Most recent season's batting/pitching line (split_id=1 = overall, not vL/vR).
  const { data: yearRow } = await supabase
    .from("player_batting_stats_snapshots").select("year").eq("refresh_run_id", refreshRunId).order("year", { ascending: false }).limit(1).maybeSingle();
  const seasonYear = (yearRow as { year: number } | null)?.year ?? null;

  const battingById = new Map<number, { ab: number; h: number; hr: number; rbi: number; bb: number; k: number }>();
  const pitchingById = new Map<number, { ip: number; er: number; w: number; l: number; k: number; bb: number }>();
  if (seasonYear !== null) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data: bat } = await supabase.from("player_batting_stats_snapshots")
        .select("player_id,ab,h,hr,rbi,bb,k")
        .eq("refresh_run_id", refreshRunId).eq("year", seasonYear).eq("split_id", 1).in("player_id", chunk);
      (bat as never as { player_id: number; ab: number; h: number; hr: number; rbi: number; bb: number; k: number }[] | null)?.forEach((r) => battingById.set(r.player_id, r));

      const { data: pit } = await supabase.from("player_pitching_stats_snapshots")
        .select("player_id,ip,er,w,l,k,bb")
        .eq("refresh_run_id", refreshRunId).eq("year", seasonYear).eq("split_id", 1).in("player_id", chunk);
      (pit as never as { player_id: number; ip: number; er: number; w: number; l: number; k: number; bb: number }[] | null)?.forEach((r) => pitchingById.set(r.player_id, r));
    }
  }

  return base.map((r) => {
    const ph = phById.get(r.player_id) ?? null;
    const bat = battingById.get(r.player_id);
    const pit = pitchingById.get(r.player_id);
    return {
      ...r,
      level: levelById.get(r.player_id) ?? null,
      eta: etaById.get(r.player_id) ?? null,
      seasonYear,
      ph,
      ab: bat?.ab ?? null, h: bat?.h ?? null, hr: bat?.hr ?? null, rbi: bat?.rbi ?? null, bb: bat?.bb ?? null, k: bat?.k ?? null,
      ip: pit?.ip ?? null, er: pit?.er ?? null, w: pit?.w ?? null, l: pit?.l ?? null, pk: pit?.k ?? null, pbb: pit?.bb ?? null,
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
