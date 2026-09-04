import { makeSupabaseClient } from "./supabase-client";
import { latestRefreshRunId } from "./queries";
import { getOrgMinorsPlayers, fetchAll, avgDiffPercentile, rankPercentile, topNAvg, ROLE_HEALTH_ROWS } from "./org-minors-query";
import { effectiveLevel, levelLabel as canonicalLevelLabel } from "./display-helpers";
import { PITCHER_ROLES } from "./contract-classification";
import { yearsOfControl } from "./trade-value";

const supabase = makeSupabaseClient();

function isPitcherRole(role: string): boolean {
  return PITCHER_ROLES.has(role);
}

// "My Roster" page (2026-09-04, Rees's ask). Full team analysis, broken down
// role-by-role: a CURRENT card (today's MLB roster strength -- reuses
// /org-minors' already-verified Role Health numbers as-is, no recompute) next
// to a FUTURE card (the org's pipeline strength at that role a few years out
// -- new), each with a rating, a leaguewide rank, and a depth chart of the
// actual players behind the number. This is the "identify strengths/
// weaknesses" page Rees wants built before circling back to /free-agency's
// needs-bar work -- /org-minors stays the roster-count/movement-tracking
// tool, this is the role-first strategic view.
//
// FUTURE pool definition -- Rees's exact spec (2026-09-04): every org player
// below the active MLB roster (minors + international academy) who will
// STILL be under this team's control 2 seasons from now, i.e. excluded if
// his contract/service-time control runs out within the next 2 seasons.
// Read as yearsOfControl >= 3 (that count already includes the current
// season, so 3 = this season plus two more) -- reuses trade-value.ts's
// yearsOfControl(), built for the trade-value composite's Phase A step 1.
// A prospect with no real MLB contract yet and 0 mlb_service_years clears
// this automatically (falls back to the full 6-year service-time clock), so
// in practice this filter only ever excludes a player who's already accrued
// real MLB service time while still not on the active roster (an up-and-
// down veteran, someone recently optioned who's nearing free agency) --
// exactly the case where counting him toward "future" would be misleading.
// If this reads wrong once real numbers are reviewed, it's a one-line
// threshold/polarity change, not a redesign.
const MIN_FUTURE_YEARS_OF_CONTROL = 3;

// Ranked by prospect_potential (the bust-risk-adjusted ceiling already used
// for prospect rankings sitewide) so a real long-shot doesn't count the same
// as a near-certain one; falls back to raw potential for the rare case a
// still-eligible minor leaguer has a null prospect_potential -- never
// silently drops a real player from the pool over one missing field.
function futureMetric(potential: number | null, prospectPotential: number | null): number | null {
  return prospectPotential ?? potential ?? null;
}

interface DepthCandidate {
  playerId: number;
  name: string;
  age: number | null;
  role: string | null;
  metric: number | null;
  levelLabel?: string; // future depth only -- current is always MLB
  eta?: number | null; // future depth only
}

export interface RosterDepthPlayer {
  playerId: number;
  name: string;
  age: number | null;
  metric: number | null;
  levelLabel?: string;
  eta?: number | null;
}

export interface RoleSide {
  rating: number | null;
  leagueAvg: number | null;
  avgPct: number | null;
  rank: number | null;
  totalTeams: number | null;
  rankPct: number | null;
  depthChart: RosterDepthPlayer[];
}

export interface RoleCard {
  label: string;
  current: RoleSide;
  future: RoleSide;
}

// Same "top-N, but RP borrows SP's own overflow instead of trusting its own
// role label" rule as org-minors-query.ts's rpQualityPool (2026-09-04) --
// duplicated here in an identity-preserving form (that one is value-only;
// this needs to keep player identity for the depth-chart list). Keep both in
// sync if this rule ever changes. Used for BOTH current and future sides, and
// for both "our org" and "every other org" (the league-average/rank loop
// below) -- one selection rule everywhere, so there's no risk of the current-
// vs-future or us-vs-them asymmetry bug already found and fixed once this
// session.
function pickRoleDepth(universe: DepthCandidate[], rowLabel: string, rowRoles: string[], spTopN: number, ownTopN: number): DepthCandidate[] {
  const byMetricDesc = (a: DepthCandidate, b: DepthCandidate) => (b.metric ?? -Infinity) - (a.metric ?? -Infinity);
  if (rowLabel !== "RP") {
    return universe
      .filter((p) => p.role !== null && rowRoles.includes(p.role) && p.metric !== null)
      .sort(byMetricDesc)
      .slice(0, ownTopN);
  }
  const sp = universe.filter((p) => p.role === "SP" && p.metric !== null).sort(byMetricDesc);
  const spSurplus = sp.slice(spTopN);
  const rp = universe.filter((p) => p.role === "RP" && p.metric !== null);
  return [...spSurplus, ...rp].sort(byMetricDesc).slice(0, ownTopN);
}

// Card set is every specific role -- the two aggregate rows (P Tot/H Tot)
// exist in ROLE_HEALTH_ROWS for /org-minors' summary line and don't make
// sense as a "role" card here.
const CARD_ROWS = ROLE_HEALTH_ROWS.filter((r) => r.label !== "P Tot" && r.label !== "H Tot");
const SP_TOP_N = ROLE_HEALTH_ROWS.find((r) => r.label === "SP")!.topN;

export async function getMyRosterAnalysis(orgId: number): Promise<RoleCard[]> {
  const [{ rows, roleHealth }, refreshRunId] = await Promise.all([
    getOrgMinorsPlayers(orgId),
    latestRefreshRunId(),
  ]);

  // ---- CURRENT side: reuse /org-minors' already-verified Role Health MLB
  // row (rating/leagueAvg/avgPct/rank/totalTeams/rankPct) as-is -- no reason
  // to recompute a number that page already gets right, including the RP fix.
  // Depth-chart identity is built locally from `rows` using the identical
  // selection rule, so the list shown always matches the number above it.
  const currentUniverse: DepthCandidate[] = rows
    .filter((r) => r.level === 1 && r.levelLabel !== "Int'l" && r.role !== null)
    .map((r) => ({
      playerId: r.player_id,
      name: `${r.first_name} ${r.last_name}`,
      age: r.age,
      role: r.role,
      metric: isPitcherRole(r.role as string) ? r.overall : r.batting,
    }));

  // ---- FUTURE side: one leaguewide fetch so every org's pipeline gets
  // scored by the exact same rule OKC's is -- needed to rank OKC against
  // everyone else, not just report our own number in isolation.
  const allPlayers = await fetchAll<{
    id: number; first_name: string; last_name: string; age: number | null;
    organization_id: number | null; level: number | null; league_id: number | null; mlb_service_years: number | null;
  }>((from, to) =>
    supabase.from("players").select("id,first_name,last_name,age,organization_id,level,league_id,mlb_service_years")
      .not("organization_id", "is", null).range(from, to) as never
  );
  const pipelinePlayers = allPlayers.filter(
    (p): p is typeof p & { organization_id: number } => p.organization_id !== null && effectiveLevel(p.level, p.league_id) !== 1
  );
  const ids = pipelinePlayers.map((p) => p.id);

  const computedById = new Map<number, { role: string | null; potential: number | null; prospect_potential: number | null; eta: number | null }>();
  const contractById = new Map<number, { years: number | null; current_year: number | null }>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [{ data: comp, error: compErr }, { data: contracts, error: contractErr }] = await Promise.all([
      supabase.from("player_computed").select("player_id,role,potential,prospect_potential,eta").eq("refresh_run_id", refreshRunId).in("player_id", chunk),
      supabase.from("contracts").select("player_id,years,current_year").in("player_id", chunk),
    ]);
    if (compErr) throw compErr;
    if (contractErr) throw contractErr;
    (comp as never as { player_id: number; role: string | null; potential: number | null; prospect_potential: number | null; eta: number | null }[])
      .forEach((c) => computedById.set(c.player_id, c));
    (contracts as never as { player_id: number; years: number | null; current_year: number | null }[])
      .forEach((c) => contractById.set(c.player_id, c));
  }

  const futurePoolByOrg = new Map<number, DepthCandidate[]>();
  for (const p of pipelinePlayers) {
    const c = computedById.get(p.id);
    if (!c || !c.role) continue;
    const contract = contractById.get(p.id) ?? null;
    const control = yearsOfControl({
      contractYears: contract?.years ?? null,
      contractCurrentYear: contract?.current_year ?? null,
      mlbServiceYears: p.mlb_service_years,
    });
    if (control < MIN_FUTURE_YEARS_OF_CONTROL) continue;
    const metric = futureMetric(c.potential, c.prospect_potential);
    if (metric === null) continue;
    const effLvl = effectiveLevel(p.level, p.league_id);
    const arr = futurePoolByOrg.get(p.organization_id) ?? [];
    arr.push({
      playerId: p.id,
      name: `${p.first_name} ${p.last_name}`,
      age: p.age,
      role: c.role,
      metric,
      levelLabel: effLvl === 8 ? "Int'l" : canonicalLevelLabel(effLvl),
      eta: c.eta,
    });
    futurePoolByOrg.set(p.organization_id, arr);
  }

  const ownFuturePool = futurePoolByOrg.get(orgId) ?? [];

  const cards: RoleCard[] = CARD_ROWS.map(({ label, roles, topN }) => {
    const currentCell = roleHealth.find((r) => r.label === label)?.byLevel.find((c) => c.level === 1) ?? null;
    const current: RoleSide = {
      rating: currentCell?.orgAvg ?? null,
      leagueAvg: currentCell?.leagueAvg ?? null,
      avgPct: currentCell?.avgPct ?? null,
      rank: currentCell?.rank ?? null,
      totalTeams: currentCell?.totalTeams ?? null,
      rankPct: currentCell?.rankPct ?? null,
      depthChart: pickRoleDepth(currentUniverse, label, roles, SP_TOP_N, topN),
    };

    const futureDepth = pickRoleDepth(ownFuturePool, label, roles, SP_TOP_N, topN);
    const futureRating = topNAvg(futureDepth.map((d) => d.metric as number), topN);

    const leagueFutureAverages: { orgId: number; avg: number }[] = [];
    for (const [otherOrgId, players] of futurePoolByOrg) {
      const picked = pickRoleDepth(players, label, roles, SP_TOP_N, topN);
      const avg = topNAvg(picked.map((d) => d.metric as number), topN);
      if (avg !== null) leagueFutureAverages.push({ orgId: otherOrgId, avg });
    }
    const sortedFuture = [...leagueFutureAverages].sort((a, b) => b.avg - a.avg);
    const futureLeagueAvg = leagueFutureAverages.length > 0
      ? leagueFutureAverages.reduce((a, b) => a + b.avg, 0) / leagueFutureAverages.length
      : null;
    const futureIdx = sortedFuture.findIndex((t) => t.orgId === orgId);
    const futureRank = futureIdx >= 0 ? futureIdx + 1 : null;
    const futureTotalTeams = sortedFuture.length > 0 ? sortedFuture.length : null;

    const future: RoleSide = {
      rating: futureRating,
      leagueAvg: futureLeagueAvg,
      avgPct: avgDiffPercentile(futureRating, futureLeagueAvg),
      rank: futureRank,
      totalTeams: futureTotalTeams,
      rankPct: rankPercentile(futureRank, futureTotalTeams),
      depthChart: futureDepth,
    };

    return { label, current, future };
  });

  return cards;
}
