import { makeSupabaseClient } from "./supabase-client";

// Data layer for /lopsided-trades (2026-10-14, Rees's ask). Reads trade_war_results, which scripts/compute-lopsided-trades.ts
// fills (method documented there and in HANDOFF.md). Server-only; the Supabase client is created inside the function.

export type PickPlayer = { playerId: number; name: string; pos: string; overallPick: number | null; war: number; draftedByTeamId: number; probability?: number };
export type TradeAsset =
  | { kind: "player"; playerId: number; name: string; pos: string; war: number; firstYear: number | null; lastYear: number | null }
  | {
      kind: "pick"; year: number; round: number; originalTeamId: number | null; originalTeamLabel: string | null;
      resolution: "exact" | "likely" | "candidates" | "undrafted" | "unresolved"; players: PickPlayer[]; war: number;
      credited: boolean; finalHolderId: number | null; reason?: string;
    }
  | { kind: "cash"; amount: number };

export interface TradeSide { teamId: number; teamLabel: string | null; war: number; receives: TradeAsset[] }
export interface LopsidedTrade {
  tradeEventId: number;
  tradeDate: string;
  margin: number;
  winnerTeamId: number | null;
  hasPick: boolean;
  yearsSince: number;
  a: TradeSide;
  b: TradeSide;
}
export interface FranchiseInfo { id: number; name: string; nickname: string }
export interface LopsidedTradesResult {
  trades: LopsidedTrade[];
  franchises: Record<number, FranchiseInfo>;
  computedAt: string | null;
  totalTrades: number; // trades with a computed result in this filter
}

export type LopsidedFilter = "all" | "picks" | "players";

export async function getLopsidedTrades(leagueId: number, filter: LopsidedFilter = "all", limit = 20): Promise<LopsidedTradesResult> {
  const supabase = makeSupabaseClient();
  let q = supabase.from("trade_war_results")
    .select("trade_event_id,trade_date,team_a_id,team_b_id,margin,winner_team_id,has_pick,details,computed_at", { count: "exact" })
    .eq("dsa_league_id", leagueId);
  if (filter === "picks") q = q.eq("has_pick", true);
  if (filter === "players") q = q.eq("has_pick", false);
  const { data, error, count } = await q.order("margin", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    trade_event_id: number; trade_date: string; team_a_id: number; team_b_id: number; margin: number; winner_team_id: number | null;
    has_pick: boolean; computed_at: string;
    details: { yearsSince: number; a: TradeSide; b: TradeSide };
  }[];

  const trades: LopsidedTrade[] = rows.map((r) => ({
    tradeEventId: Number(r.trade_event_id),
    tradeDate: r.trade_date,
    margin: Number(r.margin),
    winnerTeamId: r.winner_team_id != null ? Number(r.winner_team_id) : null,
    hasPick: r.has_pick,
    yearsSince: r.details.yearsSince,
    a: r.details.a,
    b: r.details.b,
  }));

  // Current name/nickname for every franchise that appears (teams change city over the years; the logo is keyed on the CURRENT
  // name -- see teamLogoUrl in display-helpers.ts).
  const ids = new Set<number>();
  for (const t of trades) {
    ids.add(t.a.teamId); ids.add(t.b.teamId);
    for (const side of [t.a, t.b]) for (const asset of side.receives) {
      if (asset.kind === "pick") {
        if (asset.originalTeamId != null) ids.add(asset.originalTeamId);
        if (asset.finalHolderId != null) ids.add(asset.finalHolderId);
      }
    }
  }
  const franchises: Record<number, FranchiseInfo> = {};
  if (ids.size > 0) {
    const { data: teamRows, error: teamErr } = await supabase.from("teams").select("id,name,nickname").eq("dsa_league_id", leagueId).in("id", [...ids]);
    if (teamErr) throw new Error(teamErr.message);
    for (const t of teamRows as { id: number; name: string | null; nickname: string | null }[]) {
      franchises[Number(t.id)] = { id: Number(t.id), name: t.name ?? `Team ${t.id}`, nickname: t.nickname ?? "" };
    }
  }
  const computedAt = rows.length ? rows.map((r) => r.computed_at).sort().slice(-1)[0] : null;
  return { trades, franchises, computedAt, totalTrades: count ?? trades.length };
}
