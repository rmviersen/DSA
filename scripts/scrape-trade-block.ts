import "dotenv/config";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// Phase 1 of the transaction-history/market-analysis work (2026-08-31,
// Rees's ask). Scrapes the league's public trade block page -- see
// lib/statsplus-client.ts's fetchTradeBlockHtml comment for the full "why
// this is one cheap page fetch, not a per-player scrape" story, and
// trade_block_snapshots' own table comment for the schema rationale.
//
// Deliberately its own standalone script, not folded into refresh.ts --
// trade block content changes on GM activity, not sim advancement, so it
// legitimately wants its own run cadence (a human, a cron, whatever) rather
// than being forced onto the 30-minute sim-triggered pipeline before anyone's
// actually decided that's the right cadence for it.

const TRADEBLOCK_PIDS_SCRIPT_RE = /<script id=['"]tradeblock-pids-data['"][^>]*>([\s\S]*?)<\/script>/;

function extractTradeBlockPids(html: string): Record<string, string> {
  const match = html.match(TRADEBLOCK_PIDS_SCRIPT_RE);
  if (!match) throw new Error("Could not find the tradeblock-pids-data <script> tag in the fetched HTML -- page structure may have changed.");
  return JSON.parse(match[1]) as Record<string, string>;
}

async function main() {
  const supabase = makeSupabaseClient();
  const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL! });

  console.log("Finding latest refresh run to tag this snapshot against...");
  const { data: pcRow, error: pcErr } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (pcErr || !pcRow) throw new Error(`No player_computed rows found: ${pcErr?.message}`);
  const refreshRunId = (pcRow as { refresh_run_id: number }).refresh_run_id;
  console.log(`Tagging against refresh_run_id ${refreshRunId}`);

  console.log("Fetching the trade block page...");
  const html = await sp.tradeBlockHtml();
  const pidNotes = extractTradeBlockPids(html);
  const playerIds = Object.keys(pidNotes).map(Number).filter((n) => Number.isFinite(n));
  console.log(`  ${playerIds.length} players currently listed`);

  const capturedAt = new Date().toISOString();
  const rows = playerIds.map((playerId) => ({
    refresh_run_id: refreshRunId,
    player_id: playerId,
    note: pidNotes[String(playerId)] ?? "",
    captured_at: capturedAt,
  }));

  console.log(`Writing ${rows.length} rows to trade_block_snapshots...`);
  const MAX_ATTEMPTS = 3;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    let ok = false, lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      const { error } = await supabase.from("trade_block_snapshots").upsert(batch as never[], { onConflict: "refresh_run_id,player_id" });
      if (!error) { ok = true; break; }
      lastErr = error;
      console.warn(`trade_block_snapshots upsert (rows ${i}-${i + batch.length}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!ok) throw new Error(`trade_block_snapshots upsert failed at row ${i}: ${lastErr}`);
  }

  const withNotes = rows.filter((r) => r.note.trim().length > 0).length;
  console.log(`Done. ${rows.length} players on the block (${withNotes} with a real asking-price note).`);
}

main().catch((err) => {
  console.error("scrape-trade-block failed:", err);
  process.exit(1);
});
