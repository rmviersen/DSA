import "dotenv/config";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// Free agent contract demands (2026-09-04, Rees's ask). StatsPlus does not
// expose this anywhere -- confirmed thoroughly (see statsplus-api-inventory.md's
// 2026-09-04 entry: read the real /faajaxtable/ AJAX response and every
// individual player page directly, nothing). The raw OOTP export DOES have a
// real "DEM" column ("$800k"/"$1.6m"/"-" for no demand yet) -- but that
// export only exists as a manual file Rees generates from the game client
// himself, so this can never be part of the automated StatsPlus refresh.
// Same manual-import pattern as import-draft-pool.ts: OOTP always writes
// this report to the same filename, overwriting the previous export, so
// history has to come from accumulating our OWN import records, not from
// the file itself.
const DEFAULT_CSV_PATH =
  process.env.FA_DEMANDS_CSV_PATH ??
  "C:/Users/rmvie/OneDrive/Documents/Out of the Park Developments/OOTP Baseball 27/saved_games/TheBigLeague.lg/import_export/tbl_transactions_free_agents_-_all_free_agents_player_info.csv";

function getArg(name: string): string | undefined {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match?.split("=")[1];
}

// Same "$800k"/"$1.6m" parsing pattern already used for trade cash amounts
// in scrape-trade-history.ts's parseCashAmount() -- OOTP's own dollar-figure
// convention throughout this export family.
function parseDemand(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "-" || trimmed === "") return null;
  const m = trimmed.match(/^\$?([\d,]+(?:\.\d+)?)\s*(k|m)?$/i);
  if (!m) return null;
  let val = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(val)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") val *= 1_000;
  if (suffix === "m") val *= 1_000_000;
  // Floating-point multiplication (e.g. 32.8 * 1_000_000) can land a hair
  // off a whole dollar (32799999.999999996) -- OOTP's own demand figures are
  // never more precise than that anyway, so round cleanly to the dollar.
  return Math.round(val);
}

async function main() {
  const csvPath = getArg("file") ?? DEFAULT_CSV_PATH;
  const supabase = makeSupabaseClient();

  const raw = parse(readFileSync(csvPath, "utf-8"), { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  console.log(`Read ${raw.length} rows from ${csvPath}`);

  const { data: latestRun } = await supabase
    .from("refresh_runs").select("game_date").order("id", { ascending: false }).limit(1).maybeSingle();
  const gameDate = (latestRun as { game_date: string | null } | null)?.game_date ?? null;

  const { data: importRow, error: importErr } = await supabase
    .from("free_agent_demand_imports")
    .insert({ source_file: csvPath, row_count: raw.length, game_date: gameDate })
    .select("id")
    .single();
  if (importErr || !importRow) throw new Error(`Failed to create import record: ${importErr?.message}`);
  const importId = (importRow as { id: number }).id;

  let unparsed = 0;
  const rows = raw.map((r) => {
    const demandRaw = r["DEM"] ?? "-";
    const demand = parseDemand(demandRaw);
    if (demand === null && demandRaw.trim() !== "-" && demandRaw.trim() !== "") {
      unparsed++;
      console.warn(`  Unparsed DEM value for player ${r["ID"]}: "${demandRaw}"`);
    }
    return {
      import_id: importId,
      player_id: Number(r["ID"]),
      demand_salary: demand,
      sign_difficulty: r["Sign"] || null,
    };
  });
  if (unparsed > 0) console.warn(`${unparsed} DEM values didn't match the expected "$Xk"/"$X.Xm" pattern -- check the warnings above.`);

  // Sanity check: how many of these player IDs do we actually have (they
  // should all already exist via the StatsPlus /players/ pull) -- same
  // defensive check import-draft-pool.ts already does.
  const ids = rows.map((r) => r.player_id);
  const known = new Set<number>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase.from("players").select("id").in("id", ids.slice(i, i + 500));
    (data as { id: number }[] | null)?.forEach((p) => known.add(p.id));
  }
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.warn(`${unknown.length} of ${ids.length} export player IDs are NOT in our players table yet: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? "..." : ""}`);
    console.warn("These will be skipped -- run the main StatsPlus refresh first if this list is large.");
  }

  const insertable = rows.filter((r) => known.has(r.player_id));
  const withDemand = insertable.filter((r) => r.demand_salary !== null).length;
  console.log(`Inserting ${insertable.length} rows (${withDemand} with a real demand value, import id ${importId})...`);
  for (let i = 0; i < insertable.length; i += 500) {
    const batch = insertable.slice(i, i + 500);
    const { error } = await supabase.from("free_agent_demands").insert(batch as never[]);
    if (error) throw new Error(`free_agent_demands insert failed at row ${i}: ${error.message}`);
  }

  console.log(`Done. free_agent_demand_imports.id = ${importId} -- ${insertable.length} players, ${withDemand} with a real demand, game_date ${gameDate ?? "unknown"}.`);
}

main().catch((e) => { console.error("import-free-agent-demands failed:", e); process.exit(1); });
