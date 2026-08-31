import "dotenv/config";
import * as cheerio from "cheerio";
import { makeStatsPlusClient } from "../lib/statsplus-client.js";
import { makeSupabaseClient } from "../lib/supabase-client.js";

// Phase 2 of the transaction-history/market-analysis work (2026-08-31,
// Rees's ask). Scrapes real trade transaction history for every player
// who's ever been traded -- scoped to `players.was_traded = true` (276
// players as of this writing), NOT the full ~45,684-player universe that
// got this idea shelved back on 2026-08-19 as "~19 hours, needs real
// scope." That verdict was correct for the ORIGINAL ask (every player's
// acquisition history), but trade history specifically only matters for
// players who were actually traded -- and `was_traded` is already a real,
// bulk-ingested field, so the true scope here is tiny: ~7 minutes at the
// existing polite throttle, not 19 hours.
//
// The same real trade appears on EVERY involved player's own trade-history
// page -- a 3-for-1 deal shows up 4 times across this scrape (once per
// player, since all of them have was_traded=true). Deduping that back down
// to one row per real trade (see buildTradeKey below) is the main thing
// this script has to get right.

// Confirmed two real date formats in the wild while running this against
// the full 276-player set, not just the one full-month-name example checked
// beforehand ("July 10, 2028"): older trades render as an abbreviated
// month with a period ("Aug. 1, 2022", "Dec. 31, 2027", "Feb. 16, 2026").
// Keyed on the lowercased form (with or without the trailing period
// stripped) so one map covers both.
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

// Most team cells link to a real team page (`<a href="/thebigleague/
// team/{id}">Name (ABV)</a>`), but a real trade as far back as 2022
// (confirmed in production: a "Durham" team/affiliate) renders as plain,
// unlinked text -- that franchise/affiliate no longer exists under any id
// in today's `teams` table, so StatsPlus has nothing to link to. id is
// null in that case; name (the raw cell text, whatever it says) is always
// populated either way, so historical trades involving a now-defunct team
// still get recorded instead of silently dropped or crashing the run.
function extractTeamRef(cell: ReturnType<cheerio.CheerioAPI>): TeamRef {
  const link = cell.find('a[href^="/thebigleague/team/"]').first();
  const href = link.attr("href");
  if (href) {
    const m = href.match(/\/team\/(\d+)/);
    if (m) return { id: Number(m[1]), name: link.text().trim() };
  }
  return { id: null, name: cell.text().trim() };
}

interface TradeItem { playerId: number | null; cashAmount: number | null }

// Confirmed several real cash formats while running this against the full
// 276-player set, not just the one plain "$5,700,000" example checked
// beforehand: a trailing " cash" word ("$1 cash"), and k/M magnitude
// suffixes ("$316k", "$30M cash"). Handles all of them; returns null (not
// 0) for genuinely unparseable text so the caller can tell "real cash
// amount, possibly $0-ish" apart from "this wasn't cash at all."
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

// Each direct-child `.tt-text-row-height` div of a "Sent" cell is one item:
// either a player (identifiable by a nested a[data-player-id]) or a plain
// cash amount, no player link at all. Anything that matches NEITHER shape
// (e.g. a traded draft pick, never confirmed in a real example while
// building this) is logged loudly, not silently dropped -- better to
// notice a real gap than quietly lose part of a trade's contents.
function parseSentCell($: cheerio.CheerioAPI, cell: ReturnType<cheerio.CheerioAPI>, context: string): TradeItem[] {
  const items: TradeItem[] = [];
  cell.children(".tt-text-row-height").each((_, el) => {
    const $el = $(el);
    const playerIdAttr = $el.find("a[data-player-id]").first().attr("data-player-id");
    if (playerIdAttr) {
      items.push({ playerId: Number(playerIdAttr), cashAmount: null });
      return;
    }
    const text = $el.text().trim();
    const cashAmount = text ? parseCashAmount(text) : null;
    if (cashAmount !== null) {
      items.push({ playerId: null, cashAmount });
      return;
    }
    if (text) console.warn(`  [unrecognized trade item, skipped] ${context}: "${text}"`);
  });
  return items;
}

// Normalizes to a stable (lo, hi) team order so the SAME real trade
// resolves to the identical key no matter which involved player's page
// (and therefore which team happened to render as the "left" column) it
// was scraped from. Sorts on a string form of each side (id-based when a
// real id exists, name-based for an unlinked/defunct team) rather than a
// raw numeric compare, since one or both sides can be id: null.
//
// Deliberately does NOT fold item content (players/cash) into the key
// itself, unlike an earlier version of this script -- that seemed like a
// reasonable way to distinguish two hypothetical same-day trades between
// the same two teams, but it made the key unstable across parser fixes: a
// bug that dropped one cash item changed the key for that trade, so
// re-running the (now-fixed) script created a second row instead of
// correcting the first one -- confirmed happening for real (4 orphaned
// rows) the first time a parsing gap got fixed after data had already been
// written. (date, team pair) alone can in principle merge two genuinely
// separate trades between the same two teams on the same calendar day into
// one row -- not observed in this league's real data, and a far smaller
// risk than silently accumulating stale duplicates every time parsing
// improves.
function buildTradeKey(tradeDate: string, teamA: TeamRef, teamB: TeamRef, itemsA: TradeItem[], itemsB: TradeItem[]) {
  const sortKey = (t: TeamRef) => (t.id !== null ? `id:${t.id}` : `name:${t.name}`);
  const [lo, hi] = sortKey(teamA) <= sortKey(teamB) ? [teamA, teamB] : [teamB, teamA];
  const [itemsLo, itemsHi] = lo === teamA ? [itemsA, itemsB] : [itemsB, itemsA];
  return {
    key: `${tradeDate}|${sortKey(lo)}|${sortKey(hi)}`,
    teamA: lo, teamB: hi, itemsA: itemsLo, itemsB: itemsHi,
  };
}

interface ParsedTrade { tradeDate: string; teamA: TeamRef; teamB: TeamRef; itemsA: TradeItem[]; itemsB: TradeItem[] }

async function main() {
  const supabase = makeSupabaseClient();
  const sp = makeStatsPlusClient({ baseUrl: process.env.STATSPLUS_BASE_URL! });

  console.log("Finding players who have ever been traded (players.was_traded = true)...");
  const { data, error } = await supabase.from("players").select("id").eq("was_traded", true);
  if (error) throw error;
  const playerIds = (data as { id: number }[]).map((r) => r.id);
  console.log(`  ${playerIds.length} players to check`);

  const tradesByKey = new Map<string, ParsedTrade>();
  let processed = 0;
  let fetchFailures = 0;

  for (const playerId of playerIds) {
    processed++;
    let html: string;
    try {
      html = await sp.playerTradeHistoryHtml(playerId);
    } catch (err) {
      fetchFailures++;
      console.warn(`  [${processed}/${playerIds.length}] player ${playerId}: fetch failed, skipping -- ${err}`);
      continue;
    }
    const $ = cheerio.load(html);
    const rows = $("table.playertrade tbody tr");
    rows.each((_, rowEl) => {
      const $row = $(rowEl);
      const cells = $row.find("> td");
      if (cells.length < 5) return; // defensive -- not a real trade row
      const dateText = $(cells[0]).text().trim();
      if (!dateText) return;
      let tradeDate: string;
      try {
        tradeDate = parseTradeDate(dateText);
      } catch (err) {
        console.warn(`  player ${playerId}, row "${dateText}": ${err}`);
        return;
      }
      const teamA = extractTeamRef($(cells[1]));
      const itemsA = parseSentCell($, $(cells[2]), `player ${playerId} / ${dateText} / side A`);
      const teamB = extractTeamRef($(cells[3]));
      const itemsB = parseSentCell($, $(cells[4]), `player ${playerId} / ${dateText} / side B`);
      const { key, ...trade } = buildTradeKey(tradeDate, teamA, teamB, itemsA, itemsB);
      if (!tradesByKey.has(key)) tradesByKey.set(key, { tradeDate, ...trade });
    });
    if (processed % 25 === 0) console.log(`  ...${processed}/${playerIds.length} players checked, ${tradesByKey.size} distinct trades so far`);
  }

  console.log(`Found ${tradesByKey.size} distinct trades across ${playerIds.length} players (${fetchFailures} fetch failures).`);

  console.log("Writing to trade_events / trade_event_items...");
  let written = 0;
  for (const [key, trade] of tradesByKey) {
    const { data: eventRow, error: upsertErr } = await supabase.from("trade_events")
      .upsert({
        trade_key: key, trade_date: trade.tradeDate,
        team_a_id: trade.teamA.id, team_a_name: trade.teamA.name,
        team_b_id: trade.teamB.id, team_b_name: trade.teamB.name,
      } as never, { onConflict: "trade_key" })
      .select("id").single();
    if (upsertErr || !eventRow) {
      console.warn(`Failed to upsert trade_events for ${key}: ${upsertErr?.message}`);
      continue;
    }
    const tradeEventId = (eventRow as { id: number }).id;
    // Replace this trade's items wholesale rather than trying to diff them --
    // a re-run is idempotent this way, and a trade's real contents never
    // change after the fact (unlike a stats snapshot, which legitimately
    // gets superseded by a later refresh).
    await supabase.from("trade_event_items").delete().eq("trade_event_id", tradeEventId);
    const itemRows = [
      ...trade.itemsA.map((i) => ({ trade_event_id: tradeEventId, side: "a", player_id: i.playerId, cash_amount: i.cashAmount })),
      ...trade.itemsB.map((i) => ({ trade_event_id: tradeEventId, side: "b", player_id: i.playerId, cash_amount: i.cashAmount })),
    ];
    if (itemRows.length > 0) {
      const { error: itemsErr } = await supabase.from("trade_event_items").insert(itemRows as never[]);
      if (itemsErr) {
        console.warn(`Failed to insert items for trade ${tradeEventId} (${key}): ${itemsErr.message}`);
        continue;
      }
    }
    written++;
  }

  console.log(`Done. ${written} trades written.`);
}

main().catch((err) => {
  console.error("scrape-trade-history failed:", err);
  process.exit(1);
});
