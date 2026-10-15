import "dotenv/config";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";
import { assignmentProbabilities } from "../lib/draft-pick-inference.js";

// Most-lopsided-trades engine (2026-10-14, Rees's ask) -- writes one row per COMPLETED trade to trade_war_results; the
// /lopsided-trades page shows the top 20 by margin. Full method + caveats are in HANDOFF.md ("Lopsided trades page").
//
// Short version of the method:
//  * VALUE = WAR (batting + pitching, MLB level, overall split) that an asset produced FOR THE TEAM THAT RECEIVED IT, from the
//    trade year onward, through the latest season on file. `player_*_stats_snapshots` carry team_id + stint per season, so a
//    player's WAR with the acquiring team is exact and stops the moment he leaves that team.
//  * A DRAFT PICK's value = the WAR of the player it became, for the team that used the pick (players.draft_team_id), from the
//    draft year on. Picks are traced to players like this:
//      - rounds 2-28: the draft order is the same every round, so an original owner's slot is the mode of the draft_pick
//        numbers it picked at (checked 2030: ~22-28 of 28 rounds at one slot per team) -> player at (year, round, slot);
//      - round 1 is a LOTTERY (a team's round-1 slot differs from its other rounds in 608 of 672 team-years), so slots can't
//        be inferred. Instead the pick is followed through its trade chain to the team that finally held it; if that team made
//        exactly one round-1 pick that year the player is exact, otherwise the pick is one of N candidate players and the
//        average WAR of those candidates is used and flagged.
//        Since 2026-10-15 the 'several candidates' case is narrowed with lib/draft-pick-inference.ts: among the picks one holder made,
//        owners are matched to slots by how close each owner's later-round slot is to the slot (calibrated on known cases: stated
//        90%+ confidence is right ~96% of the time). The expected WAR over those probabilities is used, flagged 'likely'.
//    Picks for drafts that have not happened yet carry 0 and are flagged "not yet drafted".
//  * lopsidedness (margin) = |WAR received by A - WAR received by B|. Older trades have had longer to pay off, so the
//    horizon is "through the present", not a fixed number of years -- the page says so.

const PAGE = 1000;
const REAL_MLB_LEVEL_ID = 1;
const OVERALL_SPLIT_ID = 1;
const FIRST_SEASON = 2001;

async function fetchAll<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

interface EventRow { id: number; trade_date: string; team_a_id: number; team_b_id: number; team_a_name: string | null; team_b_name: string | null }
interface ItemRow { trade_event_id: number; side: string; player_id: number | null; pick_year: number | null; pick_round: number | null; pick_team_id: number | null; pick_team_name: string | null; cash_amount: number | null }
interface PlayerRow { id: number; first_name: string | null; last_name: string | null; pos: number | null; role: number | null; draft_year: number | null; draft_round: number | null; draft_pick: number | null; draft_overall_pick: number | null; draft_team_id: number | null; draft_supplemental: boolean | null }

// OOTP numbering: pos 1 = pitcher (role 11 SP / 12 RP / 13 closer), 2 C, 3 1B, 4 2B, 5 3B, 6 SS, 7 LF, 8 CF, 9 RF, 10 DH.
const POS: Record<number, string> = { 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF", 10: "DH" };
function posLabel(pos: number | null, role: number | null): string {
  if (pos === 1) return role === 12 ? "RP" : role === 13 ? "CL" : "SP";
  return (pos != null && POS[pos]) || "—";
}
const nameOf = (p: PlayerRow | undefined, id: number) => (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "") || `Player ${id}`;

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());

  console.log("Loading completed trades and their items...");
  const events = await fetchAll<EventRow>((from, to) => supabase.from("trade_events")
    .select("id,trade_date,team_a_id,team_b_id,team_a_name,team_b_name").eq("dsa_league_id", leagueId).eq("status", "complete").order("id").range(from, to) as never);
  const eventIds = new Set(events.map((e) => Number(e.id)));
  const items = (await fetchAll<ItemRow>((from, to) => supabase.from("trade_event_items")
    .select("id,trade_event_id,side,player_id,pick_year,pick_round,pick_team_id,pick_team_name,cash_amount").eq("dsa_league_id", leagueId).order("id").range(from, to) as never))
    .filter((i) => eventIds.has(Number(i.trade_event_id)));
  console.log(`  ${events.length} trades, ${items.length} items`);
  const eventById = new Map(events.map((e) => [Number(e.id), e]));

  // 123 traded picks carry only an abbreviation ("BOS" / "NY") and no team id: those two codes were each used by two different
  // franchises over the years, so the scraper left the id blank. Resolve by era -- which franchise was labelled with that
  // abbreviation around the trade date -- using the team labels on the trade events themselves.
  const labelHistory = new Map<number, { date: string; abbr: string }[]>();
  for (const e of events) {
    for (const [id, label] of [[e.team_a_id, e.team_a_name], [e.team_b_id, e.team_b_name]] as const) {
      const m = (label ?? "").match(/\(([^)]+)\)\s*$/);
      if (!m) continue;
      const arr = labelHistory.get(Number(id)) ?? [];
      arr.push({ date: e.trade_date, abbr: m[1].trim() });
      labelHistory.set(Number(id), arr);
    }
  }
  function abbrAt(teamId: number, date: string): string | null {
    const hist = (labelHistory.get(teamId) ?? []).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    if (hist.length === 0) return null;
    let pick = hist[0];
    for (const h of hist) { if (h.date <= date) pick = h; else break; }
    return pick.abbr;
  }
  let abbrResolved = 0;
  function ownerOf(it: { pick_team_id: number | null; pick_team_name: string | null }, date: string): number | null {
    if (it.pick_team_id != null) return Number(it.pick_team_id);
    if (!it.pick_team_name) return null;
    const matches = [...labelHistory.keys()].filter((id) => abbrAt(id, date) === it.pick_team_name);
    if (matches.length === 1) { abbrResolved++; return matches[0]; }
    return null;
  }

  const { data: runRow, error: runErr } = await supabase.from("refresh_runs").select("id,game_date").eq("dsa_league_id", leagueId).eq("status", "succeeded").order("id", { ascending: false }).limit(1).single();
  if (runErr || !runRow) throw new Error(`No refresh_runs found: ${runErr?.message}`);
  const currentYear = Number(((runRow as { game_date: string }).game_date ?? "").slice(0, 4));
  console.log(`  current in-game year ${currentYear}`);

  // --- players: everyone drafted since 2001 (to resolve picks) + everyone named in a trade ---
  console.log("Loading drafted players...");
  const drafted = await fetchAll<PlayerRow>((from, to) => supabase.from("players")
    .select("id,first_name,last_name,pos,role,draft_year,draft_round,draft_pick,draft_overall_pick,draft_team_id,draft_supplemental")
    .eq("dsa_league_id", leagueId).gte("draft_year", FIRST_SEASON).gte("draft_round", 1).order("id").range(from, to) as never);
  const playerById = new Map<number, PlayerRow>(drafted.map((p) => [Number(p.id), p]));
  const tradePlayerIds = [...new Set(items.filter((i) => i.player_id != null).map((i) => Number(i.player_id)))].filter((id) => !playerById.has(id));
  for (let i = 0; i < tradePlayerIds.length; i += 400) {
    const chunk = tradePlayerIds.slice(i, i + 400);
    const { data, error } = await supabase.from("players")
      .select("id,first_name,last_name,pos,role,draft_year,draft_round,draft_pick,draft_overall_pick,draft_team_id,draft_supplemental")
      .eq("dsa_league_id", leagueId).in("id", chunk);
    if (error) throw error;
    for (const p of data as PlayerRow[]) playerById.set(Number(p.id), p);
  }
  console.log(`  ${drafted.length} drafted players, ${playerById.size} players loaded in total`);

  // --- WAR by player / team / season (latest run that has each season) ---
  async function latestRunForYear(table: "player_batting_stats_snapshots" | "player_pitching_stats_snapshots", year: number): Promise<number | null> {
    const { data } = await supabase.from(table).select("refresh_run_id").eq("dsa_league_id", leagueId).eq("year", year)
      .eq("level_id", REAL_MLB_LEVEL_ID).eq("split_id", OVERALL_SPLIT_ID).order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
    return (data as { refresh_run_id: number } | null)?.refresh_run_id ?? null;
  }
  console.log(`Sweeping MLB WAR ${FIRST_SEASON}-${currentYear}...`);
  const warRows = new Map<number, { team: number; year: number; war: number }[]>(); // player -> per team/season WAR
  const addWar = (pid: number, team: number, year: number, war: number | null) => {
    if (war == null || !Number.isFinite(Number(war))) return;
    const arr = warRows.get(pid) ?? [];
    arr.push({ team, year, war: Number(war) });
    warRows.set(pid, arr);
  };
  for (let year = FIRST_SEASON; year <= currentYear; year++) {
    for (const table of ["player_batting_stats_snapshots", "player_pitching_stats_snapshots"] as const) {
      const run = await latestRunForYear(table, year);
      if (run == null) continue;
      const rows = await fetchAll<{ player_id: number; team_id: number; war: number | null }>((from, to) => supabase.from(table)
        .select("id,player_id,team_id,war").eq("dsa_league_id", leagueId).eq("refresh_run_id", run).eq("year", year)
        .eq("level_id", REAL_MLB_LEVEL_ID).eq("split_id", OVERALL_SPLIT_ID).order("id").range(from, to) as never);
      for (const r of rows) addWar(Number(r.player_id), Number(r.team_id), year, r.war);
    }
    if (year % 5 === 0 || year === currentYear) console.log(`  ...through ${year}`);
  }
  // WAR a player produced for `team` from `fromYear` on, and the seasons that covers.
  function warFor(pid: number, team: number, fromYear: number): { war: number; first: number | null; last: number | null } {
    let war = 0, first: number | null = null, last: number | null = null;
    for (const r of warRows.get(pid) ?? []) {
      if (r.team !== team || r.year < fromYear) continue;
      war += r.war;
      if (first === null || r.year < first) first = r.year;
      if (last === null || r.year > last) last = r.year;
    }
    return { war, first, last };
  }

  // --- draft indexes ---
  const draftedYears = new Set(drafted.map((p) => Number(p.draft_year)));
  const bySlot = new Map<string, PlayerRow>();      // year|round|slot -> player
  const byHolder = new Map<string, PlayerRow[]>();  // year|round|draft_team_id -> players
  const slotVotes = new Map<string, Map<number, number>>(); // year|team -> slot -> count over rounds >= 2
  for (const p of drafted) {
    if (p.draft_supplemental || p.draft_pick == null || p.draft_team_id == null) continue;
    const y = Number(p.draft_year), r = Number(p.draft_round), t = Number(p.draft_team_id), s = Number(p.draft_pick);
    bySlot.set(`${y}|${r}|${s}`, p);
    const hk = `${y}|${r}|${t}`;
    const list = byHolder.get(hk) ?? [];
    list.push(p);
    byHolder.set(hk, list);
    if (r >= 2) {
      const votes = slotVotes.get(`${y}|${t}`) ?? new Map<number, number>();
      votes.set(s, (votes.get(s) ?? 0) + 1);
      slotVotes.set(`${y}|${t}`, votes);
    }
  }
  function modalSlot(year: number, team: number): number | null {
    const votes = slotVotes.get(`${year}|${team}`);
    if (!votes) return null;
    let best: number | null = null, bestN = 0, second = 0;
    for (const [slot, n] of votes) {
      if (n > bestN) { second = bestN; best = slot; bestN = n; } else if (n > second) second = n;
    }
    return bestN >= 3 && bestN > second ? best : null;
  }

  // --- pick chains: who finally held each (year, round, original owner) pick ---
  const pickMoves = new Map<string, { date: string; tradeId: number; from: number; to: number }[]>();
  for (const it of items) {
    if (it.pick_year == null || it.pick_round == null) continue;
    const e = eventById.get(Number(it.trade_event_id))!;
    const owner = ownerOf(it, e.trade_date);
    if (owner == null) continue;
    const from = it.side === "a" ? Number(e.team_a_id) : Number(e.team_b_id);
    const to = it.side === "a" ? Number(e.team_b_id) : Number(e.team_a_id);
    const key = `${it.pick_year}|${it.pick_round}|${owner}`;
    const moves = pickMoves.get(key) ?? [];
    moves.push({ date: e.trade_date, tradeId: Number(e.id), from, to });
    pickMoves.set(key, moves);
  }
  function finalHolder(year: number, round: number, owner: number): number {
    let holder = owner;
    const moves = (pickMoves.get(`${year}|${round}|${owner}`) ?? []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.tradeId - b.tradeId));
    for (const m of moves) if (m.from === holder) holder = m.to;
    return holder;
  }

  // Owners of round-1 picks by draft year: everyone who drafted in round 1 plus every original owner named in a round-1 trade. The
  // owners whose pick ended with one holder are the candidates for that holder's round-1 selections.
  const r1Pool = new Map<number, Set<number>>();
  const addOwner = (y: number, t: number) => { const set = r1Pool.get(y) ?? new Set<number>(); set.add(t); r1Pool.set(y, set); };
  for (const p of drafted) if (Number(p.draft_round) === 1 && !p.draft_supplemental && p.draft_team_id != null) addOwner(Number(p.draft_year), Number(p.draft_team_id));
  for (const key of pickMoves.keys()) { const [y, r, o] = key.split("|").map(Number); if (r === 1) addOwner(y, o); }
  const groupOwners = (year: number, holder: number): number[] => [...(r1Pool.get(year) ?? [])].filter((x) => finalHolder(year, 1, x) === holder);

  type PickPlayer = { playerId: number; name: string; pos: string; overallPick: number | null; war: number; draftedByTeamId: number; probability?: number };
  type PickResolution = { resolution: "exact" | "likely" | "candidates" | "undrafted" | "unresolved"; players: PickPlayer[]; war: number; credited: boolean; finalHolderId: number | null; reason?: string };
  const stats = { exact: 0, likely: 0, candidates: 0, undrafted: 0, unresolved: 0, retraded: 0, holderMismatch: 0, noOwner: 0, noDraftData: 0 };
  // Wraps resolveRaw: a pick's WAR is credited ONLY to the team that finally used it (per the trade chain). A team that received a
  // pick and flipped it on gets nothing here -- the later trade carries the value -- so one pick is never counted in two trades.
  function resolvePick(year: number, round: number, owner: number | null, receivingTeam: number): PickResolution {
    const r = resolveRaw(year, round, owner);
    const holder = owner != null ? finalHolder(year, round, owner) : null;
    if (r.resolution === "undrafted" || r.resolution === "unresolved") return { ...r, credited: true, finalHolderId: holder };
    if (holder !== null && holder !== receivingTeam) {
      stats.retraded++;
      return { ...r, war: 0, credited: false, finalHolderId: holder };
    }
    if (r.players.length === 1 && holder !== null && r.players[0].draftedByTeamId !== holder) stats.holderMismatch++;
    return { ...r, credited: true, finalHolderId: holder };
  }
  function resolveRaw(year: number, round: number, owner: number | null): { resolution: "exact" | "likely" | "candidates" | "undrafted" | "unresolved"; players: PickPlayer[]; war: number; reason?: string } {
    const toPickPlayer = (p: PlayerRow): PickPlayer => {
      const team = Number(p.draft_team_id);
      const w = warFor(Number(p.id), team, Number(p.draft_year)).war;
      return { playerId: Number(p.id), name: nameOf(p, Number(p.id)), pos: posLabel(p.pos, p.role), overallPick: p.draft_overall_pick, war: w, draftedByTeamId: team };
    };
    if (!draftedYears.has(year)) { stats.undrafted++; return { resolution: "undrafted", players: [], war: 0 }; }
    if (owner == null) { stats.unresolved++; stats.noOwner++; return { resolution: "unresolved", players: [], war: 0, reason: "original owner unknown" }; }
    if (round >= 2) {
      const slot = modalSlot(year, owner);
      const p = slot != null ? bySlot.get(`${year}|${round}|${slot}`) : undefined;
      if (p) { stats.exact++; const pp = toPickPlayer(p); return { resolution: "exact", players: [pp], war: pp.war }; }
    }
    // Round 1 (lottery) or no usable slot: follow the trade chain to the final holder.
    const holder = finalHolder(year, round, owner);
    const candidates = byHolder.get(`${year}|${round}|${holder}`) ?? [];
    if (candidates.length === 1) { stats.exact++; const pp = toPickPlayer(candidates[0]); return { resolution: "exact", players: [pp], war: pp.war }; }
    if (candidates.length > 1) {
      // Round 1: who among this holder's picks was THIS owner's? Weigh every owner->slot assignment by how close each owner's
      // later-round slot is to the slot (see lib/draft-pick-inference.ts).
      if (round === 1) {
        const owners = groupOwners(year, holder);
        const idx = owners.indexOf(owner);
        if (idx >= 0 && owners.length === candidates.length) {
          const probs = assignmentProbabilities(owners.map((o) => modalSlot(year, o)), candidates.map((p) => Number(p.draft_pick)));
          if (probs) {
            stats.likely++;
            const pps = candidates.map((p, j) => ({ ...toPickPlayer(p), probability: probs[idx][j] })).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
            return { resolution: "likely", players: pps, war: pps.reduce((a, b) => a + b.war * (b.probability ?? 0), 0) };
          }
        }
      }
      stats.candidates++;
      const pps = candidates.map(toPickPlayer);
      return { resolution: "candidates", players: pps, war: pps.reduce((a, b) => a + b.war, 0) / pps.length };
    }
    stats.unresolved++;
    stats.noDraftData++;
    return { resolution: "unresolved", players: [], war: 0, reason: "draft class incomplete in our player data" };
  }

  // --- assemble each trade ---
  type Asset =
    | { kind: "player"; playerId: number; name: string; pos: string; war: number; firstYear: number | null; lastYear: number | null }
    | { kind: "pick"; year: number; round: number; originalTeamId: number | null; originalTeamLabel: string | null; resolution: string; players: PickPlayer[]; war: number; credited: boolean; finalHolderId: number | null; reason?: string }
    | { kind: "cash"; amount: number };
  const itemsByEvent = new Map<number, ItemRow[]>();
  for (const it of items) {
    const arr = itemsByEvent.get(Number(it.trade_event_id)) ?? [];
    arr.push(it);
    itemsByEvent.set(Number(it.trade_event_id), arr);
  }

  const out: Record<string, unknown>[] = [];
  for (const e of events) {
    const tradeYear = Number(e.trade_date.slice(0, 4));
    const its = itemsByEvent.get(Number(e.id)) ?? [];
    if (its.length === 0) continue;
    const buildSide = (receivingTeam: number, sentBySide: "a" | "b") => {
      const assets: Asset[] = [];
      let war = 0;
      for (const it of its.filter((x) => x.side === sentBySide)) {
        if (it.player_id != null) {
          const pid = Number(it.player_id);
          const w = warFor(pid, receivingTeam, tradeYear);
          const p = playerById.get(pid);
          war += w.war;
          assets.push({ kind: "player", playerId: pid, name: nameOf(p, pid), pos: posLabel(p?.pos ?? null, p?.role ?? null), war: w.war, firstYear: w.first, lastYear: w.last });
        } else if (it.pick_year != null && it.pick_round != null) {
          const owner = ownerOf(it, e.trade_date);
          const r = resolvePick(Number(it.pick_year), Number(it.pick_round), owner, receivingTeam);
          war += r.war;
          assets.push({ kind: "pick", year: Number(it.pick_year), round: Number(it.pick_round), originalTeamId: owner, originalTeamLabel: it.pick_team_name, resolution: r.resolution, players: r.players, war: r.war, credited: r.credited, finalHolderId: r.finalHolderId, reason: r.reason });
        } else if (it.cash_amount != null && Number(it.cash_amount) > 0) {
          assets.push({ kind: "cash", amount: Number(it.cash_amount) });
        }
      }
      return { assets, war };
    };
    const aTeam = Number(e.team_a_id), bTeam = Number(e.team_b_id);
    const a = buildSide(aTeam, "b"); // team A receives what side B sent
    const b = buildSide(bTeam, "a");
    if (a.assets.length === 0 && b.assets.length === 0) continue;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    out.push({
      dsa_league_id: leagueId,
      trade_event_id: Number(e.id),
      trade_date: e.trade_date,
      team_a_id: aTeam,
      team_b_id: bTeam,
      war_a: round2(a.war),
      war_b: round2(b.war),
      margin: round2(Math.abs(a.war - b.war)),
      winner_team_id: a.war === b.war ? null : a.war > b.war ? aTeam : bTeam,
      has_pick: [...a.assets, ...b.assets].some((x) => x.kind === "pick"),
      details: {
        yearsSince: Math.max(0, currentYear - tradeYear),
        a: { teamId: aTeam, teamLabel: e.team_a_name, war: round2(a.war), receives: a.assets },
        b: { teamId: bTeam, teamLabel: e.team_b_name, war: round2(b.war), receives: b.assets },
      },
    });
  }
  console.log(`Picks: ${abbrResolved} owners resolved from an abbreviation; ${stats.exact} exact, ${stats.likely} round-1 'likely' (probability-weighted), ${stats.candidates} among plain candidates, ${stats.undrafted} not yet drafted, ${stats.unresolved} unresolved (${stats.noOwner} no owner, ${stats.noDraftData} draft data missing); ${stats.retraded} re-traded before the draft (not credited); ${stats.holderMismatch} exact picks whose drafting team differs from the trade chain's final holder`);

  out.sort((x, y) => (y.margin as number) - (x.margin as number));
  console.log("\nTop 25 by margin:");
  for (const r of out.slice(0, 25)) {
    const d = r.details as { a: { teamLabel: string; war: number; receives: Asset[] }; b: { teamLabel: string; war: number; receives: Asset[] } };
    const desc = (s: typeof d.a) => s.receives.map((x) => x.kind === "player" ? `${x.name} (${x.pos}) ${x.war.toFixed(1)}` : x.kind === "pick" ? `${x.year} R${x.round}${!x.credited ? " [re-traded, not credited]" : x.resolution === "exact" ? ` -> ${x.players[0].name} ${x.war.toFixed(1)}` : x.resolution === "likely" ? ` ~> ${x.players.map((p) => `${p.name} ${Math.round((p.probability ?? 0) * 100)}%`).join(" / ")} = ${x.war.toFixed(1)}` : ` [${x.resolution}] ${x.war.toFixed(1)}`}` : `cash`).join("; ");
    console.log(`${r.trade_date} margin ${(r.margin as number).toFixed(1)} | ${d.a.teamLabel} got [${desc(d.a)}] = ${d.a.war.toFixed(1)} | ${d.b.teamLabel} got [${desc(d.b)}] = ${d.b.war.toFixed(1)}`);
  }

  console.log(`\nWriting ${out.length} rows to trade_war_results...`);
  for (let i = 0; i < out.length; i += 40) {
    const batch = out.slice(i, i + 40) as never[];
    let lastErr = "";
    let ok = false;
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      try {
        const { error } = await supabase.from("trade_war_results").upsert(batch, { onConflict: "dsa_league_id,trade_event_id" });
        if (!error) { ok = true; break; }
        lastErr = error.message;
      } catch (err) {
        lastErr = String(err);
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    if (!ok) throw new Error(`trade_war_results upsert failed (rows ${i}-${i + batch.length}): ${lastErr}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error("compute-lopsided-trades failed:", err);
  process.exit(1);
});
