import { makeSupabaseClient } from "./supabase-client";

// Data layer for /admin/rating-validation (2026-08-31, Rees's ask) --
// "does our rating engine's Overall actually predict real production, and
// which of the individual weighted grade inputs (contact/power/eye/etc. for
// hitters, stuff/movement/control/etc. for pitchers) matter most?" Kept
// separate from queries.ts/market-rate-query.ts on purpose, same reasoning
// as every other page-scoped data layer in this app.
//
// Scope, deliberately narrow for a first pass: real 2031 MLB WAR only
// (level_id=1, split_id=1 -- confirmed the "overall" split; 2/3/21 are
// situational splits with WAR always 0, not usable). Compared against
// Overall and each RAW grade that actually feeds the rating engine's
// Overall formula (lib/rating-engine.ts) -- Potential is deliberately
// excluded: it's a forward-looking ceiling projection, not a claim about
// this year's production, so testing it against this year's WAR wouldn't
// be a fair comparison the way Overall-vs-WAR is.
//
// Plotted/regressed as a RATE, not raw WAR (2026-08-31, Rees's refinement)
// -- raw season WAR rewards playing time as much as talent, which isn't
// what this page is trying to measure, and it can't be compared across
// starters and relievers at all (a real ace SP racks up 3-4x an elite RP's
// innings). Hitters: WAR per 100 PA, minimum 100 PA (excludes injured/
// part-time/late-callup players whose small sample is mostly noise, not a
// fair read on whether Overall predicted their value). Pitchers: WAR per
// 100 IP, but with a role-dependent innings floor rather than one shared
// number -- 75 IP for SP, 30 IP for RP -- since a real full-season
// reliever accumulates far fewer innings than a real full-season starter;
// a single shared threshold would either exclude most legitimate relievers
// or admit token/injured starters. Once both are past their own floor,
// they're compared on the SAME per-100-IP rate scale, which is what
// actually equalizes them for this comparison.
//
// Fielding is included too (2026-08-31, Rees's follow-up) -- it's a real
// weighted contributor to Overall (`overall = max(batting + fielding *
// w.fielding, pitching)`, lib/rating-engine.ts line ~475), just not a
// single raw grade like Contact/Power -- it's itself a derived composite,
// `Math.max(catcherComposite, infieldComposite, outfieldComposite)`, each
// built from different raw fields plus a position-specific bonus from the
// active weight set. Computed here the same way the engine computes it
// (not simplified), then tested as one more variable, matching how Overall
// itself -- also a composite -- is tested rather than excluded for not
// being a single raw grade.
//
// makeSupabaseClient() is deliberately NOT called at module top level here
// (2026-08-31 fix) -- this file also exports plain constants
// (HITTER_VARIABLES/PITCHER_VARIABLES) that the "use client"
// RatingValidationExplorer.tsx imports as real runtime values, not just
// types. A regular (non `import type`) import pulls the WHOLE module into
// the client bundle, including any top-level code -- a module-level
// makeSupabaseClient() call would run in the browser and throw immediately
// ("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"), confirmed
// live via a real dev-server hydration crash. Instantiating inside
// getRatingValidationPoints() instead means merely importing this module
// (for its constants) never executes it -- only actually calling the
// function does, which the client component never does.

const PAGE_SIZE = 1000;
async function fetchAll<T>(query: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// The exact raw fields that feed Overall in lib/rating-engine.ts -- hitters:
// cntctBlend*w.contact + ksBlend*w.avoid_ks + powBlend*w.power +
// gapBlend*w.gap + eyeBlend*w.eye + speed*w.speed (line ~384). Pitchers:
// stfBlend*w.stuff + movBlend*w.movement + pbabipBlend*w.pbabip +
// ctrlBlend*w.control + stm*w.stamina (line ~451). Field names here are the
// raw player_ratings_snapshots columns, not the weight-table names.
export const HITTER_VARIABLES = [
  { key: "cntct", label: "Contact" },
  { key: "gap", label: "Gap" },
  { key: "pow", label: "Power" },
  { key: "eye", label: "Eye" },
  { key: "ks", label: "Avoid Ks" },
  { key: "speed", label: "Speed" },
  { key: "fielding", label: "Fielding" },
] as const;
export const PITCHER_VARIABLES = [
  { key: "stf", label: "Stuff" },
  { key: "mov", label: "Movement" },
  { key: "ctrl", label: "Control" },
  { key: "stm", label: "Stamina" },
  { key: "pbabip", label: "PBABIP" },
] as const;

export interface ValidationPoint {
  playerId: number;
  playerName: string;
  role: string;
  playerType: "hitter" | "pitcher";
  overall: number;
  war: number; // raw season WAR -- shown for context in the detail panel, not plotted/regressed
  warRate: number; // WAR per 100 PA (hitters) or per 100 IP (pitchers) -- the actual plotted/regressed value
  playingTime: number; // PA for hitters, IP for pitchers
  grades: Record<string, number | null>;
}

export async function getRatingValidationPoints(): Promise<ValidationPoint[]> {
  const supabase = makeSupabaseClient();

  console.log("Finding latest refresh run with player_computed...");
  const { data: computedRunRow } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!computedRunRow) return [];
  const computedRunId = (computedRunRow as { refresh_run_id: number }).refresh_run_id;

  // player_batting_stats_snapshots/player_pitching_stats_snapshots are
  // CUMULATIVE-as-of-refresh-date time series, same pattern as ratings/
  // contracts (confirmed 2026-08-31 after a real bug: one player showed 22
  // rows for the 2031 season, each refresh_run_id's own running season
  // total -- e.g. 249 PA at run 3, climbing to a final 692 PA by run 18+ --
  // NOT 22 independent stints. Summing across every refresh_run_id (the
  // first version of this query) inflated everyone's WAR by roughly how
  // many times they'd been snapshotted, producing an impossible range
  // (single-season WAR outside -55 to +165). Fixed: use only the LATEST
  // stats refresh_run_id -- multiple rows WITHIN that one run (a real
  // same-season trade producing 2 team-stint rows in the same final
  // snapshot) still get summed correctly, just not across different runs.
  console.log("Finding latest refresh run with 2031 batting stats...");
  const { data: statsRunRow } = await supabase
    .from("player_batting_stats_snapshots").select("refresh_run_id").eq("year", 2031).eq("level_id", 1).eq("split_id", 1)
    .order("refresh_run_id", { ascending: false }).limit(1).maybeSingle();
  if (!statsRunRow) return [];
  const statsRunId = (statsRunRow as { refresh_run_id: number }).refresh_run_id;

  console.log("Loading active rating weight set (for fielding's position bonuses)...");
  const { data: weightRow } = await supabase.from("rating_weights").select("catcher_fielding_bonus, infield_fielding_bonus, outfield_fielding_bonus").eq("is_active", true).maybeSingle();
  const weights = weightRow as { catcher_fielding_bonus: number; infield_fielding_bonus: number; outfield_fielding_bonus: number } | null;

  const [computed, ratings, battingRows, pitchingRows, players] = await Promise.all([
    fetchAll<{ player_id: number; overall: number | null; role: string | null }>((from, to) =>
      supabase.from("player_computed").select("player_id, overall, role").eq("refresh_run_id", computedRunId).range(from, to) as never
    ),
    fetchAll<{
      player_id: number; cntct: number | null; gap: number | null; pow: number | null; eye: number | null; ks: number | null; speed: number | null;
      stf: number | null; mov: number | null; ctrl: number | null; stm: number | null; pbabip: number | null;
      cblk: number | null; cfrm: number | null; carm: number | null; ifr: number | null; ife: number | null; ifa: number | null; tdp: number | null;
      ofr: number | null; ofe: number | null; ofa: number | null;
    }>((from, to) =>
      supabase.from("player_ratings_snapshots")
        .select("player_id, cntct, gap, pow, eye, ks, speed, stf, mov, ctrl, stm, pbabip, cblk, cfrm, carm, ifr, ife, ifa, tdp, ofr, ofe, ofa")
        .eq("refresh_run_id", computedRunId).range(from, to) as never
    ),
    fetchAll<{ player_id: number; pa: number | null; war: number | null }>((from, to) =>
      supabase.from("player_batting_stats_snapshots").select("player_id, pa, war").eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId).range(from, to) as never
    ),
    fetchAll<{ player_id: number; ip: number | null; war: number | null }>((from, to) =>
      supabase.from("player_pitching_stats_snapshots").select("player_id, ip, war").eq("year", 2031).eq("level_id", 1).eq("split_id", 1).eq("refresh_run_id", statsRunId).range(from, to) as never
    ),
    fetchAll<{ id: number; first_name: string | null; last_name: string | null }>((from, to) =>
      supabase.from("players").select("id, first_name, last_name").range(from, to) as never
    ),
  ]);

  const computedByPlayer = new Map(computed.map((c) => [c.player_id, c]));
  const ratingsByPlayer = new Map(ratings.map((r) => [r.player_id, r]));
  const nameById = new Map(players.map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || `Player ${p.id}`]));

  // Same formula as lib/rating-engine.ts's fielding composite -- `zero()`
  // there just means "treat null as 0," reproduced inline here.
  const z = (v: number | null) => v ?? 0;
  function computeFielding(r: { cblk: number | null; cfrm: number | null; carm: number | null; ifr: number | null; ife: number | null; ifa: number | null; tdp: number | null; ofr: number | null; ofe: number | null; ofa: number | null }): number {
    const cBonus = weights?.catcher_fielding_bonus ?? 0;
    const infBonus = weights?.infield_fielding_bonus ?? 0;
    const ofBonus = weights?.outfield_fielding_bonus ?? 0;
    const cRating = (z(r.cblk) + z(r.cfrm) + z(r.carm)) / 3 + cBonus;
    const infRating = (z(r.ifr) * 2 + z(r.ife) + z(r.ifa) + z(r.tdp)) / 5 + infBonus;
    const ofRating = (z(r.ofr) * 2 + z(r.ofe) + z(r.ofa)) / 4 + ofBonus;
    return Math.max(cRating, infRating, ofRating);
  }

  // Sum within this one refresh run only (a real mid-season trade can still
  // produce 2 team-stint rows in the same final snapshot).
  const battingByPlayer = new Map<number, { pa: number; war: number }>();
  for (const b of battingRows) {
    const cur = battingByPlayer.get(b.player_id) ?? { pa: 0, war: 0 };
    cur.pa += b.pa ?? 0;
    cur.war += b.war ?? 0;
    battingByPlayer.set(b.player_id, cur);
  }
  const pitchingByPlayer = new Map<number, { ip: number; war: number }>();
  for (const p of pitchingRows) {
    const cur = pitchingByPlayer.get(p.player_id) ?? { ip: 0, war: 0 };
    cur.ip += p.ip ?? 0;
    cur.war += p.war ?? 0;
    pitchingByPlayer.set(p.player_id, cur);
  }

  const PITCHER_ROLES = new Set(["SP", "RP"]);
  const MIN_PA = 100;
  const MIN_IP_SP = 75;
  const MIN_IP_RP = 30;

  const points: ValidationPoint[] = [];
  for (const [playerId, pc] of computedByPlayer) {
    if (pc.overall == null || !pc.role) continue;
    const playerType: "hitter" | "pitcher" = PITCHER_ROLES.has(pc.role) ? "pitcher" : "hitter";
    const r = ratingsByPlayer.get(playerId);
    if (!r) continue;
    const playerName = nameById.get(playerId) ?? `Player ${playerId}`;

    if (playerType === "hitter") {
      const bat = battingByPlayer.get(playerId);
      if (!bat || bat.pa < MIN_PA) continue;
      points.push({
        playerId, playerName, role: pc.role, playerType, overall: pc.overall,
        war: bat.war, warRate: (bat.war / bat.pa) * 100, playingTime: bat.pa,
        grades: { cntct: r.cntct, gap: r.gap, pow: r.pow, eye: r.eye, ks: r.ks, speed: r.speed, fielding: computeFielding(r) },
      });
    } else {
      const pit = pitchingByPlayer.get(playerId);
      const minIp = pc.role === "SP" ? MIN_IP_SP : MIN_IP_RP;
      if (!pit || pit.ip < minIp) continue;
      points.push({
        playerId, playerName, role: pc.role, playerType, overall: pc.overall,
        war: pit.war, warRate: (pit.war / pit.ip) * 100, playingTime: pit.ip,
        grades: { stf: r.stf, mov: r.mov, ctrl: r.ctrl, stm: r.stm, pbabip: r.pbabip },
      });
    }
  }
  return points;
}
