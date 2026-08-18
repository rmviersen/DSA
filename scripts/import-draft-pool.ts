import "dotenv/config";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// OOTP always writes this report to the same filename, overwriting the previous
// export — so "which draft class this represents" has to be told to us, not
// read from the file itself. Run as: npm run import-draft-pool -- --year=2032
const DEFAULT_CSV_PATH =
  process.env.DRAFT_POOL_CSV_PATH ??
  "C:/Users/rmvie/OneDrive/Documents/Out of the Park Developments/OOTP Baseball 27/saved_games/TheBigLeague.lg/import_export/the_big_league_draft_pool_-_draft_pool_player_info.csv";

function getArg(name: string): string | undefined {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match?.split("=")[1];
}

async function main() {
  const draftYear = getArg("year");
  if (!draftYear) {
    console.error("Usage: npm run import-draft-pool -- --year=2032  (the draft class this export represents)");
    process.exit(1);
  }
  const csvPath = getArg("file") ?? DEFAULT_CSV_PATH;

  const supabase = makeSupabaseClient();
  const raw = parse(readFileSync(csvPath, "utf-8"), { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  console.log(`Read ${raw.length} rows from ${csvPath}, tagging as draft_year=${draftYear}`);

  const { data: importRow, error: importErr } = await supabase
    .from("draft_class_imports")
    .insert({ draft_year: Number(draftYear), source_file: csvPath, row_count: raw.length })
    .select("id")
    .single();
  if (importErr || !importRow) throw new Error(`Failed to create import record: ${importErr?.message}`);
  const importId = (importRow as { id: number }).id;

  const rows = raw.map((r) => ({
    draft_class_import_id: importId,
    player_id: Number(r["ID"]),
    pos: r["POS"] || null,
    lev: r["Lev"] || null,
    mld: r["MLD"] ? Number(r["MLD"]) : null,
    sctacc: r["SctAcc"] || null,
    sctcat: r["SctCat"] || null,
    type: r["Type"] || null,
    act: r["ACT"] || null,
    pct: r["Pct"] || null,
    // Risk intentionally excluded per 2026-08-18 decision.
  }));

  // Sanity check: how many of these player IDs do we actually have (they should
  // all already exist via the StatsPlus /players/ pull).
  const ids = rows.map((r) => r.player_id);
  const known = new Set<number>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase.from("players").select("id").in("id", ids.slice(i, i + 500));
    (data as { id: number }[] | null)?.forEach((p) => known.add(p.id));
  }
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.warn(`${unknown.length} of ${ids.length} pool player IDs are NOT in our players table yet: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? "..." : ""}`);
    console.warn("These will fail to insert (foreign key) — run the main StatsPlus refresh first if this list is large.");
  }

  const insertable = rows.filter((r) => known.has(r.player_id));
  console.log(`Inserting ${insertable.length} pool members (import id ${importId})...`);
  for (let i = 0; i < insertable.length; i += 500) {
    const batch = insertable.slice(i, i + 500);
    const { error } = await supabase.from("draft_class_pool_members").insert(batch as never[]);
    if (error) throw new Error(`draft_class_pool_members insert failed at row ${i}: ${error.message}`);
  }

  console.log(`Done. draft_class_imports.id = ${importId} — draft_year ${draftYear}, ${insertable.length} members.`);
}

main().catch((e) => { console.error("import-draft-pool failed:", e); process.exit(1); });
