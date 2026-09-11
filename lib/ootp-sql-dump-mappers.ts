import type { DumpRow } from "./ootp-sql-dump-parser.js";
import { int, num, bool, str, date } from "./mappers.js";

// Maps OOTP's own "Configure SQL dump for MySQL" export shape into the
// exact same row shapes lib/mappers.ts already produces from StatsPlus --
// Step 5 of the multi-league architecture plan (2026-09-11). Deliberately
// scoped to ONLY the fields we already pull from StatsPlus for TBL, per
// Rees's explicit call: match StatsPlus's input first, fold in the dump's
// extra fields (team financials, per-game data, awards, injury history,
// coaches, trade history, ...) later as their own separate additions.
//
// Where StatsPlus flattens two of OOTP's own internal tables into one
// endpoint, the mapper here takes both source rows and merges them the
// same way -- e.g. `/players/` combines OOTP's own `players` (bio) and
// `players_roster_status` (service time/waivers/DL) tables.
//
// One real, confirmed-by-real-data limitation carried over unchanged from
// StatsPlus: potential ("talent") grades have no vs-L/vs-R split in this
// dump either (only CURRENT grades split by handedness) -- see
// lib/rating-engine.ts's projectPotentialSplit(), built for this exact gap
// against StatsPlus data, which Duud's rating pipeline will need too once
// Step 6 (Duud's own calibration) is built. Not re-solved here.

// Position/role LABEL for player_ratings_snapshots.pos -- NOT the same thing
// as players.pos (a plain numeric fielding-position code, matching
// StatsPlus's own /players/ convention, already correct as-is below). This
// one specifically needs the friendly string label ("SP"/"C"/"1B"/etc.)
// StatsPlus's /ratings/ endpoint provides directly -- lib/rating-engine.ts's
// entire role-classification logic (isCatcherRole/isSSRole/isCFRole, the
// pitcher SP/RP/CL branch) compares `r.pos` against these exact strings.
// Duud's dump only has the raw numeric position (1-10) + a numeric role
// code, with no equivalent pre-built label anywhere -- found 2026-09-11
// running Step 6, when EVERY Duud player came out of compute-ratings.ts as
// a hitter role, zero pitchers, because the raw numeric position ("1") was
// being compared against the literal string "SP" and never matching.
//
// Position codes (standard OOTP convention, already confirmed elsewhere
// this session): 1=P, 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF, 10=DH.
// For position=1 (pitcher), the SP/RP/CL split comes from `role`, confirmed
// against real data (not guessed): of 9,400 non-retired position=1 players,
// role 11/12/13 are the only three non-zero values seen, in proportions
// matching a real roster's SP/RP/CL mix (12 most common ~5,400 = RP, 11
// next ~3,600 = SP, 13 rare ~390 = CL) -- consistent across every position=1
// player checked, never seen on a non-pitcher's own primary position.
const HITTER_POSITION_LABELS: Record<string, string> = {
  "2": "C", "3": "1B", "4": "2B", "5": "3B", "6": "SS", "7": "LF", "8": "CF", "9": "RF", "10": "DH",
};

function derivePositionLabel(position: string, role: string): string {
  if (position === "1") {
    if (role === "11") return "SP";
    if (role === "13") return "CL";
    return "RP"; // covers the confirmed "12" case and any unrecognized pitcher role code
  }
  return HITTER_POSITION_LABELS[position] ?? position;
}

// --- reference / current-state tables --------------------------------------

export function mapTeam(r: DumpRow) {
  return {
    id: int(r["team_id"]),
    name: str(r["name"]),
    nickname: str(r["nickname"]),
    parent_team_id: int(r["parent_team_id"]) || null,
    updated_at: new Date().toISOString(),
  };
}

// `players` (bio) and `players_roster_status` (service time/roster flags)
// are two separate files in the dump -- StatsPlus's own `/players/`
// combines the equivalent OOTP-internal tables into one response, so this
// merges both raw rows the same way, keyed by player_id. `teamParentId`
// resolves what StatsPlus calls "Parent Team ID" for a player: the dump
// only carries that per-TEAM (`teams.parent_team_id`), not per-player, so
// the caller looks it up via the team map built from mapTeam() above.
export function mapPlayer(bio: DumpRow, roster: DumpRow | undefined, teamParentId: number | null, teamLevel: number | null) {
  const r = roster ?? {};
  return {
    id: int(bio["player_id"]),
    first_name: str(bio["first_name"]),
    last_name: str(bio["last_name"]),
    team_id: int(bio["team_id"]) || null,
    parent_team_id: teamParentId,
    // NOT roster.playing_level -- confirmed via real data (2026-09-11,
    // found running Step 6) that field is genuinely 0 for every single
    // player in the dump, not a mapping bug. MLB/AAA/AA/A+/A/A-/Rookie
    // lives on the player's own TEAM instead (teams.level: confirmed 1 for
    // the White Sox, 2 for their AAA affiliate, down to 6 for complex-level
    // affiliates, correctly linked via teams.parent_team_id) -- the same
    // place StatsPlus's own /players/ "Level" field ultimately reflects for
    // TBL, just derived differently at the source.
    level: teamLevel,
    pos: int(bio["position"]),
    role: int(bio["role"]),
    age: int(bio["age"]),
    retired: bool(bio["retired"]),
    organization_id: int(bio["organization_id"]) || null,
    league_id: int(bio["league_id"]),
    date_of_birth: date(bio["date_of_birth"]),
    height: int(bio["height"]),
    weight: int(bio["weight"]),
    bats: int(bio["bats"]),
    throws: int(bio["throws"]),
    draft_year: int(bio["draft_year"]),
    draft_round: int(bio["draft_round"]),
    draft_supplemental: bool(bio["draft_supplemental"]),
    draft_pick: int(bio["draft_pick"]),
    draft_overall_pick: int(bio["draft_overall_pick"]),
    hall_of_fame: bool(bio["hall_of_fame"]),
    inducted: bool(bio["inducted"]),
    uniform_number: int(bio["uniform_number"]),
    is_active: bool(r["is_active"]),
    is_on_secondary: bool(r["is_on_secondary"]),
    is_on_waivers: bool(r["is_on_waivers"]),
    designated_for_assignment: bool(r["designated_for_assignment"]),
    is_on_dl: bool(r["is_on_dl"]),
    is_on_dl60: bool(r["is_on_dl60"]),
    dl_days_this_year: int(r["dl_days_this_year"]),
    mlb_service_years: int(r["mlb_service_years"]),
    mlb_service_days: int(r["mlb_service_days"]),
    mlb_service_days_this_year: int(r["mlb_service_days_this_year"]),
    pro_service_years: int(r["pro_service_years"]),
    pro_service_days: int(r["pro_service_days"]),
    pro_service_days_this_year: int(r["pro_service_days_this_year"]),
    secondary_service_years: int(r["secondary_service_years"]),
    secondary_service_days: int(r["secondary_service_days"]),
    secondary_service_days_this_year: int(r["secondary_service_days_this_year"]),
    days_on_waivers: int(r["days_on_waivers"]),
    days_on_waivers_left: int(r["days_on_waivers_left"]),
    has_received_arbitration: bool(r["has_received_arbitration"]),
    was_traded: bool(r["was_traded"]),
    draft_team_id: int(bio["draft_team_id"]),
    draft_league_id: int(bio["draft_league_id"]),
    free_agent: bool(bio["free_agent"]),
    nation_id: int(bio["nation_id"]),
    last_team_id: int(bio["last_team_id"]),
    years_protected_from_rule_5: int(r["years_protected_from_rule_5"]),
    draft_eligible: bool(bio["draft_eligible"]),
    injury_is_injured: bool(bio["injury_is_injured"]),
    injury_dl_left: int(bio["injury_dl_left"]),
    injury_left: int(bio["injury_left"]),
    updated_at: new Date().toISOString(),
  };
}

// players_contract / players_contract_extension use the exact same field
// names as StatsPlus's /contract/ and /contractextension/ -- both trace
// back to the same OOTP-internal contract structure, so this is a near-
// verbatim passthrough (extra dump-only fields like opt_out/retained are
// deliberately not pulled yet, per the "match StatsPlus first" scope).
const contractFields = (r: DumpRow) => ({
  team_id: int(r["team_id"]),
  league_id: int(r["league_id"]),
  is_major: bool(r["is_major"]),
  no_trade: bool(r["no_trade"]),
  last_year_team_option: bool(r["last_year_team_option"]),
  last_year_player_option: bool(r["last_year_player_option"]),
  last_year_vesting_option: bool(r["last_year_vesting_option"]),
  next_last_year_team_option: bool(r["next_last_year_team_option"]),
  next_last_year_player_option: bool(r["next_last_year_player_option"]),
  next_last_year_vesting_option: bool(r["next_last_year_vesting_option"]),
  contract_team_id: int(r["contract_team_id"]),
  contract_league_id: int(r["contract_league_id"]),
  season_year: int(r["season_year"]),
  salary0: int(r["salary0"]), salary1: int(r["salary1"]), salary2: int(r["salary2"]),
  salary3: int(r["salary3"]), salary4: int(r["salary4"]), salary5: int(r["salary5"]),
  salary6: int(r["salary6"]), salary7: int(r["salary7"]), salary8: int(r["salary8"]),
  salary9: int(r["salary9"]), salary10: int(r["salary10"]), salary11: int(r["salary11"]),
  salary12: int(r["salary12"]), salary13: int(r["salary13"]), salary14: int(r["salary14"]),
  years: int(r["years"]),
  current_year: int(r["current_year"]),
  minimum_pa: int(r["minimum_pa"]), minimum_pa_bonus: int(r["minimum_pa_bonus"]),
  minimum_ip: int(r["minimum_ip"]), minimum_ip_bonus: int(r["minimum_ip_bonus"]),
  mvp_bonus: int(r["mvp_bonus"]), cyyoung_bonus: int(r["cyyoung_bonus"]), allstar_bonus: int(r["allstar_bonus"]),
  next_last_year_option_buyout: int(r["next_last_year_option_buyout"]),
  last_year_option_buyout: int(r["last_year_option_buyout"]),
  updated_at: new Date().toISOString(),
});

export function mapContract(r: DumpRow) {
  return { player_id: int(r["player_id"]), ...contractFields(r) };
}
export function mapContractExtension(r: DumpRow) {
  return { player_id: int(r["player_id"]), ...contractFields(r) };
}
export function mapContractSnapshot(r: DumpRow, refreshRunId: number, capturedAt: string) {
  const { updated_at: _updatedAt, ...fields } = contractFields(r);
  return { refresh_run_id: refreshRunId, player_id: int(r["player_id"]), ...fields, captured_at: capturedAt };
}
export function mapContractExtensionSnapshot(r: DumpRow, refreshRunId: number, capturedAt: string) {
  const { updated_at: _updatedAt, ...fields } = contractFields(r);
  return { refresh_run_id: refreshRunId, player_id: int(r["player_id"]), ...fields, captured_at: capturedAt };
}

// draft_picks has no separate source table in the dump -- OOTP keeps draft
// info directly on each player's own bio row (draft_year/round/pick/etc.),
// unlike StatsPlus which exposes it as its own `/draftv2/` endpoint. This
// derives one draft_picks row per player that actually has draft_eligible/
// picked_in_draft history, called from the orchestrator for every player
// row where `picked_in_draft = 1`.
//
// Two known simplifications vs. the StatsPlus-sourced version, both
// deliberately deferred rather than solved now: `position` is stored as
// OOTP's raw numeric position code (StatsPlus's draftv2 gives a friendly
// label like "SP" instead -- no reliable numeric-code-to-label table exists
// yet in this codebase, and building one correctly needs role handling
// beyond scope here); `auto_pick` and `picked_at` have no equivalent in the
// dump at all (no real-world capture timestamp exists for a point-in-time
// export) and are left null.
export function mapDraftPick(bio: DumpRow, teamName: string | null) {
  return {
    player_id: int(bio["player_id"]),
    draft_year: int(bio["draft_year"]),
    round: int(bio["draft_round"]),
    pick_in_round: int(bio["draft_pick"]),
    supplemental: bool(bio["draft_supplemental"]),
    overall_pick: int(bio["draft_overall_pick"]),
    player_name: [str(bio["first_name"]), str(bio["last_name"])].filter(Boolean).join(" ") || null,
    team_name: teamName,
    team_id: int(bio["draft_team_id"]),
    position: str(bio["position"]),
    age: int(bio["age"]),
    college: bool(bio["college"]),
    auto_pick: null as boolean | null,
    picked_at: null as string | null,
    updated_at: new Date().toISOString(),
  };
}

export function mapGameResult(r: DumpRow, refreshRunId: number) {
  return {
    statsplus_game_id: int(r["game_id"]),
    league_id: int(r["league_id"]),
    home_team_id: int(r["home_team"]),
    away_team_id: int(r["away_team"]),
    attendance: int(r["attendance"]),
    game_date: date(r["date"]),
    game_time: str(r["time"]),
    game_type: int(r["game_type"]),
    played: bool(r["played"]),
    innings: int(r["innings"]),
    home_runs: int(r["runs0"]), away_runs: int(r["runs1"]),
    home_hits: int(r["hits0"]), away_hits: int(r["hits1"]),
    home_errors: int(r["errors0"]), away_errors: int(r["errors1"]),
    winning_pitcher_id: int(r["winning_pitcher"]),
    losing_pitcher_id: int(r["losing_pitcher"]),
    save_pitcher_id: int(r["save_pitcher"]),
    starter_home_id: int(r["starter0"]),
    starter_away_id: int(r["starter1"]),
    refresh_run_id: refreshRunId,
    updated_at: new Date().toISOString(),
  };
}

// --- stats snapshots ---------------------------------------------------
// players_career_batting_stats / _career_pitching_stats / _career_fielding_
// stats already carry one row per player per year/level/split, the same
// shape StatsPlus's playerbatstatsv2/playerpitchstatsv2/playerfieldstatsv2
// return -- and, unlike almost everything else in this file, most of the
// COLUMN NAMES matched StatsPlus's own CSV headers exactly (both trace back
// to the same OOTP internal engine field names), confirmed while reading
// the real schema. No `source_id` exists in the dump (no autoincrement id
// on this table) -- left null, it's informational-only elsewhere.

export function mapPlayerBatting(r: DumpRow, refreshRunId: number, capturedAt: string) {
  return {
    source_id: null as number | null, refresh_run_id: refreshRunId, player_id: int(r["player_id"]), year: int(r["year"]),
    team_id: int(r["team_id"]), game_id: int(r["game_id"]), league_id: int(r["league_id"]), level_id: int(r["level_id"]),
    split_id: int(r["split_id"]), position: int(r["position"]),
    ab: int(r["ab"]), h: int(r["h"]), k: int(r["k"]), pa: int(r["pa"]), pitches_seen: int(r["pitches_seen"]),
    g: int(r["g"]), gs: int(r["gs"]), d: int(r["d"]), t: int(r["t"]), hr: int(r["hr"]), r: int(r["r"]), rbi: int(r["rbi"]),
    sb: int(r["sb"]), cs: int(r["cs"]), bb: int(r["bb"]), ibb: int(r["ibb"]), gdp: int(r["gdp"]), sh: int(r["sh"]),
    sf: int(r["sf"]), hp: int(r["hp"]), ci: int(r["ci"]), wpa: num(r["wpa"]), stint: int(r["stint"]),
    ubr: num(r["ubr"]), war: num(r["war"]), captured_at: capturedAt,
  };
}

export function mapPlayerPitching(r: DumpRow, refreshRunId: number, capturedAt: string) {
  return {
    source_id: null as number | null, refresh_run_id: refreshRunId, player_id: int(r["player_id"]), year: int(r["year"]),
    team_id: int(r["team_id"]), game_id: int(r["game_id"]), league_id: int(r["league_id"]), level_id: int(r["level_id"]),
    split_id: int(r["split_id"]),
    ip: int(r["ip"]), ab: int(r["ab"]), tb: int(r["tb"]), ha: int(r["ha"]), k: int(r["k"]), bf: int(r["bf"]),
    rs: int(r["rs"]), bb: int(r["bb"]), r: int(r["r"]), er: int(r["er"]), gb: int(r["gb"]), fb: int(r["fb"]),
    pi: int(r["pi"]), ipf: int(r["ipf"]), g: int(r["g"]), gs: int(r["gs"]), w: int(r["w"]), l: int(r["l"]),
    s: int(r["s"]), sa: int(r["sa"]), da: int(r["da"]), sh: int(r["sh"]), sf: int(r["sf"]), ta: int(r["ta"]),
    hra: int(r["hra"]), bk: int(r["bk"]), ci: int(r["ci"]), iw: int(r["iw"]), wp: int(r["wp"]), hp: int(r["hp"]),
    gf: int(r["gf"]), dp: int(r["dp"]), qs: int(r["qs"]), svo: int(r["svo"]), bs: int(r["bs"]), ra: int(r["ra"]),
    cg: int(r["cg"]), sho: int(r["sho"]), sb: int(r["sb"]), cs: int(r["cs"]), hld: int(r["hld"]), ir: int(r["ir"]),
    irs: int(r["irs"]), wpa: num(r["wpa"]), li: num(r["li"]), stint: int(r["stint"]), outs: int(r["outs"]),
    sd: int(r["sd"]), md: int(r["md"]), war: num(r["war"]), ra9war: num(r["ra9war"]), captured_at: capturedAt,
  };
}

export function mapPlayerFielding(r: DumpRow, refreshRunId: number, capturedAt: string) {
  return {
    source_id: null as number | null, refresh_run_id: refreshRunId, player_id: int(r["player_id"]), year: int(r["year"]),
    team_id: int(r["team_id"]), league_id: int(r["league_id"]), level_id: int(r["level_id"]), split_id: int(r["split_id"]),
    position: int(r["position"]),
    tc: int(r["tc"]), a: int(r["a"]), po: int(r["po"]), er: int(r["er"]), ip: int(r["ip"]), g: int(r["g"]),
    gs: int(r["gs"]), e: int(r["e"]), dp: int(r["dp"]), tp: int(r["tp"]), pb: int(r["pb"]), sba: int(r["sba"]),
    rto: int(r["rto"]), ipf: int(r["ipf"]), plays: int(r["plays"]), plays_base: int(r["plays_base"]), roe: int(r["roe"]),
    opps_0: int(r["opps_0"]), opps_made_0: int(r["opps_made_0"]), opps_1: int(r["opps_1"]), opps_made_1: int(r["opps_made_1"]),
    opps_2: int(r["opps_2"]), opps_made_2: int(r["opps_made_2"]), opps_3: int(r["opps_3"]), opps_made_3: int(r["opps_made_3"]),
    opps_4: int(r["opps_4"]), opps_made_4: int(r["opps_made_4"]), opps_5: int(r["opps_5"]), opps_made_5: int(r["opps_made_5"]),
    framing: num(r["framing"]), arm: num(r["arm"]), zr: num(r["zr"]), captured_at: capturedAt,
  };
}

// team_batting_stats / team_pitching_stats: mostly direct matches, but a
// few fields StatsPlus's endpoint returns pre-computed (k_pct/bb_pct/babip
// for batting) aren't in the dump's own columns -- derived here with the
// standard formulas rather than left null, since the raw counting stats
// needed for them ARE present. `abbr` isn't on this table at all in the
// dump (it's on `teams`) -- passed in by the caller from the teams map.
export function mapTeamBatting(r: DumpRow, refreshRunId: number, year: number, capturedAt: string, abbr: string | null) {
  const pa = num(r["pa"]) ?? 0;
  const ab = num(r["ab"]) ?? 0;
  const h = num(r["h"]) ?? 0;
  const hr = num(r["hr"]) ?? 0;
  const k = num(r["k"]) ?? 0;
  const bb = num(r["bb"]) ?? 0;
  const sf = num(r["sf"]) ?? 0;
  const babipDenom = ab - k - hr + sf;
  return {
    refresh_run_id: refreshRunId, team_id: int(r["team_id"]), abbr, year,
    split_id: int(r["split_id"]),
    pa: int(r["pa"]), ab: int(r["ab"]), h: int(r["h"]), k: int(r["k"]), tb: int(r["tb"]), s: int(r["s"]),
    d: int(r["d"]), t: int(r["t"]), hr: int(r["hr"]), sb: int(r["sb"]), cs: int(r["cs"]), rbi: int(r["rbi"]),
    r: int(r["r"]), bb: int(r["bb"]), ibb: int(r["ibb"]), hp: int(r["hp"]), sh: int(r["sh"]), sf: int(r["sf"]),
    ci: int(r["ci"]), gidp: int(r["gdp"]), xbh: int(r["ebh"]),
    avg: num(r["avg"]), obp: num(r["obp"]), slg: num(r["slg"]), ops: num(r["ops"]), iso: num(r["iso"]),
    k_pct: pa > 0 ? k / pa : null, bb_pct: pa > 0 ? bb / pa : null,
    babip: babipDenom > 0 ? (h - hr) / babipDenom : null,
    woba: num(r["woba"]), captured_at: capturedAt,
  };
}

// team_pitching_stats: the dump lacks several sabermetric fields StatsPlus
// precomputes (xFIP, LOB%, HR/FB%) that need league-average context we
// don't have wired up yet for Duud -- left null deliberately rather than
// guessed at, matching Rees's "match StatsPlus first, extra fields later"
// scope. k_pct/bb_pct/k_bb_pct/babip ARE derivable from raw counts, so
// those are computed the same way as team batting above.
export function mapTeamPitching(r: DumpRow, refreshRunId: number, year: number, capturedAt: string, abbr: string | null) {
  const bf = num(r["bf"]) ?? 0;
  const k = num(r["k"]) ?? 0;
  const bb = num(r["bb"]) ?? 0;
  const ab = num(r["ab"]) ?? 0;
  const ha = num(r["ha"]) ?? 0;
  const hra = num(r["hra"]) ?? 0;
  const sf = num(r["sf"]) ?? 0;
  const babipDenom = ab - k - hra + sf;
  return {
    refresh_run_id: refreshRunId, team_id: int(r["team_id"]), abbr, year,
    split_id: int(r["split_id"]),
    ip: int(r["ip"]), ab: int(r["ab"]), tb: int(r["tb"]), ha: int(r["ha"]), k: int(r["k"]), bf: int(r["bf"]),
    bb: int(r["bb"]), r: int(r["r"]), er: int(r["er"]), gb: int(r["gb"]), fb: int(r["fb"]), pi: int(r["pi"]),
    ipf: int(r["ipf"]), sa: int(r["sa"]), d: int(r["da"]), sh: int(r["sh"]), sf: int(r["sf"]), t: int(r["ta"]),
    hra: int(r["hra"]), bk: int(r["bk"]), ci: int(r["ci"]), iw: int(r["iw"]), wp: int(r["wp"]), hp: int(r["hp"]),
    s: int(r["s"]), bs: int(r["bs"]), cg: int(r["cg"]), outs: null as number | null,
    era: num(r["era"]), lob: null as number | null, k_pct: bf > 0 ? k / bf : null, bb_pct: bf > 0 ? bb / bf : null,
    k_bb_pct: bf > 0 ? (k - bb) / bf : null, fip: num(r["fip"]), x_fip: null as number | null, e_f: null as number | null,
    babip: babipDenom > 0 ? (ha - hra) / babipDenom : null, gbfb: num(r["gbfbp"]), hrfb: null as number | null, hr_pct: null as number | null,
    avg: num(r["avg"]), obp: num(r["obp"]), captured_at: capturedAt,
  };
}

// --- ratings snapshot ----------------------------------------------------
// players_scouted_ratings is the "show OSA ratings"-and-"show real player
// ratings" OFF export -- i.e. exactly the fogged, scout-generated view
// StatsPlus's own /ratings/ exposes (Rees's call, 2026-09-11: this is
// deliberate, not a gap -- omniscient true ratings would remove the whole
// point of having a scout). Every field below was verified against a real
// player's real row before writing this mapping, not assumed from column
// names alone.
//
// Two things the dump genuinely doesn't have that StatsPlus's /ratings/
// does: makeup/personality traits (Int/WrkEthic/Greed/Loy/Lead/Prone --
// OOTP keeps these on the player BIO table, not the ratings table, and
// they're not used by the rating engine's math today, so left null rather
// than adding a third source table to this merge for now) and GBType/
// FBType come through as raw numeric codes here rather than StatsPlus's
// string labels -- stringified as-is, not translated.
export function mapPlayerRatings(r: DumpRow, refreshRunId: number, capturedAt: string) {
  return {
    refresh_run_id: refreshRunId, player_id: int(r["player_id"]), pos: derivePositionLabel(r["position"], r["role"]),
    league: int(r["league_id"]), team: int(r["team_id"]), org: null as number | null, lg_lvl: null as number | null,
    cntct: int(r["batting_ratings_overall_contact"]), gap: int(r["batting_ratings_overall_gap"]),
    pow: int(r["batting_ratings_overall_power"]), eye: int(r["batting_ratings_overall_eye"]),
    ks: int(r["batting_ratings_overall_strikeouts"]), babip: int(r["batting_ratings_overall_babip"]),
    cntct_r: int(r["batting_ratings_vsr_contact"]), gap_r: int(r["batting_ratings_vsr_gap"]),
    pow_r: int(r["batting_ratings_vsr_power"]), eye_r: int(r["batting_ratings_vsr_eye"]),
    ks_r: int(r["batting_ratings_vsr_strikeouts"]), babip_r: int(r["batting_ratings_vsr_babip"]),
    cntct_l: int(r["batting_ratings_vsl_contact"]), gap_l: int(r["batting_ratings_vsl_gap"]),
    pow_l: int(r["batting_ratings_vsl_power"]), eye_l: int(r["batting_ratings_vsl_eye"]),
    ks_l: int(r["batting_ratings_vsl_strikeouts"]), babip_l: int(r["batting_ratings_vsl_babip"]),
    pot_cntct: int(r["batting_ratings_talent_contact"]), pot_gap: int(r["batting_ratings_talent_gap"]),
    pot_pow: int(r["batting_ratings_talent_power"]), pot_eye: int(r["batting_ratings_talent_eye"]),
    pot_ks: int(r["batting_ratings_talent_strikeouts"]), pot_babip: int(r["batting_ratings_talent_babip"]),
    ifr: int(r["fielding_ratings_infield_range"]), ife: int(r["fielding_ratings_infield_error"]),
    ifa: int(r["fielding_ratings_infield_arm"]), tdp: int(r["fielding_ratings_turn_doubleplay"]),
    ofr: int(r["fielding_ratings_outfield_range"]), ofe: int(r["fielding_ratings_outfield_error"]),
    ofa: int(r["fielding_ratings_outfield_arm"]),
    cblk: int(r["fielding_ratings_catcher_ability"]), carm: int(r["fielding_ratings_catcher_arm"]),
    cfrm: int(r["fielding_ratings_catcher_framing"]),
    pos_p: int(r["fielding_rating_pos1"]), pos_c: int(r["fielding_rating_pos2"]), pos_1b: int(r["fielding_rating_pos3"]),
    pos_2b: int(r["fielding_rating_pos4"]), pos_3b: int(r["fielding_rating_pos5"]), pos_ss: int(r["fielding_rating_pos6"]),
    pos_lf: int(r["fielding_rating_pos7"]), pos_cf: int(r["fielding_rating_pos8"]), pos_rf: int(r["fielding_rating_pos9"]),
    pot_p: int(r["fielding_rating_pos1_pot"]), pot_c: int(r["fielding_rating_pos2_pot"]), pot_1b: int(r["fielding_rating_pos3_pot"]),
    pot_2b: int(r["fielding_rating_pos4_pot"]), pot_3b: int(r["fielding_rating_pos5_pot"]), pot_ss: int(r["fielding_rating_pos6_pot"]),
    pot_lf: int(r["fielding_rating_pos7_pot"]), pot_cf: int(r["fielding_rating_pos8_pot"]), pot_rf: int(r["fielding_rating_pos9_pot"]),
    speed: int(r["running_ratings_speed"]), stlrt: int(r["running_ratings_stealing_rate"]),
    steal: int(r["running_ratings_stealing"]), run: int(r["running_ratings_baserunning"]),
    sacbunt: int(r["batting_ratings_misc_bunt"]), bunthit: int(r["batting_ratings_misc_bunt_for_hit"]),
    gbtype: str(r["batting_ratings_misc_gb_hitter_type"]), fbtype: str(r["batting_ratings_misc_fb_hitter_type"]),
    stf: int(r["pitching_ratings_overall_stuff"]), mov: int(r["pitching_ratings_overall_movement"]),
    hra: int(r["pitching_ratings_overall_hra"]), pbabip: int(r["pitching_ratings_overall_pbabip"]),
    ctrl: int(r["pitching_ratings_overall_control"]),
    stf_r: int(r["pitching_ratings_vsr_stuff"]), mov_r: int(r["pitching_ratings_vsr_movement"]),
    hra_r: int(r["pitching_ratings_vsr_hra"]), pbabip_r: int(r["pitching_ratings_vsr_pbabip"]),
    ctrl_r: int(r["pitching_ratings_vsr_control"]),
    stf_l: int(r["pitching_ratings_vsl_stuff"]), mov_l: int(r["pitching_ratings_vsl_movement"]),
    hra_l: int(r["pitching_ratings_vsl_hra"]), pbabip_l: int(r["pitching_ratings_vsl_pbabip"]),
    ctrl_l: int(r["pitching_ratings_vsl_control"]),
    pot_stf: int(r["pitching_ratings_talent_stuff"]), pot_mov: int(r["pitching_ratings_talent_movement"]),
    pot_hra: int(r["pitching_ratings_talent_hra"]), pot_pbabip: int(r["pitching_ratings_talent_pbabip"]),
    pot_ctrl: int(r["pitching_ratings_talent_control"]),
    vel: str(r["pitching_ratings_misc_velocity"]), pot_vel: str(r["pitching_ratings_misc_velocity_target"]),
    armslot: str(r["pitching_ratings_misc_arm_slot"]), gb: int(r["pitching_ratings_misc_ground_fly"]),
    stm: int(r["pitching_ratings_misc_stamina"]), hold: int(r["pitching_ratings_misc_hold"]),
    fst: int(r["pitching_ratings_pitches_fastball"]), snk: int(r["pitching_ratings_pitches_sinker"]),
    cutt: int(r["pitching_ratings_pitches_cutter"]), crv: int(r["pitching_ratings_pitches_curveball"]),
    sld: int(r["pitching_ratings_pitches_slider"]), chg: int(r["pitching_ratings_pitches_changeup"]),
    splt: int(r["pitching_ratings_pitches_splitter"]), frk: int(r["pitching_ratings_pitches_forkball"]),
    circhg: int(r["pitching_ratings_pitches_circlechange"]), scr: int(r["pitching_ratings_pitches_screwball"]),
    kncrv: int(r["pitching_ratings_pitches_knucklecurve"]), knbl: int(r["pitching_ratings_pitches_knuckleball"]),
    pot_fst: int(r["pitching_ratings_pitches_talent_fastball"]), pot_snk: int(r["pitching_ratings_pitches_talent_sinker"]),
    pot_cutt: int(r["pitching_ratings_pitches_talent_cutter"]), pot_crv: int(r["pitching_ratings_pitches_talent_curveball"]),
    pot_sld: int(r["pitching_ratings_pitches_talent_slider"]), pot_chg: int(r["pitching_ratings_pitches_talent_changeup"]),
    pot_splt: int(r["pitching_ratings_pitches_talent_splitter"]), pot_frk: int(r["pitching_ratings_pitches_talent_forkball"]),
    pot_circhg: int(r["pitching_ratings_pitches_talent_circlechange"]), pot_scr: int(r["pitching_ratings_pitches_talent_screwball"]),
    pot_kncrv: int(r["pitching_ratings_pitches_talent_knucklecurve"]), pot_knbl: int(r["pitching_ratings_pitches_talent_knuckleball"]),
    int_: null as string | null, wrkethic: null as string | null, greed: null as string | null, loy: null as string | null,
    lead: null as string | null, prone: null as string | null, acc: str(r["scouting_accuracy"]),
    // Deliberately left null, not guessed: `overall`/`talent` in the dump
    // are real, populated numbers (confirmed against a real player) but on
    // a scale that doesn't match a 20-80-ish grade (146/164 for a real
    // rookie catcher) -- likely some other internal composite, not the
    // same "Ovr"/"Pot" StatsPlus exposes. The *actually meaningful* Overall
    // /Potential shown anywhere on the site are independently derived from
    // the individual tool grades above by lib/rating-engine.ts, which
    // explicitly never reads this raw field (see its own top comment) --
    // so leaving this null costs nothing functionally. Revisit if a real
    // use for the dump's own overall/talent numbers ever comes up.
    ovr: null as number | null, pot: null as number | null,
    captured_at: capturedAt,
  };
}
