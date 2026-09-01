import "dotenv/config";
import * as cheerio from "cheerio";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// Ballpark factor snapshots (2026-09-01, Rees's ask, part of the decomposed
// offense/defense redesign's Step 1). Captures StatsPlus's own published
// per-team park factors (https://.../thebigleague/ballparks/) at every
// refresh, the same time-series pattern as every other snapshot table in
// this platform -- accurate from whenever we start capturing forward, but
// NOT retroactively reconstructable: confirmed directly (checked both the
// ballparks index and an individual park detail page) that StatsPlus only
// publishes CURRENT factors, no per-season history, no year selector. A
// team relocation or park renovation before this table existed is simply
// not recoverable data -- nothing to build around, just an honest limit.
//
// Team mapping: verified directly, not assumed -- every park's
// /thebigleague/park/{id} URL id is IDENTICAL to our own team_id (checked
// all 32 real teams' href ids against teams.id, cross-referenced against
// teams.name || ' ' || teams.nickname matching each row's data-name
// attribute exactly). Both signals are used below: the href id is the
// primary key used to write the row, and a name-match warning fires if
// teams.name/nickname ever drifts from the page's data-name for that id
// (would indicate a stale team record, not a mapping bug).

const BALLPARKS_URL = "https://atl-02.statsplus.net/thebigleague/ballparks/";

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchBallparksHtml(): Promise<string> {
  // Confirmed directly (2026-09-01) -- unlike ratings/gamehistory, this page
  // is PUBLIC. A bare fetch with no auth returns 200; a token is appended
  // when available but isn't required.
  const token = process.env.STATSPLUS_API_TOKEN;
  const url = token ? `${BALLPARKS_URL}?token=${token}` : BALLPARKS_URL;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ballparks page fetch failed: ${res.status}`);
  return res.text();
}

interface ParkRow {
  teamId: number;
  dataName: string;
  avgRhb: number | null; avgLhb: number | null; average: number | null;
  doubles: number | null; triples: number | null;
  hrRhb: number | null; hrLhb: number | null; homeRuns: number | null;
  capacity: number | null; stadiumType: string | null; surface: string | null;
}

function parseBallparksHtml(html: string): ParkRow[] {
  const $ = cheerio.load(html);
  const rows: ParkRow[] = [];
  $(".ballparks-table tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const teamCell = $tr.find("td.ballparks-team-col");
    const dataName = teamCell.attr("data-name");
    const href = teamCell.find("a").first().attr("href"); // e.g. /thebigleague/park/8
    const match = href?.match(/\/park\/(\d+)/);
    if (!dataName || !match) return; // skip malformed rows rather than guessing
    const cells = $tr.find("td.text-center");
    const textAt = (i: number) => cells.eq(i).attr("data-text") ?? cells.eq(i).text().trim();
    rows.push({
      teamId: Number(match[1]),
      dataName,
      avgRhb: num(textAt(0)), avgLhb: num(textAt(1)), average: num(textAt(2)),
      doubles: num(textAt(3)), triples: num(textAt(4)),
      hrRhb: num(textAt(5)), hrLhb: num(textAt(6)), homeRuns: num(textAt(7)),
      capacity: num(textAt(8)),
      stadiumType: cells.eq(9).attr("data-text") ?? (cells.eq(9).text().trim() || null),
      surface: cells.eq(10).attr("data-text") ?? (cells.eq(10).text().trim() || null),
    });
  });
  return rows;
}

export async function scrapeBallparkFactors(refreshRunId: number): Promise<{ written: number; warnings: string[] }> {
  const supabase = makeSupabaseClient();
  const html = await fetchBallparksHtml();
  const rows = parseBallparksHtml(html);
  if (rows.length === 0) throw new Error("Parsed 0 rows from the ballparks page -- page structure may have changed.");

  const { data: teamRows } = await supabase.from("teams").select("id, name, nickname");
  const teamById = new Map((teamRows ?? []).map((t: { id: number; name: string | null; nickname: string | null }) => [t.id, `${t.name ?? ""} ${t.nickname ?? ""}`.trim()]));

  const warnings: string[] = [];
  for (const r of rows) {
    const ourName = teamById.get(r.teamId);
    if (!ourName) {
      warnings.push(`park/${r.teamId} ("${r.dataName}") has no matching team_id ${r.teamId} in our teams table -- skipped.`);
    } else if (ourName !== r.dataName) {
      warnings.push(`team_id ${r.teamId}: our name "${ourName}" != page's "${r.dataName}" -- mapped anyway (by id), but worth checking teams table for a stale name.`);
    }
  }

  const validRows = rows.filter((r) => teamById.has(r.teamId));
  const { error } = await supabase.from("ballpark_factor_snapshots").upsert(
    validRows.map((r) => ({
      refresh_run_id: refreshRunId,
      team_id: r.teamId,
      avg_rhb: r.avgRhb, avg_lhb: r.avgLhb, average: r.average,
      doubles: r.doubles, triples: r.triples,
      hr_rhb: r.hrRhb, hr_lhb: r.hrLhb, home_runs: r.homeRuns,
      capacity: r.capacity, stadium_type: r.stadiumType, surface: r.surface,
    })) as never[],
    { onConflict: "refresh_run_id,team_id" }
  );
  if (error) throw new Error(`ballpark_factor_snapshots upsert failed: ${error.message}`);

  return { written: validRows.length, warnings };
}

// Standalone run (also called from refresh.ts with a real refresh_run_id).
async function main() {
  const supabase = makeSupabaseClient();
  const { data: runRow, error } = await supabase.from("refresh_runs").select("id").order("id", { ascending: false }).limit(1).single();
  if (error || !runRow) throw new Error(`No refresh_runs found: ${error?.message}`);
  const refreshRunId = (runRow as { id: number }).id;
  console.log(`Fetching ballpark factors, tagging as refresh_run_id ${refreshRunId}...`);
  const { written, warnings } = await scrapeBallparkFactors(refreshRunId);
  console.log(`Wrote ${written} team rows.`);
  for (const w of warnings) console.warn(`  WARNING: ${w}`);
}

main().catch((err) => {
  console.error("scrape-ballpark-factors failed:", err);
  process.exit(1);
});
