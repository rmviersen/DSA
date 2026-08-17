import type { RawRow } from "./statsplus-client.js";

// --- type coercion helpers -------------------------------------------------
// StatsPlus CSVs use blank string for null, "0"/"1" for booleans. These
// helpers make that explicit instead of letting bad data silently become 0/false.

const int = (v: string | undefined): number | null => (v === undefined || v === "" ? null : parseInt(v, 10));
const num = (v: string | undefined): number | null => (v === undefined || v === "" ? null : parseFloat(v));
const bool = (v: string | undefined): boolean | null => (v === undefined || v === "" ? null : v === "1" || v.toLowerCase() === "true");
const str = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);
const date = (v: string | undefined): string | null => (v === undefined || v === "" || v === "0" ? null : v);

// --- reference / current-state tables --------------------------------------

export function mapTeam(r: RawRow) {
  return {
    id: int(r["ID"]),
    name: str(r["Name"]),
    nickname: str(r["Nickname"]),
    parent_team_id: int(r["Parent Team ID"]) || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapPlayer(r: RawRow) {
  return {
    id: int(r["ID"]),
    first_name: str(r["First Name"]),
    last_name: str(r["Last Name"]),
    team_id: int(r["Team ID"]) || null,
    parent_team_id: int(r["Parent Team ID"]),
    level: int(r["Level"]),
    pos: int(r["Pos"]),
    role: int(r["Role"]),
    age: int(r["Age"]),
    retired: bool(r["Retired"]),
    organization_id: int(r["Organization ID"]) || null,
    league_id: int(r["League ID"]),
    date_of_birth: date(r["date_of_birth"]),
    height: int(r["height"]),
    weight: int(r["weight"]),
    bats: int(r["bats"]),
    throws: int(r["throws"]),
    draft_year: int(r["draft_year"]),
    draft_round: int(r["draft_round"]),
    draft_supplemental: bool(r["draft_supplemental"]),
    draft_pick: int(r["draft_pick"]),
    draft_overall_pick: int(r["draft_overall_pick"]),
    hall_of_fame: bool(r["hall_of_fame"]),
    inducted: bool(r["inducted"]),
    uniform_number: int(r["uniform_number"]),
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
    draft_team_id: int(r["draft_team_id"]),
    draft_league_id: int(r["draft_league_id"]),
    free_agent: bool(r["free_agent"]),
    nation_id: int(r["nation_id"]),
    last_team_id: int(r["last_team_id"]),
    years_protected_from_rule_5: int(r["years_protected_from_rule_5"]),
    draft_eligible: bool(r["draft_eligible"]),
    injury_is_injured: bool(r["injury_is_injured"]),
    injury_dl_left: int(r["injury_dl_left"]),
    injury_left: int(r["injury_left"]),
    updated_at: new Date().toISOString(),
  };
}

const contractFields = (r: RawRow) => ({
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

export function mapContract(r: RawRow) {
  return { player_id: int(r["player_id"]), ...contractFields(r) };
}
export function mapContractExtension(r: RawRow) {
  return { player_id: int(r["player_id"]), ...contractFields(r) };
}

export function mapDraftPick(r: RawRow) {
  const pickedAt = str(r["Time (UTC)"]);
  const draftYear = pickedAt ? parseInt(pickedAt.slice(0, 4), 10) : null; // derived from the pick timestamp, not a field the endpoint provides
  return {
    player_id: int(r["ID"]),
    draft_year: draftYear,
    round: int(r["Round"]),
    pick_in_round: int(r["Pick In Round"]),
    supplemental: bool(r["Supp"]),
    overall_pick: int(r["Overall"]),
    player_name: str(r["Player Name"]),
    team_name: str(r["Team"]),
    team_id: int(r["Team ID"]),
    position: str(r["Position"]),
    age: int(r["Age"]),
    college: bool(r["College"]),
    auto_pick: bool(r["Auto Pick"]),
    picked_at: pickedAt,
    updated_at: new Date().toISOString(),
  };
}

export function mapGameResult(r: RawRow, refreshRunId: number) {
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
    doubleheader_game: int(r["dh"]),
    innings: int(r["innings"]),
    home_runs: int(r["runs0"]), away_runs: int(r["runs1"]),
    home_hits: int(r["hits0"]), away_hits: int(r["hits1"]),
    home_errors: int(r["errors0"]), away_errors: int(r["errors1"]),
    winning_pitcher_id: int(r["winning_pitcher"]),
    losing_pitcher_id: int(r["losing_pitcher"]),
    save_pitcher_id: int(r["save_pitcher"]),
    starter_home_id: int(r["starter0"]),
    starter_away_id: int(r["starter1"]),
    cup: bool(r["cup"]),
    refresh_run_id: refreshRunId,
    updated_at: new Date().toISOString(),
  };
}

// --- stats snapshots ---------------------------------------------------

export function mapPlayerBatting(r: RawRow, refreshRunId: number, capturedAt: string) {
  return {
    source_id: int(r["id"]), refresh_run_id: refreshRunId, player_id: int(r["player_id"]), year: int(r["year"]),
    team_id: int(r["team_id"]), game_id: int(r["game_id"]), league_id: int(r["league_id"]), level_id: int(r["level_id"]),
    split_id: int(r["split_id"]), position: int(r["position"]),
    ab: int(r["ab"]), h: int(r["h"]), k: int(r["k"]), pa: int(r["pa"]), pitches_seen: int(r["pitches_seen"]),
    g: int(r["g"]), gs: int(r["gs"]), d: int(r["d"]), t: int(r["t"]), hr: int(r["hr"]), r: int(r["r"]), rbi: int(r["rbi"]),
    sb: int(r["sb"]), cs: int(r["cs"]), bb: int(r["bb"]), ibb: int(r["ibb"]), gdp: int(r["gdp"]), sh: int(r["sh"]),
    sf: int(r["sf"]), hp: int(r["hp"]), ci: int(r["ci"]), wpa: num(r["wpa"]), stint: int(r["stint"]),
    ubr: num(r["ubr"]), war: num(r["war"]), captured_at: capturedAt,
  };
}

export function mapPlayerPitching(r: RawRow, refreshRunId: number, capturedAt: string) {
  return {
    source_id: int(r["id"]), refresh_run_id: refreshRunId, player_id: int(r["player_id"]), year: int(r["year"]),
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

export function mapPlayerFielding(r: RawRow, refreshRunId: number, capturedAt: string) {
  return {
    source_id: int(r["id"]), refresh_run_id: refreshRunId, player_id: int(r["player_id"]), year: int(r["year"]),
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

export function mapTeamBatting(r: RawRow, refreshRunId: number, year: number, capturedAt: string) {
  return {
    refresh_run_id: refreshRunId, team_id: int(r["tid"]), abbr: str(r["abbr"]), year,
    split_id: int(r["split_id"]),
    pa: int(r["pa"]), ab: int(r["ab"]), h: int(r["h"]), k: int(r["k"]), tb: int(r["tb"]), s: int(r["s"]),
    d: int(r["d"]), t: int(r["t"]), hr: int(r["hr"]), sb: int(r["sb"]), cs: int(r["cs"]), rbi: int(r["rbi"]),
    r: int(r["r"]), bb: int(r["bb"]), ibb: int(r["ibb"]), hp: int(r["hp"]), sh: int(r["sh"]), sf: int(r["sf"]),
    ci: int(r["ci"]), gidp: int(r["gidp"]), xbh: int(r["xbh"]),
    avg: num(r["avg"]), obp: num(r["obp"]), slg: num(r["slg"]), ops: num(r["ops"]), iso: num(r["iso"]),
    k_pct: num(r["k_pct"]), bb_pct: num(r["bb_pct"]), babip: num(r["babip"]), woba: num(r["woba"]),
    captured_at: capturedAt,
  };
}

export function mapTeamPitching(r: RawRow, refreshRunId: number, year: number, capturedAt: string) {
  return {
    refresh_run_id: refreshRunId, team_id: int(r["tid"]), abbr: str(r["abbr"]), year,
    split_id: int(r["split_id"]),
    ip: int(r["ip"]), ab: int(r["ab"]), tb: int(r["tb"]), ha: int(r["ha"]), k: int(r["k"]), bf: int(r["bf"]),
    bb: int(r["bb"]), r: int(r["r"]), er: int(r["er"]), gb: int(r["gb"]), fb: int(r["fb"]), pi: int(r["pi"]),
    ipf: int(r["ipf"]), sa: int(r["sa"]), d: int(r["d"]), sh: int(r["sh"]), sf: int(r["sf"]), t: int(r["t"]),
    hra: int(r["hra"]), bk: int(r["bk"]), ci: int(r["ci"]), iw: int(r["iw"]), wp: int(r["wp"]), hp: int(r["hp"]),
    s: int(r["s"]), bs: int(r["bs"]), cg: int(r["cg"]), outs: int(r["outs"]),
    era: num(r["era"]), lob: num(r["lob"]), k_pct: num(r["k_pct"]), bb_pct: num(r["bb_pct"]),
    k_bb_pct: num(r["k_bb_pct"]), fip: num(r["fip"]), x_fip: num(r["x_fip"]), e_f: num(r["e_f"]),
    babip: num(r["babip"]), gbfb: num(r["gbfb"]), hrfb: num(r["hrfb"]), hr_pct: num(r["hr_pct"]),
    avg: num(r["avg"]), obp: num(r["obp"]), captured_at: capturedAt,
  };
}

// --- ratings snapshot ----------------------------------------------------

export function mapPlayerRatings(r: RawRow, refreshRunId: number, capturedAt: string) {
  return {
    refresh_run_id: refreshRunId, player_id: int(r["ID"]), pos: str(r["Pos"]),
    league: int(r["League"]), team: int(r["Team"]), org: int(r["Org"]), lg_lvl: int(r["LgLvl"]),
    cntct: int(r["Cntct"]), gap: int(r["Gap"]), pow: int(r["Pow"]), eye: int(r["Eye"]), ks: int(r["Ks"]), babip: int(r["BABIP"]),
    cntct_r: int(r["Cntct_R"]), gap_r: int(r["Gap_R"]), pow_r: int(r["Pow_R"]), eye_r: int(r["Eye_R"]), ks_r: int(r["Ks_R"]), babip_r: int(r["BABIP_R"]),
    cntct_l: int(r["Cntct_L"]), gap_l: int(r["Gap_L"]), pow_l: int(r["Pow_L"]), eye_l: int(r["Eye_L"]), ks_l: int(r["Ks_L"]), babip_l: int(r["BABIP_L"]),
    pot_cntct: int(r["PotCntct"]), pot_gap: int(r["PotGap"]), pot_pow: int(r["PotPow"]), pot_eye: int(r["PotEye"]), pot_ks: int(r["PotKs"]), pot_babip: int(r["PotBABIP"]),
    ifr: int(r["IFR"]), ife: int(r["IFE"]), ifa: int(r["IFA"]), tdp: int(r["TDP"]), ofr: int(r["OFR"]), ofe: int(r["OFE"]), ofa: int(r["OFA"]),
    cblk: int(r["CBlk"]), carm: int(r["CArm"]), cfrm: int(r["CFrm"]),
    pos_p: int(r["P"]), pos_c: int(r["C"]), pos_1b: int(r["1B"]), pos_2b: int(r["2B"]), pos_3b: int(r["3B"]),
    pos_ss: int(r["SS"]), pos_lf: int(r["LF"]), pos_cf: int(r["CF"]), pos_rf: int(r["RF"]),
    pot_p: int(r["PotP"]), pot_c: int(r["PotC"]), pot_1b: int(r["Pot1B"]), pot_2b: int(r["Pot2B"]), pot_3b: int(r["Pot3B"]),
    pot_ss: int(r["PotSS"]), pot_lf: int(r["PotLF"]), pot_cf: int(r["PotCF"]), pot_rf: int(r["PotRF"]),
    speed: int(r["Speed"]), stlrt: int(r["StlRt"]), steal: int(r["Steal"]), run: int(r["Run"]),
    sacbunt: int(r["SacBunt"]), bunthit: int(r["BuntHit"]),
    gbtype: str(r["GBType"]), fbtype: str(r["FBType"]),
    stf: int(r["Stf"]), mov: int(r["Mov"]), hra: int(r["HRA"]), pbabip: int(r["PBABIP"]), ctrl: int(r["Ctrl"]),
    stf_r: int(r["Stf_R"]), mov_r: int(r["Mov_R"]), hra_r: int(r["HRA_R"]), pbabip_r: int(r["PBABIP_R"]), ctrl_r: int(r["Ctrl_R"]),
    stf_l: int(r["Stf_L"]), mov_l: int(r["Mov_L"]), hra_l: int(r["HRA_L"]), pbabip_l: int(r["PBABIP_L"]), ctrl_l: int(r["Ctrl_L"]),
    pot_stf: int(r["PotStf"]), pot_mov: int(r["PotMov"]), pot_hra: int(r["PotHRA"]), pot_pbabip: int(r["PotPBABIP"]), pot_ctrl: int(r["PotCtrl"]),
    vel: str(r["Vel"]), pot_vel: str(r["PotVel"]), armslot: str(r["ArmSlot"]), gb: int(r["GB"]), stm: int(r["Stm"]), hold: int(r["Hold"]),
    fst: int(r["Fst"]), snk: int(r["Snk"]), cutt: int(r["Cutt"]), crv: int(r["Crv"]), sld: int(r["Sld"]), chg: int(r["Chg"]),
    splt: int(r["Splt"]), frk: int(r["Frk"]), circhg: int(r["CirChg"]), scr: int(r["Scr"]), kncrv: int(r["Kncrv"]), knbl: int(r["Knbl"]),
    pot_fst: int(r["PotFst"]), pot_snk: int(r["PotSnk"]), pot_cutt: int(r["PotCutt"]), pot_crv: int(r["PotCrv"]), pot_sld: int(r["PotSld"]),
    pot_chg: int(r["PotChg"]), pot_splt: int(r["PotSplt"]), pot_frk: int(r["PotFrk"]), pot_circhg: int(r["PotCirChg"]),
    pot_scr: int(r["PotScr"]), pot_kncrv: int(r["PotKncrv"]), pot_knbl: int(r["PotKnbl"]),
    int_: str(r["Int"]), wrkethic: str(r["WrkEthic"]), greed: str(r["Greed"]), loy: str(r["Loy"]), lead: str(r["Lead"]),
    prone: str(r["Prone"]), acc: str(r["Acc"]),
    ovr: num(r["Ovr"]), pot: num(r["Pot"]),
    captured_at: capturedAt,
  };
}
