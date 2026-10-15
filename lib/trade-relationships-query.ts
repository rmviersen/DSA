import { makeSupabaseClient } from "./supabase-client";
import type { TradeRelationshipData, TradeRow, TradeTeam } from "./trade-relationships-math";

// Data layer for /trade-relationships (2026-10-14, Rees's ask). Server-only. makeSupabaseClient() is created inside the
// function, same client-bundle-safe pattern as every other query module here.
//
// Teams are identified by FRANCHISE id (trade_events.team_a_id / team_b_id): ids are stable across relocations and renames
// (id 2 traded as Boston, Carolina and Chicago), so a franchise's whole history stays on one node, labelled with its CURRENT
// city/nickname. Only status = 'complete' trades count -- 'pending' rows are proposals StatsPlus lists before they finish
// (most reappear as 'complete' later, which would double count). Duplicate-looking trades are not deduplicated beyond that.

const PAGE = 1000;

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

// "Denver (DEN)" -> { city: "Denver", abbr: "DEN" }
function parseTeamLabel(label: string | null): { city: string; abbr: string | null } {
  const m = (label ?? "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { city: m[1].trim(), abbr: m[2].trim() } : { city: (label ?? "").trim(), abbr: null };
}

export async function getTradeRelationshipData(leagueId: number): Promise<TradeRelationshipData> {
  const supabase = makeSupabaseClient();

  const events = await fetchAll<{ id: number; trade_date: string; team_a_id: number; team_b_id: number; team_a_name: string | null; team_b_name: string | null }>(
    (from, to) => supabase.from("trade_events")
      .select("id,trade_date,team_a_id,team_b_id,team_a_name,team_b_name")
      .eq("dsa_league_id", leagueId).eq("status", "complete").order("id").range(from, to) as never,
  );
  const items = await fetchAll<{ trade_event_id: number; side: string; player_id: number | null; pick_year: number | null }>(
    (from, to) => supabase.from("trade_event_items")
      .select("id,trade_event_id,side,player_id,pick_year")
      .eq("dsa_league_id", leagueId).order("id").range(from, to) as never,
  );

  // What each side SENT in each trade.
  const sent = new Map<number, { aPlayers: number; aPicks: number; bPlayers: number; bPicks: number }>();
  for (const it of items) {
    let s = sent.get(it.trade_event_id);
    if (!s) { s = { aPlayers: 0, aPicks: 0, bPlayers: 0, bPicks: 0 }; sent.set(it.trade_event_id, s); }
    const isA = it.side === "a";
    if (it.player_id != null) { if (isA) s.aPlayers += 1; else s.bPlayers += 1; }
    else if (it.pick_year != null) { if (isA) s.aPicks += 1; else s.bPicks += 1; }
  }

  const trades: TradeRow[] = events
    .filter((e) => e.team_a_id !== e.team_b_id)
    .map((e) => {
      const s = sent.get(e.id) ?? { aPlayers: 0, aPicks: 0, bPlayers: 0, bPicks: 0 };
      return { id: e.id, date: e.trade_date, year: Number(e.trade_date.slice(0, 4)), a: Number(e.team_a_id), b: Number(e.team_b_id), ...s };
    })
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id));

  // Every name each franchise has traded under (for the abbreviation + "formerly" labels).
  const labels = new Map<number, { city: string; abbr: string | null; date: string }[]>();
  for (const e of events) {
    for (const [id, label] of [[e.team_a_id, e.team_a_name], [e.team_b_id, e.team_b_name]] as const) {
      const p = parseTeamLabel(label);
      const arr = labels.get(Number(id)) ?? [];
      arr.push({ ...p, date: e.trade_date });
      labels.set(Number(id), arr);
    }
  }

  const teamIds = [...labels.keys()];
  const { data: teamRows, error: teamErr } = await supabase.from("teams").select("id,name,nickname").eq("dsa_league_id", leagueId).in("id", teamIds);
  if (teamErr) throw new Error(teamErr.message);
  const teamById = new Map((teamRows as { id: number; name: string | null; nickname: string | null }[]).map((t) => [Number(t.id), t]));

  // Divisions come from the newest standings snapshot (the league has 4 divisions in 2 conferences).
  const divisionByTeam = new Map<number, string>();
  const { data: latestStand } = await supabase.from("team_standings_snapshots").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (latestStand) {
    const { data: standRows, error: standErr } = await supabase.from("team_standings_snapshots").select("team_id,division_name")
      .eq("dsa_league_id", leagueId).eq("refresh_run_id", (latestStand as { refresh_run_id: number }).refresh_run_id);
    if (standErr) throw new Error(standErr.message);
    for (const r of standRows as { team_id: number; division_name: string | null }[]) if (r.division_name) divisionByTeam.set(Number(r.team_id), r.division_name);
  }

  // "Fire Conference Ruby Division" -> conference "Fire", division "Ruby Division"; anything unparseable stays whole.
  function splitDivision(full: string | undefined): { conference: string; division: string; sortKey: string } {
    if (!full) return { conference: "League", division: "All teams", sortKey: "" };
    const m = full.match(/^(.*?)\s+Conference\s+(.*)$/i);
    return m ? { conference: m[1], division: m[2], sortKey: full } : { conference: "League", division: full, sortKey: full };
  }

  const volume = new Map<number, number>();
  for (const t of trades) { volume.set(t.a, (volume.get(t.a) ?? 0) + 1); volume.set(t.b, (volume.get(t.b) ?? 0) + 1); }

  const divisionKeys = [...new Set(teamIds.map((id) => splitDivision(divisionByTeam.get(id)).sortKey))].sort();
  const teams: TradeTeam[] = teamIds.map((id) => {
    const row = teamById.get(id);
    const hist = (labels.get(id) ?? []).sort((x, y) => (x.date < y.date ? 1 : -1)); // newest first
    const currentCity = row?.name ?? hist[0]?.city ?? `Team ${id}`;
    // Prefer an abbreviation used while the franchise carried its current city; else the newest one on record.
    const abbr = hist.find((h) => h.city === currentCity && h.abbr)?.abbr ?? hist.find((h) => h.abbr)?.abbr ?? currentCity.slice(0, 3).toUpperCase();
    const div = splitDivision(divisionByTeam.get(id));
    return {
      id, name: currentCity, nickname: row?.nickname ?? "", abbr,
      division: div.division, conference: div.conference, divisionIndex: divisionKeys.indexOf(div.sortKey),
      formerNames: [...new Set(hist.map((h) => h.city).filter((c) => c && c !== currentCity))],
    };
  }).sort((x, y) => x.divisionIndex - y.divisionIndex || (volume.get(y.id) ?? 0) - (volume.get(x.id) ?? 0) || x.name.localeCompare(y.name));

  const years = trades.map((t) => t.year);
  return { teams, trades, minYear: years.length ? Math.min(...years) : 0, maxYear: years.length ? Math.max(...years) : 0 };
}
