import "dotenv/config";
import * as cheerio from "cheerio";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// Phase 2 of the transaction-history/market-analysis work (2026-08-31,
// Rees's ask), REWRITTEN the same day after Rees caught a real accuracy
// problem in the first version: that version scraped each traded player's
// own `/player/{id}?page=trade` tab, scoped to `players.was_traded = true`
// (276 players) to keep the run short. That premise was wrong -- cross-
// checking against StatsPlus's own `/trade/#recent` page (1,101 real trades,
// 2001-present, exactly matching Rees's own manual count) showed only 274 of
// the 1,749 players actually involved in a real trade have `was_traded =
// true` at all. The flag itself is badly incomplete, not something we can
// scope around.
//
// This version scrapes the trade LEDGER directly instead of any per-player
// page: `/ttajaxtable/?info=recent&view=recent`, the same public, no-auth
// AJAX endpoint that powers the `/trade/#recent` tab's own table. It's the
// authoritative list already deduplicated by StatsPlus itself -- one row per
// real trade, full history in a single ~3s request (see
// lib/statsplus-client.ts's fetchTradeLedgerHtml for the two-step probe/
// fetch-all mechanics). No player-list dependency, no per-player looping,
// and it captures two whole categories of trade asset the old page-per-
// player approach never saw at all: draft picks and retained-salary %.

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

function parseTradeDate(text: string): string {
  const m = text.trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) throw new Error(`unrecognized trade date format: "${text}"`);
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) throw new Error(`unrecognized month name: "${m[1]}"`);
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

interface TeamRef { id: number | null; name: string }

// Every team cell in this ledger carries a `data-name="XXX"` attribute (the
// team's abbreviation) whether or not it also links to a live team page --
// confirmed even a franchise later renamed (id 17 links here as "Durham
// (DUR)" even though `teams.name` has since become "Cincinnati") still
// resolves to a real, usable id. Unlike the old per-player trade tab, a
// fully unlinked cell was not observed anywhere in this ledger -- kept as a
// defensive fallback anyway, matching the same non-throwing pattern.
function extractTeamRef(cell: ReturnType<cheerio.CheerioAPI>): TeamRef {
  const link = cell.find('a[href^="/thebigleague/team/"]').first();
  const href = link.attr("href");
  if (href) {
    const m = href.match(/\/team\/(\d+)/);
    if (m) return { id: Number(m[1]), name: link.text().trim() };
  }
  return { id: null, name: cell.text().trim() };
}

type TradeItem =
  | { kind: "player"; playerId: number; retainedSalaryPct: number | null }
  | { kind: "cash"; cashAmount: number }
  | { kind: "pick"; pickYear: number; pickRound: number; pickTeamAbbr: string; pickTeamId: number | null };

function parseCashAmount(text: string): number | null {
  const cleaned = text.replace(/\bcash\b/i, "").trim();
  const m = cleaned.match(/^\$?([\d,]+(?:\.\d+)?)\s*(k|m)?$/i);
  if (!m) return null;
  let amount = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") amount *= 1_000;
  if (suffix === "m") amount *= 1_000_000;
  return amount;
}

// Each direct-child <div> of a "sent" cell is one item -- TWO different
// shapes share that position: a plain unclassed <div> for a draft pick
// ("2033 DEN 4th<div>round pick</div><div>rd</div>"), or a
// <div class="tt-text-row-height"> for a player, cash amount, "Nothing", or
// (rare, 10 confirmed across all of league history) a free-text GM/
// commissioner "Note:" annotation that isn't a real trade asset at all.
// `.children("div")` catches both shapes; a player is identified by a
// nested `a[data-player-id]` before falling through to the other checks.
function parseSentCell(
  $: cheerio.CheerioAPI,
  cell: ReturnType<cheerio.CheerioAPI>,
  abbrToTeamId: Map<string, number>,
  context: string,
): TradeItem[] {
  const items: TradeItem[] = [];
  cell.children("div").each((_, el) => {
    const $el = $(el);
    const pid = $el.find("a[data-player-id]").first().attr("data-player-id");
    if (pid) {
      // A retained-salary note, e.g. "SP B. Reyna - R: 50%", appears as
      // trailing text alongside the player link -- new data point the old
      // per-player trade tab never surfaced (that page shows a player was
      // traded, not the financial terms attached).
      const pctMatch = $el.text().match(/-\s*R:\s*(\d+)%/);
      items.push({
        kind: "player",
        playerId: Number(pid),
        retainedSalaryPct: pctMatch ? Number(pctMatch[1]) : null,
      });
      return;
    }
    // Strip nested label divs (the wide "round pick" / narrow "rd" variants)
    // to get just the item's own direct text, e.g. "2033 DEN 4th".
    const directText = $el.clone().children("div").remove().end().text().trim().replace(/\s+/g, " ");
    if (!directText || directText === "Nothing") return; // no real asset on this side
    if (directText.startsWith("Note:")) {
      console.warn(`  [note, not a trade asset, skipped] ${context}: "${directText}"`);
      return;
    }
    const pickMatch = directText.match(/^(\d{4})\s+([A-Za-z.]+)\s+(\d+)(?:st|nd|rd|th)$/);
    if (pickMatch) {
      const [, yearStr, abbr, roundStr] = pickMatch;
      items.push({
        kind: "pick",
        pickYear: Number(yearStr),
        pickRound: Number(roundStr),
        pickTeamAbbr: abbr,
        pickTeamId: abbrToTeamId.get(abbr) ?? null,
      });
      return;
    }
    const cashAmount = parseCashAmount(directText);
    if (cashAmount !== null) {
      items.push({ kind: "cash", cashAmount });
      return;
    }
    console.warn(`  [unrecognized trade item, skipped] ${context}: "${directText}"`);
  });
  return items;
}

interface ParsedTrade {
  tradeDate: string;
  status: "complete" | "pending";
  teamA: TeamRef;
  teamB: TeamRef;
  itemsA: TradeItem[];
  itemsB: TradeItem[];
}

// Builds an abbreviation -> team id lookup from every team cell in the
// ledger (the `data-name` attribute + the linked team id), so a traded
// draft pick's ORIGINAL team (e.g. "2032 CIN 1st round pick", which can
// differ from either side of THIS trade if the pick already changed hands
// once before) can be resolved without a second fetch.
//
// Deliberately excludes any abbreviation that maps to more than one team id
// across league history -- confirmed real collisions: "BOS" (ids 22 and 2)
// and "NY" (ids 214 and 6), almost certainly franchise relocations/renames
// reusing a short code over 30 years. Silently picking one id for an
// ambiguous abbreviation risks mis-attributing a pick to the wrong
// franchise; safer to leave pick_team_id null (pick_team_name still keeps
// the raw abbreviation text) than to guess wrong.
function buildAbbrIndex($: cheerio.CheerioAPI, rows: ReturnType<cheerio.CheerioAPI>): Map<string, number> {
  const seen = new Map<string, Set<number>>();
  rows.each((_, el) => {
    const cells = $(el).find("> td");
    [1, 3].forEach((idx) => {
      const cell = $(cells[idx]);
      const abbr = cell.attr("data-name");
      if (!abbr) return;
      const href = cell.find('a[href^="/thebigleague/team/"]').first().attr("href");
      const m = href?.match(/\/team\/(\d+)/);
      if (!m) return;
      const id = Number(m[1]);
      if (!seen.has(abbr)) seen.set(abbr, new Set());
      seen.get(abbr)!.add(id);
    });
  });
  const index = new Map<string, number>();
  for (const [abbr, ids] of seen) {
    if (ids.size === 1) index.set(abbr, [...ids][0]);
  }
  return index;
}

async function main() {
  const supabase = makeSupabaseClient();
  const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL! });

  console.log("Fetching the full trade ledger (/trade/#recent)...");
  const html = await sp.tradeLedgerHtml("recent");
  const $ = cheerio.load(`<table><tbody>${html}</tbody></table>`);
  const rows = $("tr");
  console.log(`  ${rows.length} trades in the ledger`);

  const abbrToTeamId = buildAbbrIndex($, rows);

  const parsed: ParsedTrade[] = [];
  rows.each((i, rowEl) => {
    const $row = $(rowEl);
    const cells = $row.find("> td");
    if (cells.length < 6) return; // defensive -- not a real trade row
    const dateText = $(cells[0]).text().trim();
    let tradeDate: string;
    try {
      tradeDate = parseTradeDate(dateText);
    } catch (err) {
      console.warn(`  row ${i}, "${dateText}": ${err}`);
      return;
    }
    const teamA = extractTeamRef($(cells[1]));
    const itemsA = parseSentCell($, $(cells[2]), abbrToTeamId, `row ${i} / ${dateText} / side A`);
    const teamB = extractTeamRef($(cells[3]));
    const itemsB = parseSentCell($, $(cells[4]), abbrToTeamId, `row ${i} / ${dateText} / side B`);
    const statusText = $(cells[5]).text().trim();
    const status = statusText === "Pending" ? "pending" : "complete";
    parsed.push({ tradeDate, status, teamA, teamB, itemsA, itemsB });
  });
  console.log(`  ${parsed.length} rows parsed successfully`);

  // Normalize each trade onto a stable (lo, hi) team order so re-scraping
  // later reproduces the identical key even if the source ever swapped
  // which side it renders first. 31 real (date, team-pair) combos in this
  // ledger have more than one distinct trade on file (e.g. two separate
  // Carolina/St. Louis deals on the same day) -- disambiguated by position
  // within that group, in the ledger's own fetch order. Confirmed this
  // order is byte-identical across two independent fetches, so this is
  // stable across re-scrapes as long as the source doesn't reorder
  // historical rows relative to each other (new trades only ever append).
  const sortKey = (t: TeamRef) => (t.id !== null ? `id:${t.id}` : `name:${t.name}`);
  const groupCounts = new Map<string, number>();
  const keyed = parsed.map((trade) => {
    const [lo, hi] = sortKey(trade.teamA) <= sortKey(trade.teamB) ? [trade.teamA, trade.teamB] : [trade.teamB, trade.teamA];
    const [itemsLo, itemsHi] = lo === trade.teamA ? [trade.itemsA, trade.itemsB] : [trade.itemsB, trade.itemsA];
    const baseKey = `${trade.tradeDate}|${sortKey(lo)}|${sortKey(hi)}`;
    const occurrence = groupCounts.get(baseKey) ?? 0;
    groupCounts.set(baseKey, occurrence + 1);
    return { key: `${baseKey}|${occurrence}`, tradeDate: trade.tradeDate, status: trade.status, teamA: lo, teamB: hi, itemsA: itemsLo, itemsB: itemsHi };
  });

  console.log("Writing to trade_events / trade_event_items...");
  let written = 0;
  for (const trade of keyed) {
    const { data: eventRow, error: upsertErr } = await supabase.from("trade_events")
      .upsert({
        trade_key: trade.key, trade_date: trade.tradeDate, status: trade.status,
        team_a_id: trade.teamA.id, team_a_name: trade.teamA.name,
        team_b_id: trade.teamB.id, team_b_name: trade.teamB.name,
      } as never, { onConflict: "trade_key" })
      .select("id").single();
    if (upsertErr || !eventRow) {
      console.warn(`Failed to upsert trade_events for ${trade.key}: ${upsertErr?.message}`);
      continue;
    }
    const tradeEventId = (eventRow as { id: number }).id;
    // Replace this trade's items wholesale rather than diffing -- a real
    // trade's contents never change after the fact, and this keeps re-runs
    // idempotent without needing to track what was there before.
    await supabase.from("trade_event_items").delete().eq("trade_event_id", tradeEventId);
    const toRow = (side: "a" | "b", item: TradeItem) => {
      if (item.kind === "player") return { trade_event_id: tradeEventId, side, player_id: item.playerId, retained_salary_pct: item.retainedSalaryPct };
      if (item.kind === "cash") return { trade_event_id: tradeEventId, side, cash_amount: item.cashAmount };
      return { trade_event_id: tradeEventId, side, pick_year: item.pickYear, pick_round: item.pickRound, pick_team_id: item.pickTeamId, pick_team_name: item.pickTeamAbbr };
    };
    const itemRows = [
      ...trade.itemsA.map((i) => toRow("a", i)),
      ...trade.itemsB.map((i) => toRow("b", i)),
    ];
    if (itemRows.length > 0) {
      const { error: itemsErr } = await supabase.from("trade_event_items").insert(itemRows as never[]);
      if (itemsErr) {
        console.warn(`Failed to insert items for trade ${tradeEventId} (${trade.key}): ${itemsErr.message}`);
        continue;
      }
    }
    written++;
    if (written % 100 === 0) console.log(`  ...${written}/${keyed.length} trades written`);
  }

  console.log(`Done. ${written} trades written.`);
}

main().catch((err) => {
  console.error("scrape-trade-history failed:", err);
  process.exit(1);
});
