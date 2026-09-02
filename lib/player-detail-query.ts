// Player detail page (2026-08-29) -- the single richest view on the site:
// bio, every calculated/blended metric that feeds Overall/Potential, the
// full raw scouting grade sheet, and career stats history, for one player.
// Built for Rees's own evaluation work, not a guest-facing report -- lives
// under /players/[id], which is admin-only automatically (middleware.ts's
// GUEST_ALLOWED_PATHS doesn't include it, same as /players and /org-minors).
import { makeSupabaseClient } from "./supabase-client";
import { levelLabel, effectiveLevel } from "./display-helpers";

const supabase = makeSupabaseClient();

async function latestRefreshRunId(): Promise<number> {
  const { data, error } = await supabase
    .from("player_computed").select("refresh_run_id").order("refresh_run_id", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`No player_computed data found: ${error?.message}`);
  return (data as { refresh_run_id: number }).refresh_run_id;
}

// bats/throws numeric encoding confirmed 2026-08-29 by cross-referencing
// three real players' StatsPlus profile pages ("Bat: X / Throw: Y") against
// their raw players.bats/throws values: bats 1=R, 2=L, 3=S; throws 1=R, 2=L.
// Not documented anywhere else in this codebase before now -- if a 4th bats
// value ever shows up, re-verify against a real profile rather than guessing.
function batsLabel(v: number | null): string | null {
  return v === 1 ? "R" : v === 2 ? "L" : v === 3 ? "S" : null;
}
function throwsLabel(v: number | null): string | null {
  return v === 1 ? "R" : v === 2 ? "L" : null;
}

// height is stored in centimeters despite weight being plain lbs (a known
// OOTP quirk, confirmed against Jeremy Porten's real profile: stored 182cm
// height matches "5'11"" displayed on StatsPlus, stored weight 186 matches
// "186" lbs directly, no conversion).
function heightLabel(cm: number | null): string | null {
  if (cm === null) return null;
  const totalInches = Math.round(cm / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

function injuryStatusLabel(p: {
  injury_is_injured: boolean | null;
  is_on_dl: boolean | null;
  is_on_dl60: boolean | null;
  injury_left: number | null;
}): string {
  if (!p.injury_is_injured) return "Healthy";
  if (!p.is_on_dl && !p.is_on_dl60) return "DTD";
  return `DL${p.is_on_dl60 ? "-60" : ""}, ${p.injury_left ?? "?"} days left`;
}

export interface PlayerDetailBio {
  playerId: number;
  firstName: string;
  lastName: string;
  age: number | null;
  dateOfBirth: string | null;
  bats: string | null;
  throws: string | null;
  height: string | null;
  weight: number | null;
  pos: string | null; // from player_ratings_snapshots (a role-aware position string, e.g. "SP"), not players.pos (a raw numeric code this page doesn't decode)
  teamName: string | null;
  teamNickname: string | null;
  isInternational: boolean;
  levelLabel: string;
  draftYear: number | null;
  draftRound: number | null;
  draftOverallPick: number | null;
  draftTeamName: string | null;
  isRetired: boolean;
  isFreeAgent: boolean;
  isHallOfFame: boolean;
  injuryStatus: string;
  bioText: string | null;
  bioStale: boolean;
}

// Everything from player_computed -- the "how did we get this number" layer.
// Field names kept 1:1 with the database column names deliberately (not
// relabeled/camelCased) so this stays trivially auditable against
// lib/rating-engine.ts's ComputedRatings interface and the raw table itself.
export interface PlayerDetailComputed {
  overall: number | null;
  potential: number | null;
  prospect_potential: number | null;
  batting: number | null;
  batting_p: number | null;
  fielding: number | null;
  pitching: number | null;
  pitching_p: number | null;
  qp: number | null;
  qpp: number | null;
  c_rating: number | null;
  inf_rating: number | null;
  of_rating: number | null;
  role: string | null;
  sp_rp: string | null;
  tbl_pos: string | null;
  platoon: string | null;
  ph: string | null;
  eta: number | null;
}

// Raw scouting grades, straight from player_ratings_snapshots -- grouped
// loosely below for the page's own rendering, but this interface just lists
// every field worth showing (skips the raw table's own FK/context columns:
// league/lg_lvl/org/team/id/refresh_run_id/player_id/captured_at, all
// better represented elsewhere on this page via players/teams).
export interface PlayerDetailRatings {
  // StatsPlus's own scout grades -- comparison baseline ONLY, never an
  // input anywhere in lib/rating-engine.ts. Labeled clearly on the page.
  statsPlusOvr: number | null;
  statsPlusPot: number | null;
  // Hitting
  cntct: number | null; cntct_l: number | null; cntct_r: number | null; pot_cntct: number | null;
  gap: number | null; gap_l: number | null; gap_r: number | null; pot_gap: number | null;
  pow: number | null; pow_l: number | null; pow_r: number | null; pot_pow: number | null;
  eye: number | null; eye_l: number | null; eye_r: number | null; pot_eye: number | null;
  ks: number | null; ks_l: number | null; ks_r: number | null; pot_ks: number | null;
  babip: number | null; babip_l: number | null; babip_r: number | null; pot_babip: number | null;
  // Speed / baserunning
  speed: number | null; run: number | null; steal: number | null; stlrt: number | null;
  sacbunt: number | null; bunthit: number | null;
  // Position eligibility (current + potential)
  pos_p: number | null; pos_c: number | null; pos_1b: number | null; pos_2b: number | null; pos_3b: number | null;
  pos_ss: number | null; pos_lf: number | null; pos_cf: number | null; pos_rf: number | null;
  pot_p: number | null; pot_c: number | null; pot_1b: number | null; pot_2b: number | null; pot_3b: number | null;
  pot_ss: number | null; pot_lf: number | null; pot_cf: number | null; pot_rf: number | null;
  // Fielding
  cblk: number | null; cfrm: number | null; carm: number | null;
  ifr: number | null; ife: number | null; ifa: number | null; tdp: number | null;
  ofr: number | null; ofe: number | null; ofa: number | null;
  // Pitching -- composite grades
  stf: number | null; stf_l: number | null; stf_r: number | null; pot_stf: number | null;
  mov: number | null; mov_l: number | null; mov_r: number | null; pot_mov: number | null;
  hra: number | null; hra_l: number | null; hra_r: number | null; pot_hra: number | null;
  pbabip: number | null; pbabip_l: number | null; pbabip_r: number | null; pot_pbabip: number | null;
  ctrl: number | null; ctrl_l: number | null; ctrl_r: number | null; pot_ctrl: number | null;
  stm: number | null; hold: number | null; vel: string | null; pot_vel: string | null;
  armslot: string | null; gbtype: string | null; fbtype: string | null; gb: number | null;
  // Individual pitches (current + potential)
  fst: number | null; snk: number | null; cutt: number | null; crv: number | null; sld: number | null;
  chg: number | null; pot_chg: number | null; splt: number | null; scr: number | null; frk: number | null;
  circhg: number | null; knbl: number | null; kncrv: number | null;
  pot_fst: number | null; pot_crv: number | null; pot_sld: number | null; pot_snk: number | null;
  pot_splt: number | null; pot_cutt: number | null; pot_frk: number | null; pot_circhg: number | null;
  pot_scr: number | null; pot_kncrv: number | null; pot_knbl: number | null;
  // Makeup / scouting descriptors (text traits, not 20-80 grades)
  prone: string | null; greed: string | null; lead: string | null; loy: string | null;
  wrkethic: string | null; acc: string | null; int_: string | null;
}

export interface PlayerDetailProjectedSplit { l: number | null; r: number | null }
export interface PlayerDetailProjectedSplits {
  cntct: PlayerDetailProjectedSplit; pow: PlayerDetailProjectedSplit; eye: PlayerDetailProjectedSplit;
  gap: PlayerDetailProjectedSplit; ks: PlayerDetailProjectedSplit;
  stf: PlayerDetailProjectedSplit; mov: PlayerDetailProjectedSplit; ctrl: PlayerDetailProjectedSplit;
  hra: PlayerDetailProjectedSplit; pbabip: PlayerDetailProjectedSplit;
}

export interface SeasonStatLine {
  year: number;
  levelLabel: string;
  teamName: string | null;
  // Batting
  g: number | null; ab: number | null; h: number | null; d: number | null; t: number | null; hr: number | null;
  r: number | null; rbi: number | null; bb: number | null; k: number | null; sb: number | null; cs: number | null;
  // Pitching
  gs: number | null; ip: number | null; er: number | null; w: number | null; l: number | null; sv: number | null;
  war: number | null;
}

export interface PlayerDetail {
  bio: PlayerDetailBio;
  computed: PlayerDetailComputed | null;
  ratings: PlayerDetailRatings | null;
  projectedSplits: PlayerDetailProjectedSplits | null;
  battingHistory: SeasonStatLine[];
  pitchingHistory: SeasonStatLine[];
  statsPlusUrl: string;
}

export async function getPlayerDetail(playerId: number): Promise<PlayerDetail | null> {
  const refreshRunId = await latestRefreshRunId();

  const { data: pRow, error: pErr } = await supabase
    .from("players")
    .select("id,first_name,last_name,age,date_of_birth,bats,throws,height,weight,team_id,organization_id,league_id,level,draft_year,draft_round,draft_overall_pick,draft_team_id,retired,free_agent,hall_of_fame,injury_is_injured,is_on_dl,is_on_dl60,injury_left")
    .eq("id", playerId).maybeSingle();
  if (pErr) throw pErr;
  if (!pRow) return null;
  const p = pRow as {
    id: number; first_name: string; last_name: string; age: number | null; date_of_birth: string | null;
    bats: number | null; throws: number | null; height: number | null; weight: number | null;
    team_id: number | null; organization_id: number | null; league_id: number | null; level: number | null;
    draft_year: number | null; draft_round: number | null; draft_overall_pick: number | null; draft_team_id: number | null;
    retired: boolean | null; free_agent: boolean | null; hall_of_fame: boolean | null;
    injury_is_injured: boolean | null; is_on_dl: boolean | null; is_on_dl60: boolean | null; injury_left: number | null;
  };

  // Stats history -- full career, NOT scoped to the latest refresh_run_id
  // (fixed 2026-08-30, caught while pulling real data for a bio rewrite: a
  // player's early-career years only got captured once, during the one-time
  // 2001-2031 backfill under an OLD refresh run -- normal day-to-day
  // refreshes only ever re-pull the CURRENT season going forward, so
  // filtering to the latest run silently showed only this season for
  // anyone with a real career before it, contradicting this section's own
  // "full career" claim. Confirmed concretely on R.J. Blum: his 2026-2030
  // rows (Rookie through A+, a real developmental climb) only exist under
  // refresh_run_id 9 -- every run since (10 through 23) only touched 2031.
  // Fix: fetch every row across every run, then keep only the highest
  // refresh_run_id per (year, level_id, stint) before summing -- the
  // current season's total still comes from the freshest data (it keeps
  // growing run to run), while a closed-out past season just falls back to
  // whichever run last had it, which is however far back it takes.
  // Fetched here (before the teams lookup below) so a career season played
  // for a since-left team -- before a trade, or an old minor-league
  // affiliate -- resolves its own team name too, not just the player's
  // CURRENT team_id/draft_team_id.
  function latestPerStint<T extends { year: number; level_id: number | null; stint: number | null; refresh_run_id: number }>(rows: T[]): T[] {
    const byKey = new Map<string, T>();
    for (const row of rows) {
      const key = `${row.year}|${row.level_id}|${row.stint}`;
      const existing = byKey.get(key);
      if (!existing || row.refresh_run_id > existing.refresh_run_id) byKey.set(key, row);
    }
    return [...byKey.values()];
  }

  const { data: batDataAll, error: batErr } = await supabase
    .from("player_batting_stats_snapshots")
    .select("year,level_id,league_id,team_id,g,ab,h,d,t,hr,r,rbi,bb,k,sb,cs,war,stint,refresh_run_id")
    .eq("player_id", playerId).eq("split_id", 1);
  if (batErr) throw batErr;
  const batData = latestPerStint((batDataAll ?? []) as { year: number; level_id: number | null; league_id: number | null; team_id: number | null; stint: number | null; refresh_run_id: number; g: number | null; ab: number | null; h: number | null; d: number | null; t: number | null; hr: number | null; r: number | null; rbi: number | null; bb: number | null; k: number | null; sb: number | null; cs: number | null; war: number | null }[]);
  // Column names here are the pitching table's OWN convention, not the
  // batting table's -- confirmed against database.types.ts 2026-08-29 after
  // this query silently returned nothing (its error was being swallowed):
  // saves is `s` (not `sv`), hits/HR allowed are `ha`/`hra` (not `h`/`hr` --
  // `hra` here means the literal stat, unlike player_ratings_snapshots'
  // `hra`, which is a 20-80 grade -- same field name, different table,
  // different meaning).
  const { data: pitDataAll, error: pitErr } = await supabase
    .from("player_pitching_stats_snapshots")
    .select("year,level_id,league_id,team_id,g,gs,ip,er,w,l,s,k,bb,ha,hra,war,stint,refresh_run_id")
    .eq("player_id", playerId).eq("split_id", 1);
  if (pitErr) throw pitErr;
  const pitData = latestPerStint((pitDataAll ?? []) as { year: number; level_id: number | null; league_id: number | null; team_id: number | null; stint: number | null; refresh_run_id: number; g: number | null; gs: number | null; ip: number | null; er: number | null; w: number | null; l: number | null; s: number | null; k: number | null; bb: number | null; ha: number | null; hra: number | null; war: number | null }[]);

  const historyTeamIds = [...(batData ?? []), ...(pitData ?? [])].map((r) => (r as { team_id: number | null }).team_id);
  const teamIds = [...new Set([p.team_id, p.draft_team_id, ...historyTeamIds])].filter((x): x is number => x !== null);
  const teamById = new Map<number, { name: string; nickname: string }>();
  if (teamIds.length > 0) {
    const { data: teams, error: teamsErr } = await supabase.from("teams").select("id,name,nickname").in("id", teamIds);
    if (teamsErr) throw teamsErr;
    (teams as { id: number; name: string; nickname: string }[]).forEach((t) => teamById.set(t.id, t));
  }

  // Same international-signee convention as org-minors-query.ts: level=1
  // with a negative league_id is a not-yet-rostered amateur signee parked
  // under their org's own MLB team_id, not a real active-roster player.
  const effLevel = effectiveLevel(p.level, p.league_id);
  const isInternational = effLevel === 8;
  const team = p.team_id !== null ? teamById.get(p.team_id) : undefined;
  const draftTeam = p.draft_team_id !== null ? teamById.get(p.draft_team_id) : undefined;

  const { data: ratRow } = await supabase.from("player_ratings_snapshots").select("*").eq("player_id", playerId).eq("refresh_run_id", refreshRunId).maybeSingle();
  const { data: compRow } = await supabase.from("player_computed").select("*").eq("player_id", playerId).eq("refresh_run_id", refreshRunId).maybeSingle();
  const { data: splitRow } = await supabase.from("player_projected_splits").select("*").eq("player_id", playerId).eq("refresh_run_id", refreshRunId).maybeSingle();
  // prospect_bios is one row per player (isOneToOne on player_id), not
  // scoped to a refresh run the way the snapshot tables are -- its own
  // refresh_run_id column just records provenance for the bioStale check.
  const { data: bioRow } = await supabase.from("prospect_bios").select("bio_text,refresh_run_id").eq("player_id", playerId).maybeSingle();

  const r = ratRow as Record<string, unknown> | null;
  const c = compRow as PlayerDetailComputed | null;
  const s = splitRow as Record<string, number | null> | null;

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  const ratings: PlayerDetailRatings | null = r ? {
    statsPlusOvr: num(r.ovr), statsPlusPot: num(r.pot),
    cntct: num(r.cntct), cntct_l: num(r.cntct_l), cntct_r: num(r.cntct_r), pot_cntct: num(r.pot_cntct),
    gap: num(r.gap), gap_l: num(r.gap_l), gap_r: num(r.gap_r), pot_gap: num(r.pot_gap),
    pow: num(r.pow), pow_l: num(r.pow_l), pow_r: num(r.pow_r), pot_pow: num(r.pot_pow),
    eye: num(r.eye), eye_l: num(r.eye_l), eye_r: num(r.eye_r), pot_eye: num(r.pot_eye),
    ks: num(r.ks), ks_l: num(r.ks_l), ks_r: num(r.ks_r), pot_ks: num(r.pot_ks),
    babip: num(r.babip), babip_l: num(r.babip_l), babip_r: num(r.babip_r), pot_babip: num(r.pot_babip),
    speed: num(r.speed), run: num(r.run), steal: num(r.steal), stlrt: num(r.stlrt),
    sacbunt: num(r.sacbunt), bunthit: num(r.bunthit),
    pos_p: num(r.pos_p), pos_c: num(r.pos_c), pos_1b: num(r.pos_1b), pos_2b: num(r.pos_2b), pos_3b: num(r.pos_3b),
    pos_ss: num(r.pos_ss), pos_lf: num(r.pos_lf), pos_cf: num(r.pos_cf), pos_rf: num(r.pos_rf),
    pot_p: num(r.pot_p), pot_c: num(r.pot_c), pot_1b: num(r.pot_1b), pot_2b: num(r.pot_2b), pot_3b: num(r.pot_3b),
    pot_ss: num(r.pot_ss), pot_lf: num(r.pot_lf), pot_cf: num(r.pot_cf), pot_rf: num(r.pot_rf),
    cblk: num(r.cblk), cfrm: num(r.cfrm), carm: num(r.carm),
    ifr: num(r.ifr), ife: num(r.ife), ifa: num(r.ifa), tdp: num(r.tdp),
    ofr: num(r.ofr), ofe: num(r.ofe), ofa: num(r.ofa),
    stf: num(r.stf), stf_l: num(r.stf_l), stf_r: num(r.stf_r), pot_stf: num(r.pot_stf),
    mov: num(r.mov), mov_l: num(r.mov_l), mov_r: num(r.mov_r), pot_mov: num(r.pot_mov),
    hra: num(r.hra), hra_l: num(r.hra_l), hra_r: num(r.hra_r), pot_hra: num(r.pot_hra),
    pbabip: num(r.pbabip), pbabip_l: num(r.pbabip_l), pbabip_r: num(r.pbabip_r), pot_pbabip: num(r.pot_pbabip),
    ctrl: num(r.ctrl), ctrl_l: num(r.ctrl_l), ctrl_r: num(r.ctrl_r), pot_ctrl: num(r.pot_ctrl),
    stm: num(r.stm), hold: num(r.hold), vel: str(r.vel), pot_vel: str(r.pot_vel),
    armslot: str(r.armslot), gbtype: str(r.gbtype), fbtype: str(r.fbtype), gb: num(r.gb),
    fst: num(r.fst), snk: num(r.snk), cutt: num(r.cutt), crv: num(r.crv), sld: num(r.sld),
    chg: num(r.chg), pot_chg: num(r.pot_chg), splt: num(r.splt), scr: num(r.scr), frk: num(r.frk),
    circhg: num(r.circhg), knbl: num(r.knbl), kncrv: num(r.kncrv),
    pot_fst: num(r.pot_fst), pot_crv: num(r.pot_crv), pot_sld: num(r.pot_sld), pot_snk: num(r.pot_snk),
    pot_splt: num(r.pot_splt), pot_cutt: num(r.pot_cutt), pot_frk: num(r.pot_frk), pot_circhg: num(r.pot_circhg),
    pot_scr: num(r.pot_scr), pot_kncrv: num(r.pot_kncrv), pot_knbl: num(r.pot_knbl),
    prone: str(r.prone), greed: str(r.greed), lead: str(r.lead), loy: str(r.loy),
    wrkethic: str(r.wrkethic), acc: str(r.acc), int_: str(r.int_),
  } : null;

  // player_projected_splits stores flat pot_{field}_l/pot_{field}_r columns
  // (same convention as player_ratings_snapshots), NOT a nested {l,r} object
  // per field -- caught 2026-08-29 during live verification (every split
  // rendered as NaN until this was fixed).
  const splitPair = (key: string): PlayerDetailProjectedSplit => ({
    l: s?.[`pot_${key}_l`] ?? null,
    r: s?.[`pot_${key}_r`] ?? null,
  });
  const projectedSplits: PlayerDetailProjectedSplits | null = s ? {
    cntct: splitPair("cntct"), pow: splitPair("pow"), eye: splitPair("eye"), gap: splitPair("gap"), ks: splitPair("ks"),
    stf: splitPair("stf"), mov: splitPair("mov"), ctrl: splitPair("ctrl"), hra: splitPair("hra"), pbabip: splitPair("pbabip"),
  } : null;

  // (batData/pitData already fetched above, before the teams lookup.)
  function sumStints<T extends { year: number; level_id: number | null; team_id: number | null; stint: number | null }>(
    rows: T[]
  ): (T & { count: number })[] {
    const byKey = new Map<string, T & { count: number }>();
    for (const row of rows) {
      const key = `${row.year}|${row.level_id}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...row, count: 1 });
        continue;
      }
      existing.count += 1;
      for (const k of Object.keys(row) as (keyof T)[]) {
        const v = row[k];
        // refresh_run_id excluded 2026-08-30 alongside year/level_id/stint --
        // now present on every row (see latestPerStint above) and is
        // definitely not a stat to sum across stints.
        if (typeof v === "number" && k !== "year" && k !== "level_id" && k !== "league_id" && k !== "stint" && k !== "refresh_run_id") {
          (existing[k] as unknown as number) = ((existing[k] as unknown as number) ?? 0) + v;
        }
      }
    }
    return [...byKey.values()];
  }

  const battingHistory: SeasonStatLine[] = sumStints((batData ?? []) as { year: number; level_id: number | null; league_id: number | null; team_id: number | null; stint: number | null; g: number | null; ab: number | null; h: number | null; d: number | null; t: number | null; hr: number | null; r: number | null; rbi: number | null; bb: number | null; k: number | null; sb: number | null; cs: number | null; war: number | null }[])
    .sort((a, b) => b.year - a.year)
    .map((row) => ({
      year: row.year, levelLabel: levelLabel(effectiveLevel(row.level_id, row.league_id)), teamName: row.team_id !== null ? (teamById.get(row.team_id)?.nickname ?? null) : null,
      g: row.g, ab: row.ab, h: row.h, d: row.d, t: row.t, hr: row.hr, r: row.r, rbi: row.rbi, bb: row.bb, k: row.k, sb: row.sb, cs: row.cs,
      gs: null, ip: null, er: null, w: null, l: null, sv: null, war: row.war,
    }));

  const pitchingHistory: SeasonStatLine[] = sumStints((pitData ?? []) as { year: number; level_id: number | null; league_id: number | null; team_id: number | null; stint: number | null; g: number | null; gs: number | null; ip: number | null; er: number | null; w: number | null; l: number | null; s: number | null; k: number | null; bb: number | null; ha: number | null; hra: number | null; war: number | null }[])
    .sort((a, b) => b.year - a.year)
    .map((row) => ({
      year: row.year, levelLabel: levelLabel(effectiveLevel(row.level_id, row.league_id)), teamName: row.team_id !== null ? (teamById.get(row.team_id)?.nickname ?? null) : null,
      g: row.g, ab: null, h: row.ha, d: null, t: null, hr: row.hra, r: null, rbi: null, bb: row.bb, k: row.k, sb: null, cs: null,
      gs: row.gs, ip: row.ip, er: row.er, w: row.w, l: row.l, sv: row.s, war: row.war,
    }));

  const bio: PlayerDetailBio = {
    playerId: p.id, firstName: p.first_name, lastName: p.last_name, age: p.age, dateOfBirth: p.date_of_birth,
    bats: batsLabel(p.bats), throws: throwsLabel(p.throws), height: heightLabel(p.height), weight: p.weight,
    pos: r ? str(r.pos) : null,
    teamName: isInternational ? "International Academy" : (team?.name ?? null),
    teamNickname: isInternational ? "International Academy" : (team?.nickname ?? null),
    isInternational, levelLabel: isInternational ? "Int'l" : levelLabel(effLevel),
    draftYear: p.draft_year, draftRound: p.draft_round, draftOverallPick: p.draft_overall_pick,
    draftTeamName: draftTeam?.nickname ?? null,
    isRetired: p.retired ?? false, isFreeAgent: p.free_agent ?? false, isHallOfFame: p.hall_of_fame ?? false,
    injuryStatus: injuryStatusLabel(p),
    bioText: (bioRow as { bio_text: string; refresh_run_id: number } | null)?.bio_text ?? null,
    bioStale: ((bioRow as { bio_text: string; refresh_run_id: number } | null)?.refresh_run_id ?? refreshRunId) < refreshRunId,
  };

  return {
    bio,
    computed: c,
    ratings,
    projectedSplits,
    battingHistory,
    pitchingHistory,
    statsPlusUrl: `https://atl-02.statsplus.net/thebigleague/player/${playerId}`,
  };
}
