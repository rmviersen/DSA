import "dotenv/config";
import { writeFileSync } from "node:fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";
import { getLeagueId, leagueSlugFromArgv } from "../lib/league.js";
import { getSystemRankingsDetailed } from "../lib/system-rankings-query.js";
import { effectiveLevel, levelLabel } from "../lib/display-helpers.js";

// Fact sheet for writing/refreshing the Farm Rankings write-ups (2026-09-18,
// Rees's ask). Prints, per org (in current system-rank order), ONLY facts that
// come straight from the database, so a write-up can be grounded per
// farm-rankings-writeup-style-guide.md rule "every fact comes from this sheet".
// Read-only: writes nothing to the database. Usage:
//   npx tsx scripts/farm-writeup-facts.ts [--baseline=<refresh_run_id>] [--out=file.md]
// --baseline picks the older run movement is measured against (default: the
// earliest succeeded run within ~70 days of game time before the latest one).

const PAGE = 1000;
async function fetchAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = []; let from = 0;
  while (true) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Same calibration as prospect-bio-style-guide.md §4 (runs one tier hotter than
// the MLB.com glossary): words only, never the number, in any output.
function word(g: number | null): string | null {
  if (g === null) return null;
  if (g >= 70) return "elite";
  if (g >= 60) return "plus";
  if (g >= 45) return "average";
  if (g >= 35) return "below average";
  return "well below average";
}

interface Ratings {
  player_id: number; pos: string | null; prone: string | null;
  pot_cntct: number | null; pot_pow: number | null; pot_eye: number | null; pot_gap: number | null; speed: number | null;
  pot_stf: number | null; pot_mov: number | null; pot_ctrl: number | null; stm: number | null;
  ifr: number | null; ife: number | null; ifa: number | null; ofr: number | null; ofe: number | null; ofa: number | null; cfrm: number | null; carm: number | null; cblk: number | null;
  pot_fst: number | null; pot_crv: number | null; pot_sld: number | null; pot_chg: number | null; pot_cutt: number | null; pot_splt: number | null; pot_frk: number | null; pot_circhg: number | null; pot_snk: number | null; pot_knbl: number | null; pot_kncrv: number | null;
}

function toolNotes(r: Ratings | undefined, ph: "H" | "P", role: string | null): string {
  if (!r) return "";
  const notes: string[] = [];
  const add = (label: string, g: number | null) => { const w = word(g); if (w && w !== "average") notes.push(`${label} ${w}`); };
  if (ph === "H") {
    add("hit", r.pot_cntct); add("power", r.pot_pow); add("gap power", r.pot_gap); add("discipline", r.pot_eye); add("speed", r.speed);
    // Defense: best-available current fielding grade for the position family (no potential grade exists for these).
    if (role === "C") add("catch-and-throw", Math.round(((r.cfrm ?? 0) * 2 + (r.cblk ?? 0) + (r.carm ?? 0)) / 4));
    else if (role === "SS" || role === "INF" || role === "1B") add("glove", Math.round(((r.ifr ?? 0) * 2 + (r.ife ?? 0) + (r.ifa ?? 0)) / 4));
    else if (role === "CF" || role === "COF") add("outfield defense", Math.round(((r.ofr ?? 0) * 2 + (r.ofe ?? 0) + (r.ofa ?? 0)) / 4));
  } else {
    add("stuff", r.pot_stf); add("movement", r.pot_mov); add("control", r.pot_ctrl); add("stamina", r.stm);
    const pitches: [string, number | null][] = [["fastball", r.pot_fst], ["curve", r.pot_crv], ["slider", r.pot_sld], ["changeup", r.pot_chg], ["cutter", r.pot_cutt], ["splitter", r.pot_splt], ["forkball", r.pot_frk], ["circle change", r.pot_circhg], ["sinker", r.pot_snk], ["knuckleball", r.pot_knbl], ["knuckle-curve", r.pot_kncrv]];
    const top = pitches.filter(([, g]) => g !== null && g >= 60).map(([n, g]) => `${word(g)} ${n}`);
    if (top.length) notes.push(`pitches: ${top.join(", ")}`);
  }
  if (r.prone === "Fragile" || r.prone === "Wrecked") notes.push(`durability: ${r.prone.toLowerCase()} (injury-prone)`);
  if (r.prone === "Iron Man" || r.prone === "Durable") notes.push(`durability: ${r.prone.toLowerCase()}`);
  return notes.join("; ");
}

async function main() {
  const supabase = makeSupabaseClient();
  const leagueId = await getLeagueId(supabase, leagueSlugFromArgv());
  const baselineArg = process.argv.find((a) => a.startsWith("--baseline="));
  const outArg = process.argv.find((a) => a.startsWith("--out="));

  const { data: latestRow } = await supabase.from("player_computed").select("refresh_run_id").eq("dsa_league_id", leagueId).order("refresh_run_id", { ascending: false }).limit(1).single();
  const runId = (latestRow as { refresh_run_id: number }).refresh_run_id;
  const { data: runMeta } = await supabase.from("refresh_runs").select("game_date").eq("id", runId).single();
  const gameDate = (runMeta as { game_date: string | null }).game_date;
  const gameYear = gameDate ? Number(gameDate.slice(0, 4)) : new Date().getFullYear();

  // Baseline run for movement.
  let baselineRunId: number | null = baselineArg ? Number(baselineArg.split("=")[1]) : null;
  if (baselineRunId === null && gameDate) {
    const target = new Date(gameDate).getTime() - 70 * 86400000;
    const { data: runs } = await supabase.from("refresh_runs").select("id,game_date").eq("dsa_league_id", leagueId).eq("status", "succeeded").not("game_date", "is", null).lt("id", runId).order("id", { ascending: true });
    const cands = (runs as { id: number; game_date: string }[]).filter((r) => new Date(r.game_date).getTime() >= target);
    baselineRunId = cands.length ? cands[0].id : null;
  }
  const baselineRank = new Map<number, number | null>();
  let baselineDate: string | null = null;
  if (baselineRunId !== null) {
    const { data } = await supabase.from("team_computed").select("team_id,minors_rank").eq("refresh_run_id", baselineRunId);
    (data as { team_id: number; minors_rank: number | null }[]).forEach((r) => baselineRank.set(r.team_id, r.minors_rank));
    const { data: bm } = await supabase.from("refresh_runs").select("game_date").eq("id", baselineRunId).single();
    baselineDate = (bm as { game_date: string | null }).game_date;
  }

  const cards = await getSystemRankingsDetailed(leagueId);

  // Every leaguewide top-200 prospect with everything needed to write about them.
  const pc = await fetchAll<{ player_id: number; prospect_rank: number; ph: "H" | "P"; role: string | null; eta: number | null }>((f, t) =>
    supabase.from("player_computed").select("player_id,prospect_rank,ph,role,eta").eq("refresh_run_id", runId).not("prospect_rank", "is", null).lte("prospect_rank", 200).range(f, t) as never);
  const ids = pc.map((r) => r.player_id);
  const players = new Map<number, { first_name: string; last_name: string; organization_id: number | null; age: number | null; level: number | null; league_id: number | null; draft_year: number | null; draft_round: number | null; draft_overall_pick: number | null }>();
  const ratings = new Map<number, Ratings>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: p } = await supabase.from("players").select("id,first_name,last_name,organization_id,age,level,league_id,draft_year,draft_round,draft_overall_pick").eq("dsa_league_id", leagueId).in("id", chunk);
    (p as never as { id: number }[]).forEach((x) => players.set(x.id, x as never));
    const { data: r } = await supabase.from("player_ratings_snapshots").select("player_id,pos,prone,pot_cntct,pot_pow,pot_eye,pot_gap,speed,pot_stf,pot_mov,pot_ctrl,stm,ifr,ife,ifa,ofr,ofe,ofa,cfrm,carm,cblk,pot_fst,pot_crv,pot_sld,pot_chg,pot_cutt,pot_splt,pot_frk,pot_circhg,pot_snk,pot_knbl,pot_kncrv").eq("refresh_run_id", runId).in("player_id", chunk);
    (r as Ratings[]).forEach((x) => ratings.set(x.player_id, x));
  }

  // Draft: which org drafted whom (most recent completed draft in draft_picks).
  const { data: yrRow } = await supabase.from("draft_picks").select("draft_year").eq("dsa_league_id", leagueId).gt("draft_year", 0).order("draft_year", { ascending: false }).limit(1).single();
  const lastDraftYear = (yrRow as { draft_year: number }).draft_year;
  const picks = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("draft_picks").select("player_id,team_name").eq("dsa_league_id", leagueId).eq("draft_year", lastDraftYear).in("player_id", ids.slice(i, i + 200));
    (data as { player_id: number; team_name: string }[]).forEach((r) => picks.set(r.player_id, r.team_name));
  }

  // Recent trades (this game year) involving a top-200 prospect.
  const tradeNotes = new Map<number, string[]>();
  {
    const { data: evs } = await supabase.from("trade_events").select("id,trade_date,team_a_name,team_b_name").eq("dsa_league_id", leagueId).gte("trade_date", `${gameYear}-01-01`).eq("status", "completed");
    const evList = (evs ?? []) as { id: number; trade_date: string; team_a_name: string; team_b_name: string }[];
    if (evList.length) {
      const { data: items } = await supabase.from("trade_event_items").select("trade_event_id,player_id,side").in("trade_event_id", evList.map((e) => e.id)).not("player_id", "is", null);
      for (const it of (items ?? []) as { trade_event_id: number; player_id: number; side: string }[]) {
        if (!ids.includes(it.player_id)) continue;
        const ev = evList.find((e) => e.id === it.trade_event_id)!;
        tradeNotes.set(it.player_id, [...(tradeNotes.get(it.player_id) ?? []), `traded ${ev.trade_date} (${ev.team_a_name} / ${ev.team_b_name}; item side "${it.side}")`]);
      }
    }
  }

  // Current-season stat lines (summed across levels this season).
  const bat = new Map<number, { ab: number; h: number; d: number; t: number; hr: number; bb: number; hp: number; sf: number }>();
  const pit = new Map<number, { ip: number; er: number; k: number; bb: number }>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: b } = await supabase.from("player_batting_stats_snapshots").select("player_id,ab,h,d,t,hr,bb,hp,sf").eq("refresh_run_id", runId).eq("year", gameYear).eq("split_id", 1).in("player_id", chunk);
    for (const r of (b ?? []) as { player_id: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; hp: number; sf: number }[]) {
      const c = bat.get(r.player_id) ?? { ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hp: 0, sf: 0 };
      for (const k of ["ab", "h", "d", "t", "hr", "bb", "hp", "sf"] as const) c[k] += r[k] ?? 0;
      bat.set(r.player_id, c);
    }
    const { data: p } = await supabase.from("player_pitching_stats_snapshots").select("player_id,outs,er,k,bb").eq("refresh_run_id", runId).eq("year", gameYear).eq("split_id", 1).in("player_id", chunk);
    for (const r of (p ?? []) as { player_id: number; outs: number; er: number; k: number; bb: number }[]) {
      const c = pit.get(r.player_id) ?? { ip: 0, er: 0, k: 0, bb: 0 };
      c.ip += (r.outs ?? 0) / 3; c.er += r.er ?? 0; c.k += r.k ?? 0; c.bb += r.bb ?? 0;
      pit.set(r.player_id, c);
    }
  }
  const f3 = (n: number) => n.toFixed(3).replace(/^0/, "");
  function statLine(id: number, ph: "H" | "P"): string {
    if (ph === "H") {
      const s = bat.get(id);
      if (!s || s.ab < 60) return "no meaningful current-season sample (under 60 AB) -- do not cite stats";
      const singles = s.h - s.d - s.t - s.hr; const tb = singles + 2 * s.d + 3 * s.t + 4 * s.hr;
      const obp = (s.h + s.bb + s.hp) / Math.max(1, s.ab + s.bb + s.hp + s.sf);
      return `${gameYear}: ${f3(s.h / s.ab)}/${f3(obp)}/${f3(tb / s.ab)}, ${s.hr} HR in ${s.ab} AB`;
    }
    const s = pit.get(id);
    if (!s || s.ip < 20) return "no meaningful current-season sample (under 20 IP) -- do not cite stats";
    return `${gameYear}: ${(s.er * 9 / s.ip).toFixed(2)} ERA, ${(s.k * 9 / s.ip).toFixed(1)} K/9, ${(s.bb * 9 / s.ip).toFixed(1)} BB/9 in ${Math.floor(Math.round(s.ip * 3) / 3)}.${Math.round(s.ip * 3) % 3} IP`;
  }
  const pcById = new Map(pc.map((r) => [r.player_id, r]));

  const out: string[] = [];
  out.push(`# Farm Rankings fact sheet -- refresh_run_id ${runId}, game date ${gameDate}, movement vs run ${baselineRunId ?? "n/a"} (${baselineDate ?? "n/a"})`, "");
  out.push(`Movement is minors_rank at the baseline vs now. Last completed draft: ${lastDraftYear}. Ranks shown are leaguewide prospect_rank. NEVER print grades as numbers -- the words below are the only grade language allowed.`, "");
  for (const c of cards) {
    const was = baselineRank.get(c.team_id) ?? null;
    const move = was === null || c.minorsRank === null ? "no baseline" : was === c.minorsRank ? `unchanged at #${c.minorsRank}` : `${was < c.minorsRank ? "down" : "up"} ${Math.abs(was - c.minorsRank)} (from #${was})`;
    out.push(`## #${c.minorsRank} ${c.name} ${c.nickname}  [team_id/org ${c.team_id}]`);
    out.push(`- Movement: ${move}. Sub-ranks: batting #${c.battingProspectRank}, pitching #${c.pitchingProspectRank}, readiness #${c.readinessRank}. Blue-Chip ${c.blueChip?.word ?? "n/a"}, Depth ${c.depth?.word ?? "n/a"}, Balance ${c.balance?.word ?? "n/a"}.`);
    out.push(`- MLB club: ${c.record ?? "n/a"}${c.standing ? `, ${c.standing}` : ""}. Prospects in leaguewide top 100: ${c.top100Count}; top 200: ${c.top200Count}.`);
    const org = pc.filter((r) => players.get(r.player_id)?.organization_id === c.team_id).sort((a, b) => a.prospect_rank - b.prospect_rank);
    const draftees = org.filter((r) => picks.has(r.player_id)).length;
    const soon = org.filter((r) => r.eta !== null && r.eta <= gameYear).length;
    out.push(`- Top-200 prospects: ${org.length} (${org.filter((r) => r.ph === "H").length} hitters / ${org.filter((r) => r.ph === "P").length} pitchers); ${draftees} from the ${lastDraftYear} draft class this org drafted; ${soon} with an ETA of ${gameYear} or sooner.`);
    for (const r of org.slice(0, 7)) {
      const p = players.get(r.player_id)!;
      const draft = picks.has(r.player_id) ? `drafted by ${picks.get(r.player_id)} in ${lastDraftYear} (round ${p.draft_round}, pick ${p.draft_overall_pick})` : "not from the latest draft class";
      const tr = tradeNotes.get(r.player_id);
      out.push(`  - #${r.prospect_rank} ${p.first_name} ${p.last_name}, ${r.role}, age ${p.age}, ETA ${r.eta ?? "?"}; ${draft}${tr ? `; ${tr.join("; ")}` : ""}. Tools: ${toolNotes(ratings.get(r.player_id), r.ph, r.role) || "nothing above average"}. ${statLine(r.player_id, r.ph)}. (currently at ${levelLabel(effectiveLevel(p.level, p.league_id, leagueId))})`);
    }
    out.push("");
  }
  const text = out.join("\n");
  if (outArg) { writeFileSync(outArg.split("=")[1], text); console.log(`Wrote ${text.length} chars to ${outArg.split("=")[1]}`); } else console.log(text);
}
main().catch((e) => { console.error(e); process.exit(1); });
