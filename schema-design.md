# Database Schema Design — Proposal (Rev. 2)

**Status:** Draft for review. Nothing has been applied to any database yet.

**What changed from Rev. 1:** every raw-data table below is now built directly from a real, complete sample pulled from the actual StatsPlus endpoint — column names and types match what StatsPlus actually returns, not our old Power BI naming. Every field the endpoint returns is included, not just the ones we knew we'd need — the idea being any of these could turn into a report later without a schema change. Two endpoints (`playerpitchstatsv2`, `playerfieldstatsv2`) and the full width of `contract`/`contractextension` were sampled for the first time this pass.

## Design principles (unchanged from Rev. 1)

1. **Everything is a snapshot**, tied to a `refresh_runs` row — lets us diff any two points in time (recent form, riser/faller tracking) automatically.
2. **Raw vs. computed are separate** — `*_snapshots` tables are unmodified StatsPlus data; `*_computed` tables are our rating engine's output, computed once per refresh and stored.
3. **Structural/bio data holds current state only**, upserted on refresh.
4. **Future-phase tables are shaped now**, populated later.

---

## Meta

```sql
create table refresh_runs (
  id                bigint generated always as identity primary key,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  status            text not null check (status in ('running','succeeded','failed','partial')),
  ratings_included  boolean not null default false,
  notes             text
);
```

## Reference / current-state data

### `teams` — from `/teams/`
```sql
create table teams (
  id              int primary key,
  name            text not null,
  nickname        text not null,
  parent_team_id  int references teams(id),
  updated_at      timestamptz not null default now()
);
```

### `players` — from `/players/`
All 55 source fields, exact meaning preserved. Note `pos`, `bats`, `throws` are StatsPlus's own numeric codes here (not letter codes like other endpoints) — kept as `int` to match the source; decode to display labels in the app layer, not the schema.
```sql
create table players (
  id                    int primary key,
  first_name            text,
  last_name             text,
  team_id               int references teams(id),
  parent_team_id        int,
  level                 int,
  pos                   int,          -- numeric position code (source-native)
  role                  int,
  age                   int,
  retired               boolean,
  organization_id       int references teams(id),
  league_id             int,
  date_of_birth         date,
  height                int,
  weight                int,
  bats                  int,          -- numeric code (source-native)
  throws                int,          -- numeric code (source-native)
  draft_year            int,
  draft_round           int,
  draft_supplemental    boolean,
  draft_pick            int,
  draft_overall_pick    int,
  hall_of_fame          boolean,
  inducted              boolean,
  uniform_number        int,
  is_active             boolean,
  is_on_secondary       boolean,
  is_on_waivers         boolean,
  designated_for_assignment boolean,
  is_on_dl              boolean,
  is_on_dl60            boolean,
  dl_days_this_year     int,
  mlb_service_years     int,
  mlb_service_days      int,
  mlb_service_days_this_year int,
  pro_service_years     int,
  pro_service_days      int,
  pro_service_days_this_year int,
  secondary_service_years int,
  secondary_service_days  int,
  secondary_service_days_this_year int,
  days_on_waivers       int,
  days_on_waivers_left  int,
  has_received_arbitration boolean,
  was_traded            boolean,
  draft_team_id         int,
  draft_league_id       int,
  free_agent            boolean,
  nation_id             int,
  last_team_id          int,
  years_protected_from_rule_5 int,
  draft_eligible        boolean,
  injury_is_injured     boolean,
  injury_dl_left        int,
  injury_left           int,
  updated_at            timestamptz not null default now()
);
```

### `contracts` — from `/contract/` (39 fields, not 21 — bonus/option fields were missed in Rev. 1)
```sql
create table contracts (
  player_id             int primary key references players(id),
  team_id               int, league_id int,
  is_major              boolean, no_trade boolean,
  last_year_team_option boolean, last_year_player_option boolean, last_year_vesting_option boolean,
  next_last_year_team_option boolean, next_last_year_player_option boolean, next_last_year_vesting_option boolean,
  contract_team_id      int, contract_league_id int,
  season_year           int,
  salary0 bigint, salary1 bigint, salary2 bigint, salary3 bigint, salary4 bigint,
  salary5 bigint, salary6 bigint, salary7 bigint, salary8 bigint, salary9 bigint,
  salary10 bigint, salary11 bigint, salary12 bigint, salary13 bigint, salary14 bigint,  -- 15 years of salary, confirmed real
  years                 int,
  current_year          int,
  minimum_pa             int, minimum_pa_bonus bigint,
  minimum_ip              int, minimum_ip_bonus bigint,
  mvp_bonus bigint, cyyoung_bonus bigint, allstar_bonus bigint,
  next_last_year_option_buyout bigint, last_year_option_buyout bigint,
  updated_at            timestamptz not null default now()
);
```

### `contract_extensions` — from `/contractextension/`
**Confirmed real, not a stub** — identical shape to `contracts` (same 39 fields), sparse (97 of 13,892 rows had actual extension terms in testing — most players simply don't have one). Same DDL as `contracts` above, same table shape:
```sql
create table contract_extensions (
  player_id             int primary key references players(id),
  team_id int, league_id int, is_major boolean, no_trade boolean,
  last_year_team_option boolean, last_year_player_option boolean, last_year_vesting_option boolean,
  next_last_year_team_option boolean, next_last_year_player_option boolean, next_last_year_vesting_option boolean,
  contract_team_id int, contract_league_id int, season_year int,
  salary0 bigint, salary1 bigint, salary2 bigint, salary3 bigint, salary4 bigint,
  salary5 bigint, salary6 bigint, salary7 bigint, salary8 bigint, salary9 bigint,
  salary10 bigint, salary11 bigint, salary12 bigint, salary13 bigint, salary14 bigint,
  years int, current_year int,
  minimum_pa int, minimum_pa_bonus bigint, minimum_ip int, minimum_ip_bonus bigint,
  mvp_bonus bigint, cyyoung_bonus bigint, allstar_bonus bigint,
  next_last_year_option_buyout bigint, last_year_option_buyout bigint,
  updated_at timestamptz not null default now()
);
```

### `draft_picks` — from `/draftv2/`
```sql
create table draft_picks (
  player_id       int primary key references players(id),   -- "ID" column IS the player id
  draft_year      int not null,   -- captured from the refresh context, not a field in this endpoint itself
  round           int, pick_in_round int, supplemental boolean, overall_pick int,
  player_name     text,          -- denormalized for convenience
  team_name       text,          -- as reported ("Team" text field)
  team_id         int references teams(id),
  position        text,          -- letter code here (e.g. "SP"), unlike players.pos
  age             int,
  college          boolean,
  auto_pick       boolean,
  picked_at       timestamptz,   -- "Time (UTC)"
  updated_at      timestamptz not null default now()
);
```

---

## Stats — time-series snapshots

### `player_batting_stats_snapshots` — from `/playerbatstatsv2/` (34 fields)
```sql
create table player_batting_stats_snapshots (
  id              bigint generated always as identity primary key,
  refresh_run_id  bigint not null references refresh_runs(id),
  player_id       int not null references players(id),
  year            int not null,
  team_id int, game_id int, league_id int, level_id int, split_id int, position int,
  ab int, h int, k int, pa int, pitches_seen int, g int, gs int,
  d int, t int, hr int, r int, rbi int, sb int, cs int,
  bb int, ibb int, gdp int, sh int, sf int, hp int, ci int,
  wpa numeric, stint int, ubr numeric, war numeric,
  captured_at     timestamptz not null,
  unique (refresh_run_id, player_id, year, split_id, team_id, game_id)
);
```

### `player_pitching_stats_snapshots` — from `/playerpitchstatsv2/` (confirmed, 59 fields — much wider than assumed in Rev. 1)
```sql
create table player_pitching_stats_snapshots (
  id              bigint generated always as identity primary key,
  refresh_run_id  bigint not null references refresh_runs(id),
  player_id       int not null references players(id),
  year            int not null,
  team_id int, game_id int, league_id int, level_id int, split_id int,
  ip int, ab int, tb int, ha int, k int, bf int, rs int, bb int, r int, er int,
  gb int, fb int, pi int, ipf int,
  g int, gs int, w int, l int, s int,           -- s = saves
  sa int, da int, sh int, sf int, ta int, hra int, bk int, ci int, iw int, wp int, hp int,
  gf int, dp int, qs int, svo int, bs int, ra int, cg int, sho int, sb int, cs int,
  hld int, ir int, irs int,
  wpa numeric, li numeric, stint int, outs int, sd int, md int,
  war numeric, ra9war numeric,
  captured_at     timestamptz not null,
  unique (refresh_run_id, player_id, year, split_id, team_id, game_id)
);
```

### `player_fielding_stats_snapshots` — from `/playerfieldstatsv2/` (confirmed, 38 fields)
```sql
create table player_fielding_stats_snapshots (
  id              bigint generated always as identity primary key,
  refresh_run_id  bigint not null references refresh_runs(id),
  player_id       int not null references players(id),
  year            int not null,
  team_id int, league_id int, level_id int, split_id int, position int,
  tc int, a int, po int, er int, ip int, g int, gs int, e int, dp int, tp int, pb int, sba int, rto int, ipf int,
  plays int, plays_base int, roe int,
  opps_0 int, opps_made_0 int, opps_1 int, opps_made_1 int, opps_2 int, opps_made_2 int,
  opps_3 int, opps_made_3 int, opps_4 int, opps_made_4 int, opps_5 int, opps_made_5 int,
  framing numeric, arm numeric, zr numeric,
  captured_at     timestamptz not null,
  unique (refresh_run_id, player_id, year, split_id, team_id, position)
);
```

### `team_batting_stats_snapshots` — from `/teambatstats/` (34 fields)
```sql
create table team_batting_stats_snapshots (
  id              bigint generated always as identity primary key,
  refresh_run_id  bigint not null references refresh_runs(id),
  team_id         int not null references teams(id),
  abbr            text,
  split_id        int,
  pa int, ab int, h int, k int, tb int, s int, d int, t int, hr int,
  sb int, cs int, rbi int, r int, bb int, ibb int, hp int, sh int, sf int,
  ci int, gidp int, xbh int,
  avg numeric, obp numeric, slg numeric, ops numeric, iso numeric,
  k_pct numeric, bb_pct numeric, babip numeric, woba numeric,
  captured_at     timestamptz not null,
  unique (refresh_run_id, team_id, split_id)
);
```

### `team_pitching_stats_snapshots` — from `/teampitchstats/` (confirmed, 44 fields)
```sql
create table team_pitching_stats_snapshots (
  id              bigint generated always as identity primary key,
  refresh_run_id  bigint not null references refresh_runs(id),
  team_id         int not null references teams(id),
  abbr            text,
  split_id        int,
  ip int, ab int, tb int, ha int, k int, bf int, bb int, r int, er int,
  gb int, fb int, pi int, ipf int,
  sa int, d int, sh int, sf int, t int, hra int, bk int, ci int, iw int, wp int, hp int,
  s int, bs int, cg int, outs int,
  era numeric, lob numeric, k_pct numeric, bb_pct numeric, k_bb_pct numeric,
  fip numeric, x_fip numeric, e_f numeric, babip numeric,
  gbfb numeric, hrfb numeric, hr_pct numeric, avg numeric, obp numeric,
  captured_at     timestamptz not null,
  unique (refresh_run_id, team_id, split_id)
);
```

---

## Ratings — time-series snapshots

*(Unchanged from Rev. 1 — this table was already built from the full real `/ratings/` header. Adding the 4 columns that were present in the source but missing from Rev. 1's draft: `league`, `team`, `org`, `lg_lvl` — worth keeping even though they duplicate `players` fields, since a ratings snapshot should stand on its own as a historical record of where a player was at that moment.)*

```sql
create table player_ratings_snapshots (
  id              bigint generated always as identity primary key,
  refresh_run_id  bigint not null references refresh_runs(id),
  player_id       int not null references players(id),
  league int, team int, org int, lg_lvl int,           -- added: point-in-time context
  cntct int, gap int, pow int, eye int, ks int, babip int,
  cntct_r int, gap_r int, pow_r int, eye_r int, ks_r int, babip_r int,
  cntct_l int, gap_l int, pow_l int, eye_l int, ks_l int, babip_l int,
  pot_cntct int, pot_gap int, pot_pow int, pot_eye int, pot_ks int, pot_babip int,
  ifr int, ife int, ifa int, tdp int, ofr int, ofe int, ofa int,
  cblk int, carm int, cfrm int,
  pos_p int, pos_c int, pos_1b int, pos_2b int, pos_3b int, pos_ss int, pos_lf int, pos_cf int, pos_rf int,
  pot_p int, pot_c int, pot_1b int, pot_2b int, pot_3b int, pot_ss int, pot_lf int, pot_cf int, pot_rf int,
  speed int, stlrt int, steal int, run int, sacbunt int, bunthit int,
  gbtype text, fbtype text,
  stf int, mov int, hra int, pbabip int, ctrl int,
  stf_r int, mov_r int, hra_r int, pbabip_r int, ctrl_r int,
  stf_l int, mov_l int, hra_l int, pbabip_l int, ctrl_l int,
  pot_stf int, pot_mov int, pot_hra int, pot_pbabip int, pot_ctrl int,
  vel text, pot_vel text, armslot text, gb int, stm int, hold int,
  fst int, snk int, cutt int, crv int, sld int, chg int, splt int, frk int, circhg int, scr int, kncrv int, knbl int,
  pot_fst int, pot_snk int, pot_cutt int, pot_crv int, pot_sld int, pot_chg int, pot_splt int, pot_frk int, pot_circhg int, pot_scr int, pot_kncrv int, pot_knbl int,
  int_ text, wrkethic text, greed text, loy text, lead text, prone text, acc text,
  ovr numeric, pot numeric,
  captured_at     timestamptz not null,
  unique (refresh_run_id, player_id)
);

create table draft_prospect_ratings_snapshots ( like player_ratings_snapshots including all );
```

---

## Computed — rating engine output

*(Unchanged from Rev. 1 — this table's shape is dictated by our own formulas, not the StatsPlus source, so it isn't affected by the field-completeness pass.)*

```sql
create table player_computed (
  id                bigint generated always as identity primary key,
  refresh_run_id    bigint not null references refresh_runs(id),
  player_id         int not null references players(id),
  batting numeric, batting_p numeric, fielding numeric,
  pitching numeric, pitching_p numeric, qp int, qpp int,
  c_rating numeric, inf_rating numeric, of_rating numeric,
  overall numeric, potential numeric, prospect_potential numeric,
  ph text, role text, sp_rp text, tbl_pos text, platoon text,
  rank int, potential_rank int, prospect_rank int,
  org_rank int, org_ph_rank int, org_war_rank int,
  pos_rank int, pos_org_rank int, role_org_rank int,
  prospect_org_rank int, prospect_org_ph_rank int, draft_org_rank int,
  captured_at       timestamptz not null,
  unique (refresh_run_id, player_id)
);

create table team_computed (
  id                bigint generated always as identity primary key,
  refresh_run_id    bigint not null references refresh_runs(id),
  team_id           int not null references teams(id),
  team_ovr numeric, batting numeric, pitching numeric, fielding numeric,
  rank_rank numeric, team_rank int, w_rank numeric, power_rank numeric, power_ranking int,
  roster_rank int, batting_rank int, pitching_rank int, fielding_rank int,
  minor_league_rating numeric, minors_rank int,
  minor_league_batting_rating numeric, minor_league_pitching_rating numeric,
  batting_prospect_rank int, pitching_prospect_rank int,
  minor_league_readiness_rating numeric, tbl_readiness_rank int,
  draft_rating numeric, top_100_prospects_count int,
  captured_at       timestamptz not null,
  unique (refresh_run_id, team_id)
);

create table draft_computed (
  id                bigint generated always as identity primary key,
  refresh_run_id    bigint not null references refresh_runs(id),
  player_id         int not null references players(id),
  batting numeric, batting_p numeric, fielding numeric,
  pitching numeric, pitching_p numeric, qp int, qpp int,
  overall numeric, potential numeric, prospect_potential numeric,
  ph text, sp_rp text, rlb_pos text,
  draft_rank int,
  captured_at       timestamptz not null,
  unique (refresh_run_id, player_id)
);
```

---

## Future phase — game logs / box scores (placeholder, not built yet — unchanged from Rev. 1)

```sql
create table game_box_scores (
  id               bigint generated always as identity primary key,
  statsplus_game_id int not null unique,
  league_id        int,
  game_date        date,
  home_team_id     int references teams(id),
  away_team_id     int references teams(id),
  home_score int, away_score int,
  home_hits int, away_hits int,
  home_errors int, away_errors int,
  winning_pitcher_id int, losing_pitcher_id int, save_pitcher_id int,
  starter_home_id int, starter_away_id int,
  source_url       text,
  scraped_at       timestamptz
);

create table player_game_batting_lines (
  id               bigint generated always as identity primary key,
  game_box_score_id bigint references game_box_scores(id),
  player_id        int references players(id),
  ab int, r int, h int, rbi int, bb int, k int, lob int, hr int
);

create table player_game_pitching_lines ( id bigint generated always as identity primary key );  -- refine when built
```

---

## Not yet modeled — flagged, not forgotten

- **`/exports/`** — returns a date-keyed JSON object mapping each date to an ordered list of team IDs. Structure still not understood (possibly a power-ranking-order history StatsPlus maintains itself, or playoff seeding). Not shaped into the schema yet — needs decoding first, low priority since we're not sure it's even useful.

## Open items to resolve before implementing

1. **Supabase project "DSA"** — you're creating this now; need the project ref before any migration can run.
2. **Draft prospect ratings source** — still depends on formalizing the "Draft Avail" workflow (deferred phase).
