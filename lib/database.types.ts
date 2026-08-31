export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      contract_extension_snapshots: {
        Row: {
          allstar_bonus: number | null
          captured_at: string
          contract_league_id: number | null
          contract_team_id: number | null
          current_year: number | null
          cyyoung_bonus: number | null
          id: number
          is_major: boolean | null
          last_year_option_buyout: number | null
          last_year_player_option: boolean | null
          last_year_team_option: boolean | null
          last_year_vesting_option: boolean | null
          league_id: number | null
          minimum_ip: number | null
          minimum_ip_bonus: number | null
          minimum_pa: number | null
          minimum_pa_bonus: number | null
          mvp_bonus: number | null
          next_last_year_option_buyout: number | null
          next_last_year_player_option: boolean | null
          next_last_year_team_option: boolean | null
          next_last_year_vesting_option: boolean | null
          no_trade: boolean | null
          player_id: number
          refresh_run_id: number
          salary0: number | null
          salary1: number | null
          salary10: number | null
          salary11: number | null
          salary12: number | null
          salary13: number | null
          salary14: number | null
          salary2: number | null
          salary3: number | null
          salary4: number | null
          salary5: number | null
          salary6: number | null
          salary7: number | null
          salary8: number | null
          salary9: number | null
          season_year: number | null
          team_id: number | null
          years: number | null
        }
        Insert: {
          allstar_bonus?: number | null
          captured_at: string
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          id?: never
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id: number
          refresh_run_id: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          years?: number | null
        }
        Update: {
          allstar_bonus?: number | null
          captured_at?: string
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          id?: never
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id?: number
          refresh_run_id?: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          years?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_extension_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_extensions: {
        Row: {
          allstar_bonus: number | null
          contract_league_id: number | null
          contract_team_id: number | null
          current_year: number | null
          cyyoung_bonus: number | null
          is_major: boolean | null
          last_year_option_buyout: number | null
          last_year_player_option: boolean | null
          last_year_team_option: boolean | null
          last_year_vesting_option: boolean | null
          league_id: number | null
          minimum_ip: number | null
          minimum_ip_bonus: number | null
          minimum_pa: number | null
          minimum_pa_bonus: number | null
          mvp_bonus: number | null
          next_last_year_option_buyout: number | null
          next_last_year_player_option: boolean | null
          next_last_year_team_option: boolean | null
          next_last_year_vesting_option: boolean | null
          no_trade: boolean | null
          player_id: number
          salary0: number | null
          salary1: number | null
          salary10: number | null
          salary11: number | null
          salary12: number | null
          salary13: number | null
          salary14: number | null
          salary2: number | null
          salary3: number | null
          salary4: number | null
          salary5: number | null
          salary6: number | null
          salary7: number | null
          salary8: number | null
          salary9: number | null
          season_year: number | null
          team_id: number | null
          updated_at: string
          years: number | null
        }
        Insert: {
          allstar_bonus?: number | null
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          updated_at?: string
          years?: number | null
        }
        Update: {
          allstar_bonus?: number | null
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id?: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          updated_at?: string
          years?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_extensions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_snapshots: {
        Row: {
          allstar_bonus: number | null
          captured_at: string
          contract_league_id: number | null
          contract_team_id: number | null
          current_year: number | null
          cyyoung_bonus: number | null
          id: number
          is_major: boolean | null
          last_year_option_buyout: number | null
          last_year_player_option: boolean | null
          last_year_team_option: boolean | null
          last_year_vesting_option: boolean | null
          league_id: number | null
          minimum_ip: number | null
          minimum_ip_bonus: number | null
          minimum_pa: number | null
          minimum_pa_bonus: number | null
          mvp_bonus: number | null
          next_last_year_option_buyout: number | null
          next_last_year_player_option: boolean | null
          next_last_year_team_option: boolean | null
          next_last_year_vesting_option: boolean | null
          no_trade: boolean | null
          player_id: number
          refresh_run_id: number
          salary0: number | null
          salary1: number | null
          salary10: number | null
          salary11: number | null
          salary12: number | null
          salary13: number | null
          salary14: number | null
          salary2: number | null
          salary3: number | null
          salary4: number | null
          salary5: number | null
          salary6: number | null
          salary7: number | null
          salary8: number | null
          salary9: number | null
          season_year: number | null
          team_id: number | null
          years: number | null
        }
        Insert: {
          allstar_bonus?: number | null
          captured_at: string
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          id?: never
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id: number
          refresh_run_id: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          years?: number | null
        }
        Update: {
          allstar_bonus?: number | null
          captured_at?: string
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          id?: never
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id?: number
          refresh_run_id?: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          years?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          allstar_bonus: number | null
          contract_league_id: number | null
          contract_team_id: number | null
          current_year: number | null
          cyyoung_bonus: number | null
          is_major: boolean | null
          last_year_option_buyout: number | null
          last_year_player_option: boolean | null
          last_year_team_option: boolean | null
          last_year_vesting_option: boolean | null
          league_id: number | null
          minimum_ip: number | null
          minimum_ip_bonus: number | null
          minimum_pa: number | null
          minimum_pa_bonus: number | null
          mvp_bonus: number | null
          next_last_year_option_buyout: number | null
          next_last_year_player_option: boolean | null
          next_last_year_team_option: boolean | null
          next_last_year_vesting_option: boolean | null
          no_trade: boolean | null
          player_id: number
          salary0: number | null
          salary1: number | null
          salary10: number | null
          salary11: number | null
          salary12: number | null
          salary13: number | null
          salary14: number | null
          salary2: number | null
          salary3: number | null
          salary4: number | null
          salary5: number | null
          salary6: number | null
          salary7: number | null
          salary8: number | null
          salary9: number | null
          season_year: number | null
          team_id: number | null
          updated_at: string
          years: number | null
        }
        Insert: {
          allstar_bonus?: number | null
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          updated_at?: string
          years?: number | null
        }
        Update: {
          allstar_bonus?: number | null
          contract_league_id?: number | null
          contract_team_id?: number | null
          current_year?: number | null
          cyyoung_bonus?: number | null
          is_major?: boolean | null
          last_year_option_buyout?: number | null
          last_year_player_option?: boolean | null
          last_year_team_option?: boolean | null
          last_year_vesting_option?: boolean | null
          league_id?: number | null
          minimum_ip?: number | null
          minimum_ip_bonus?: number | null
          minimum_pa?: number | null
          minimum_pa_bonus?: number | null
          mvp_bonus?: number | null
          next_last_year_option_buyout?: number | null
          next_last_year_player_option?: boolean | null
          next_last_year_team_option?: boolean | null
          next_last_year_vesting_option?: boolean | null
          no_trade?: boolean | null
          player_id?: number
          salary0?: number | null
          salary1?: number | null
          salary10?: number | null
          salary11?: number | null
          salary12?: number | null
          salary13?: number | null
          salary14?: number | null
          salary2?: number | null
          salary3?: number | null
          salary4?: number | null
          salary5?: number | null
          salary6?: number | null
          salary7?: number | null
          salary8?: number | null
          salary9?: number | null
          season_year?: number | null
          team_id?: number | null
          updated_at?: string
          years?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_class_imports: {
        Row: {
          draft_year: number
          id: number
          imported_at: string
          notes: string | null
          row_count: number | null
          source_file: string | null
        }
        Insert: {
          draft_year: number
          id?: never
          imported_at?: string
          notes?: string | null
          row_count?: number | null
          source_file?: string | null
        }
        Update: {
          draft_year?: number
          id?: never
          imported_at?: string
          notes?: string | null
          row_count?: number | null
          source_file?: string | null
        }
        Relationships: []
      }
      draft_class_pool_members: {
        Row: {
          act: string | null
          draft_class_import_id: number
          id: number
          lev: string | null
          mld: number | null
          pct: string | null
          player_id: number
          pos: string | null
          sctacc: string | null
          sctcat: string | null
          type: string | null
        }
        Insert: {
          act?: string | null
          draft_class_import_id: number
          id?: never
          lev?: string | null
          mld?: number | null
          pct?: string | null
          player_id: number
          pos?: string | null
          sctacc?: string | null
          sctcat?: string | null
          type?: string | null
        }
        Update: {
          act?: string | null
          draft_class_import_id?: number
          id?: never
          lev?: string | null
          mld?: number | null
          pct?: string | null
          player_id?: number
          pos?: string | null
          sctacc?: string | null
          sctcat?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_class_pool_members_draft_class_import_id_fkey"
            columns: ["draft_class_import_id"]
            isOneToOne: false
            referencedRelation: "draft_class_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_class_pool_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_computed: {
        Row: {
          batting: number | null
          batting_p: number | null
          captured_at: string
          draft_rank: number | null
          fielding: number | null
          id: number
          overall: number | null
          ph: string | null
          pitching: number | null
          pitching_p: number | null
          player_id: number
          potential: number | null
          prospect_potential: number | null
          qp: number | null
          qpp: number | null
          refresh_run_id: number
          rlb_pos: string | null
          sp_rp: string | null
          weights_id: number | null
        }
        Insert: {
          batting?: number | null
          batting_p?: number | null
          captured_at: string
          draft_rank?: number | null
          fielding?: number | null
          id?: never
          overall?: number | null
          ph?: string | null
          pitching?: number | null
          pitching_p?: number | null
          player_id: number
          potential?: number | null
          prospect_potential?: number | null
          qp?: number | null
          qpp?: number | null
          refresh_run_id: number
          rlb_pos?: string | null
          sp_rp?: string | null
          weights_id?: number | null
        }
        Update: {
          batting?: number | null
          batting_p?: number | null
          captured_at?: string
          draft_rank?: number | null
          fielding?: number | null
          id?: never
          overall?: number | null
          ph?: string | null
          pitching?: number | null
          pitching_p?: number | null
          player_id?: number
          potential?: number | null
          prospect_potential?: number | null
          qp?: number | null
          qpp?: number | null
          refresh_run_id?: number
          rlb_pos?: string | null
          sp_rp?: string | null
          weights_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_computed_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_computed_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_computed_weights_id_fkey"
            columns: ["weights_id"]
            isOneToOne: false
            referencedRelation: "rating_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_picks: {
        Row: {
          age: number | null
          auto_pick: boolean | null
          college: boolean | null
          draft_year: number
          overall_pick: number | null
          pick_in_round: number | null
          picked_at: string | null
          player_id: number
          player_name: string | null
          position: string | null
          round: number | null
          supplemental: boolean | null
          team_id: number | null
          team_name: string | null
          updated_at: string
        }
        Insert: {
          age?: number | null
          auto_pick?: boolean | null
          college?: boolean | null
          draft_year: number
          overall_pick?: number | null
          pick_in_round?: number | null
          picked_at?: string | null
          player_id: number
          player_name?: string | null
          position?: string | null
          round?: number | null
          supplemental?: boolean | null
          team_id?: number | null
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          age?: number | null
          auto_pick?: boolean | null
          college?: boolean | null
          draft_year?: number
          overall_pick?: number | null
          pick_in_round?: number | null
          picked_at?: string | null
          player_id?: number
          player_name?: string | null
          position?: string | null
          round?: number | null
          supplemental?: boolean | null
          team_id?: number | null
          team_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_prospect_ratings_snapshots: {
        Row: {
          acc: string | null
          armslot: string | null
          babip: number | null
          babip_l: number | null
          babip_r: number | null
          bunthit: number | null
          captured_at: string
          carm: number | null
          cblk: number | null
          cfrm: number | null
          chg: number | null
          circhg: number | null
          cntct: number | null
          cntct_l: number | null
          cntct_r: number | null
          crv: number | null
          ctrl: number | null
          ctrl_l: number | null
          ctrl_r: number | null
          cutt: number | null
          eye: number | null
          eye_l: number | null
          eye_r: number | null
          fbtype: string | null
          frk: number | null
          fst: number | null
          gap: number | null
          gap_l: number | null
          gap_r: number | null
          gb: number | null
          gbtype: string | null
          greed: string | null
          hold: number | null
          hra: number | null
          hra_l: number | null
          hra_r: number | null
          id: number
          ifa: number | null
          ife: number | null
          ifr: number | null
          int_: string | null
          knbl: number | null
          kncrv: number | null
          ks: number | null
          ks_l: number | null
          ks_r: number | null
          lead: string | null
          league: number | null
          lg_lvl: number | null
          loy: string | null
          mov: number | null
          mov_l: number | null
          mov_r: number | null
          ofa: number | null
          ofe: number | null
          ofr: number | null
          org: number | null
          ovr: number | null
          pbabip: number | null
          pbabip_l: number | null
          pbabip_r: number | null
          player_id: number
          pos: string | null
          pos_1b: number | null
          pos_2b: number | null
          pos_3b: number | null
          pos_c: number | null
          pos_cf: number | null
          pos_lf: number | null
          pos_p: number | null
          pos_rf: number | null
          pos_ss: number | null
          pot: number | null
          pot_1b: number | null
          pot_2b: number | null
          pot_3b: number | null
          pot_babip: number | null
          pot_c: number | null
          pot_cf: number | null
          pot_chg: number | null
          pot_circhg: number | null
          pot_cntct: number | null
          pot_crv: number | null
          pot_ctrl: number | null
          pot_cutt: number | null
          pot_eye: number | null
          pot_frk: number | null
          pot_fst: number | null
          pot_gap: number | null
          pot_hra: number | null
          pot_knbl: number | null
          pot_kncrv: number | null
          pot_ks: number | null
          pot_lf: number | null
          pot_mov: number | null
          pot_p: number | null
          pot_pbabip: number | null
          pot_pow: number | null
          pot_rf: number | null
          pot_scr: number | null
          pot_sld: number | null
          pot_snk: number | null
          pot_splt: number | null
          pot_ss: number | null
          pot_stf: number | null
          pot_vel: string | null
          pow: number | null
          pow_l: number | null
          pow_r: number | null
          prone: string | null
          refresh_run_id: number
          run: number | null
          sacbunt: number | null
          scr: number | null
          sld: number | null
          snk: number | null
          speed: number | null
          splt: number | null
          steal: number | null
          stf: number | null
          stf_l: number | null
          stf_r: number | null
          stlrt: number | null
          stm: number | null
          tdp: number | null
          team: number | null
          vel: string | null
          wrkethic: string | null
        }
        Insert: {
          acc?: string | null
          armslot?: string | null
          babip?: number | null
          babip_l?: number | null
          babip_r?: number | null
          bunthit?: number | null
          captured_at: string
          carm?: number | null
          cblk?: number | null
          cfrm?: number | null
          chg?: number | null
          circhg?: number | null
          cntct?: number | null
          cntct_l?: number | null
          cntct_r?: number | null
          crv?: number | null
          ctrl?: number | null
          ctrl_l?: number | null
          ctrl_r?: number | null
          cutt?: number | null
          eye?: number | null
          eye_l?: number | null
          eye_r?: number | null
          fbtype?: string | null
          frk?: number | null
          fst?: number | null
          gap?: number | null
          gap_l?: number | null
          gap_r?: number | null
          gb?: number | null
          gbtype?: string | null
          greed?: string | null
          hold?: number | null
          hra?: number | null
          hra_l?: number | null
          hra_r?: number | null
          id?: never
          ifa?: number | null
          ife?: number | null
          ifr?: number | null
          int_?: string | null
          knbl?: number | null
          kncrv?: number | null
          ks?: number | null
          ks_l?: number | null
          ks_r?: number | null
          lead?: string | null
          league?: number | null
          lg_lvl?: number | null
          loy?: string | null
          mov?: number | null
          mov_l?: number | null
          mov_r?: number | null
          ofa?: number | null
          ofe?: number | null
          ofr?: number | null
          org?: number | null
          ovr?: number | null
          pbabip?: number | null
          pbabip_l?: number | null
          pbabip_r?: number | null
          player_id: number
          pos?: string | null
          pos_1b?: number | null
          pos_2b?: number | null
          pos_3b?: number | null
          pos_c?: number | null
          pos_cf?: number | null
          pos_lf?: number | null
          pos_p?: number | null
          pos_rf?: number | null
          pos_ss?: number | null
          pot?: number | null
          pot_1b?: number | null
          pot_2b?: number | null
          pot_3b?: number | null
          pot_babip?: number | null
          pot_c?: number | null
          pot_cf?: number | null
          pot_chg?: number | null
          pot_circhg?: number | null
          pot_cntct?: number | null
          pot_crv?: number | null
          pot_ctrl?: number | null
          pot_cutt?: number | null
          pot_eye?: number | null
          pot_frk?: number | null
          pot_fst?: number | null
          pot_gap?: number | null
          pot_hra?: number | null
          pot_knbl?: number | null
          pot_kncrv?: number | null
          pot_ks?: number | null
          pot_lf?: number | null
          pot_mov?: number | null
          pot_p?: number | null
          pot_pbabip?: number | null
          pot_pow?: number | null
          pot_rf?: number | null
          pot_scr?: number | null
          pot_sld?: number | null
          pot_snk?: number | null
          pot_splt?: number | null
          pot_ss?: number | null
          pot_stf?: number | null
          pot_vel?: string | null
          pow?: number | null
          pow_l?: number | null
          pow_r?: number | null
          prone?: string | null
          refresh_run_id: number
          run?: number | null
          sacbunt?: number | null
          scr?: number | null
          sld?: number | null
          snk?: number | null
          speed?: number | null
          splt?: number | null
          steal?: number | null
          stf?: number | null
          stf_l?: number | null
          stf_r?: number | null
          stlrt?: number | null
          stm?: number | null
          tdp?: number | null
          team?: number | null
          vel?: string | null
          wrkethic?: string | null
        }
        Update: {
          acc?: string | null
          armslot?: string | null
          babip?: number | null
          babip_l?: number | null
          babip_r?: number | null
          bunthit?: number | null
          captured_at?: string
          carm?: number | null
          cblk?: number | null
          cfrm?: number | null
          chg?: number | null
          circhg?: number | null
          cntct?: number | null
          cntct_l?: number | null
          cntct_r?: number | null
          crv?: number | null
          ctrl?: number | null
          ctrl_l?: number | null
          ctrl_r?: number | null
          cutt?: number | null
          eye?: number | null
          eye_l?: number | null
          eye_r?: number | null
          fbtype?: string | null
          frk?: number | null
          fst?: number | null
          gap?: number | null
          gap_l?: number | null
          gap_r?: number | null
          gb?: number | null
          gbtype?: string | null
          greed?: string | null
          hold?: number | null
          hra?: number | null
          hra_l?: number | null
          hra_r?: number | null
          id?: never
          ifa?: number | null
          ife?: number | null
          ifr?: number | null
          int_?: string | null
          knbl?: number | null
          kncrv?: number | null
          ks?: number | null
          ks_l?: number | null
          ks_r?: number | null
          lead?: string | null
          league?: number | null
          lg_lvl?: number | null
          loy?: string | null
          mov?: number | null
          mov_l?: number | null
          mov_r?: number | null
          ofa?: number | null
          ofe?: number | null
          ofr?: number | null
          org?: number | null
          ovr?: number | null
          pbabip?: number | null
          pbabip_l?: number | null
          pbabip_r?: number | null
          player_id?: number
          pos?: string | null
          pos_1b?: number | null
          pos_2b?: number | null
          pos_3b?: number | null
          pos_c?: number | null
          pos_cf?: number | null
          pos_lf?: number | null
          pos_p?: number | null
          pos_rf?: number | null
          pos_ss?: number | null
          pot?: number | null
          pot_1b?: number | null
          pot_2b?: number | null
          pot_3b?: number | null
          pot_babip?: number | null
          pot_c?: number | null
          pot_cf?: number | null
          pot_chg?: number | null
          pot_circhg?: number | null
          pot_cntct?: number | null
          pot_crv?: number | null
          pot_ctrl?: number | null
          pot_cutt?: number | null
          pot_eye?: number | null
          pot_frk?: number | null
          pot_fst?: number | null
          pot_gap?: number | null
          pot_hra?: number | null
          pot_knbl?: number | null
          pot_kncrv?: number | null
          pot_ks?: number | null
          pot_lf?: number | null
          pot_mov?: number | null
          pot_p?: number | null
          pot_pbabip?: number | null
          pot_pow?: number | null
          pot_rf?: number | null
          pot_scr?: number | null
          pot_sld?: number | null
          pot_snk?: number | null
          pot_splt?: number | null
          pot_ss?: number | null
          pot_stf?: number | null
          pot_vel?: string | null
          pow?: number | null
          pow_l?: number | null
          pow_r?: number | null
          prone?: string | null
          refresh_run_id?: number
          run?: number | null
          sacbunt?: number | null
          scr?: number | null
          sld?: number | null
          snk?: number | null
          speed?: number | null
          splt?: number | null
          steal?: number | null
          stf?: number | null
          stf_l?: number | null
          stf_r?: number | null
          stlrt?: number | null
          stm?: number | null
          tdp?: number | null
          team?: number | null
          vel?: string | null
          wrkethic?: string | null
        }
        Relationships: []
      }
      game_box_scores: {
        Row: {
          away_errors: number | null
          away_hits: number | null
          away_score: number | null
          away_team_id: number | null
          game_date: string | null
          home_errors: number | null
          home_hits: number | null
          home_score: number | null
          home_team_id: number | null
          id: number
          league_id: number | null
          losing_pitcher_id: number | null
          save_pitcher_id: number | null
          scraped_at: string | null
          source_url: string | null
          starter_away_id: number | null
          starter_home_id: number | null
          statsplus_game_id: number
          winning_pitcher_id: number | null
        }
        Insert: {
          away_errors?: number | null
          away_hits?: number | null
          away_score?: number | null
          away_team_id?: number | null
          game_date?: string | null
          home_errors?: number | null
          home_hits?: number | null
          home_score?: number | null
          home_team_id?: number | null
          id?: never
          league_id?: number | null
          losing_pitcher_id?: number | null
          save_pitcher_id?: number | null
          scraped_at?: string | null
          source_url?: string | null
          starter_away_id?: number | null
          starter_home_id?: number | null
          statsplus_game_id: number
          winning_pitcher_id?: number | null
        }
        Update: {
          away_errors?: number | null
          away_hits?: number | null
          away_score?: number | null
          away_team_id?: number | null
          game_date?: string | null
          home_errors?: number | null
          home_hits?: number | null
          home_score?: number | null
          home_team_id?: number | null
          id?: never
          league_id?: number | null
          losing_pitcher_id?: number | null
          save_pitcher_id?: number | null
          scraped_at?: string | null
          source_url?: string | null
          starter_away_id?: number | null
          starter_home_id?: number | null
          statsplus_game_id?: number
          winning_pitcher_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "game_box_scores_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_box_scores_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      game_results: {
        Row: {
          attendance: number | null
          away_errors: number | null
          away_hits: number | null
          away_runs: number | null
          away_team_id: number | null
          cup: boolean | null
          doubleheader_game: number | null
          game_date: string | null
          game_time: string | null
          game_type: number | null
          home_errors: number | null
          home_hits: number | null
          home_runs: number | null
          home_team_id: number | null
          innings: number | null
          league_id: number | null
          losing_pitcher_id: number | null
          played: boolean | null
          refresh_run_id: number | null
          save_pitcher_id: number | null
          starter_away_id: number | null
          starter_home_id: number | null
          statsplus_game_id: number
          updated_at: string
          winning_pitcher_id: number | null
        }
        Insert: {
          attendance?: number | null
          away_errors?: number | null
          away_hits?: number | null
          away_runs?: number | null
          away_team_id?: number | null
          cup?: boolean | null
          doubleheader_game?: number | null
          game_date?: string | null
          game_time?: string | null
          game_type?: number | null
          home_errors?: number | null
          home_hits?: number | null
          home_runs?: number | null
          home_team_id?: number | null
          innings?: number | null
          league_id?: number | null
          losing_pitcher_id?: number | null
          played?: boolean | null
          refresh_run_id?: number | null
          save_pitcher_id?: number | null
          starter_away_id?: number | null
          starter_home_id?: number | null
          statsplus_game_id: number
          updated_at?: string
          winning_pitcher_id?: number | null
        }
        Update: {
          attendance?: number | null
          away_errors?: number | null
          away_hits?: number | null
          away_runs?: number | null
          away_team_id?: number | null
          cup?: boolean | null
          doubleheader_game?: number | null
          game_date?: string | null
          game_time?: string | null
          game_type?: number | null
          home_errors?: number | null
          home_hits?: number | null
          home_runs?: number | null
          home_team_id?: number | null
          innings?: number | null
          league_id?: number | null
          losing_pitcher_id?: number | null
          played?: boolean | null
          refresh_run_id?: number | null
          save_pitcher_id?: number | null
          starter_away_id?: number | null
          starter_home_id?: number | null
          statsplus_game_id?: number
          updated_at?: string
          winning_pitcher_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "game_results_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_results_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_results_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_rate_curves: {
        Row: {
          computed_at: string
          id: number
          intercept: number
          league_minimum_salary: number
          max_overall_in_sample: number | null
          min_overall_in_sample: number | null
          player_type: string
          r_squared: number
          refresh_run_id: number
          residual_std_dev: number
          sample_size: number
          slope: number
        }
        Insert: {
          computed_at?: string
          id?: never
          intercept: number
          league_minimum_salary: number
          max_overall_in_sample?: number | null
          min_overall_in_sample?: number | null
          player_type: string
          r_squared: number
          refresh_run_id: number
          residual_std_dev: number
          sample_size: number
          slope: number
        }
        Update: {
          computed_at?: string
          id?: never
          intercept?: number
          league_minimum_salary?: number
          max_overall_in_sample?: number | null
          min_overall_in_sample?: number | null
          player_type?: string
          r_squared?: number
          refresh_run_id?: number
          residual_std_dev?: number
          sample_size?: number
          slope?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_rate_curves_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_rate_role_multipliers: {
        Row: {
          avg_actual_aav: number | null
          avg_curve_predicted_aav: number | null
          avg_overall_in_sample: number | null
          dh_capped: boolean
          final_multiplier: number
          id: number
          raw_multiplier: number
          refresh_run_id: number
          role: string
          sample_size: number
          shrunk_multiplier: number
        }
        Insert: {
          avg_actual_aav?: number | null
          avg_curve_predicted_aav?: number | null
          avg_overall_in_sample?: number | null
          dh_capped?: boolean
          final_multiplier: number
          id?: never
          raw_multiplier: number
          refresh_run_id: number
          role: string
          sample_size: number
          shrunk_multiplier: number
        }
        Update: {
          avg_actual_aav?: number | null
          avg_curve_predicted_aav?: number | null
          avg_overall_in_sample?: number | null
          dh_capped?: boolean
          final_multiplier?: number
          id?: never
          raw_multiplier?: number
          refresh_run_id?: number
          role?: string
          sample_size?: number
          shrunk_multiplier?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_rate_role_multipliers_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      market_rate_training_contracts: {
        Row: {
          aav: number
          first_observed_at: string
          first_observed_refresh_run_id: number
          id: number
          overall: number
          player_id: number
          player_type: string
          role: string
          salary0: number
          season_year: number
          years: number
        }
        Insert: {
          aav: number
          first_observed_at?: string
          first_observed_refresh_run_id: number
          id?: never
          overall: number
          player_id: number
          player_type: string
          role: string
          salary0: number
          season_year: number
          years: number
        }
        Update: {
          aav?: number
          first_observed_at?: string
          first_observed_refresh_run_id?: number
          id?: never
          overall?: number
          player_id?: number
          player_type?: string
          role?: string
          salary0?: number
          season_year?: number
          years?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_rate_training_contract_first_observed_refresh_run_i_fkey"
            columns: ["first_observed_refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_system_bios: {
        Row: {
          bio_text: string
          generated_at: string
          organization_id: number
          refresh_run_id: number
        }
        Insert: {
          bio_text: string
          generated_at?: string
          organization_id: number
          refresh_run_id: number
        }
        Update: {
          bio_text?: string
          generated_at?: string
          organization_id?: number
          refresh_run_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_system_bios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_events: {
        Row: {
          created_at: string
          details: Json | null
          id: number
          message: string
          refresh_run_id: number | null
          severity: string
          source: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: never
          message: string
          refresh_run_id?: number | null
          severity: string
          source: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: never
          message?: string
          refresh_run_id?: number | null
          severity?: string
          source?: string
        }
        Relationships: []
      }
      player_batting_stats_snapshots: {
        Row: {
          ab: number | null
          bb: number | null
          captured_at: string
          ci: number | null
          cs: number | null
          d: number | null
          g: number | null
          game_id: number | null
          gdp: number | null
          gs: number | null
          h: number | null
          hp: number | null
          hr: number | null
          ibb: number | null
          id: number
          k: number | null
          league_id: number | null
          level_id: number | null
          pa: number | null
          pitches_seen: number | null
          player_id: number
          position: number | null
          r: number | null
          rbi: number | null
          refresh_run_id: number
          sb: number | null
          sf: number | null
          sh: number | null
          source_id: number | null
          split_id: number | null
          stint: number | null
          t: number | null
          team_id: number | null
          ubr: number | null
          war: number | null
          wpa: number | null
          year: number
        }
        Insert: {
          ab?: number | null
          bb?: number | null
          captured_at: string
          ci?: number | null
          cs?: number | null
          d?: number | null
          g?: number | null
          game_id?: number | null
          gdp?: number | null
          gs?: number | null
          h?: number | null
          hp?: number | null
          hr?: number | null
          ibb?: number | null
          id?: never
          k?: number | null
          league_id?: number | null
          level_id?: number | null
          pa?: number | null
          pitches_seen?: number | null
          player_id: number
          position?: number | null
          r?: number | null
          rbi?: number | null
          refresh_run_id: number
          sb?: number | null
          sf?: number | null
          sh?: number | null
          source_id?: number | null
          split_id?: number | null
          stint?: number | null
          t?: number | null
          team_id?: number | null
          ubr?: number | null
          war?: number | null
          wpa?: number | null
          year: number
        }
        Update: {
          ab?: number | null
          bb?: number | null
          captured_at?: string
          ci?: number | null
          cs?: number | null
          d?: number | null
          g?: number | null
          game_id?: number | null
          gdp?: number | null
          gs?: number | null
          h?: number | null
          hp?: number | null
          hr?: number | null
          ibb?: number | null
          id?: never
          k?: number | null
          league_id?: number | null
          level_id?: number | null
          pa?: number | null
          pitches_seen?: number | null
          player_id?: number
          position?: number | null
          r?: number | null
          rbi?: number | null
          refresh_run_id?: number
          sb?: number | null
          sf?: number | null
          sh?: number | null
          source_id?: number | null
          split_id?: number | null
          stint?: number | null
          t?: number | null
          team_id?: number | null
          ubr?: number | null
          war?: number | null
          wpa?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_batting_stats_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_batting_stats_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      player_computed: {
        Row: {
          batting: number | null
          batting_p: number | null
          c_rating: number | null
          captured_at: string
          comp_player_id: number | null
          comp_similarity: number | null
          draft_org_rank: number | null
          eta: number | null
          fielding: number | null
          id: number
          inf_rating: number | null
          of_rating: number | null
          org_ph_rank: number | null
          org_rank: number | null
          org_war_rank: number | null
          overall: number | null
          ph: string | null
          pitching: number | null
          pitching_p: number | null
          platoon: string | null
          player_id: number
          pos_org_rank: number | null
          pos_rank: number | null
          potential: number | null
          potential_rank: number | null
          prospect_org_ph_rank: number | null
          prospect_org_rank: number | null
          prospect_potential: number | null
          prospect_rank: number | null
          prospect_role_rank: number | null
          qp: number | null
          qpp: number | null
          rank: number | null
          refresh_run_id: number
          role: string | null
          role_org_rank: number | null
          sp_rp: string | null
          tbl_pos: string | null
          weights_id: number | null
        }
        Insert: {
          batting?: number | null
          batting_p?: number | null
          c_rating?: number | null
          captured_at: string
          comp_player_id?: number | null
          comp_similarity?: number | null
          draft_org_rank?: number | null
          eta?: number | null
          fielding?: number | null
          id?: never
          inf_rating?: number | null
          of_rating?: number | null
          org_ph_rank?: number | null
          org_rank?: number | null
          org_war_rank?: number | null
          overall?: number | null
          ph?: string | null
          pitching?: number | null
          pitching_p?: number | null
          platoon?: string | null
          player_id: number
          pos_org_rank?: number | null
          pos_rank?: number | null
          potential?: number | null
          potential_rank?: number | null
          prospect_org_ph_rank?: number | null
          prospect_org_rank?: number | null
          prospect_potential?: number | null
          prospect_rank?: number | null
          prospect_role_rank?: number | null
          qp?: number | null
          qpp?: number | null
          rank?: number | null
          refresh_run_id: number
          role?: string | null
          role_org_rank?: number | null
          sp_rp?: string | null
          tbl_pos?: string | null
          weights_id?: number | null
        }
        Update: {
          batting?: number | null
          batting_p?: number | null
          c_rating?: number | null
          captured_at?: string
          comp_player_id?: number | null
          comp_similarity?: number | null
          draft_org_rank?: number | null
          eta?: number | null
          fielding?: number | null
          id?: never
          inf_rating?: number | null
          of_rating?: number | null
          org_ph_rank?: number | null
          org_rank?: number | null
          org_war_rank?: number | null
          overall?: number | null
          ph?: string | null
          pitching?: number | null
          pitching_p?: number | null
          platoon?: string | null
          player_id?: number
          pos_org_rank?: number | null
          pos_rank?: number | null
          potential?: number | null
          potential_rank?: number | null
          prospect_org_ph_rank?: number | null
          prospect_org_rank?: number | null
          prospect_potential?: number | null
          prospect_rank?: number | null
          prospect_role_rank?: number | null
          qp?: number | null
          qpp?: number | null
          rank?: number | null
          refresh_run_id?: number
          role?: string | null
          role_org_rank?: number | null
          sp_rp?: string | null
          tbl_pos?: string | null
          weights_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_computed_comp_player_id_fkey"
            columns: ["comp_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_computed_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_computed_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_computed_weights_id_fkey"
            columns: ["weights_id"]
            isOneToOne: false
            referencedRelation: "rating_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      player_fielding_stats_snapshots: {
        Row: {
          a: number | null
          arm: number | null
          captured_at: string
          dp: number | null
          e: number | null
          er: number | null
          framing: number | null
          g: number | null
          gs: number | null
          id: number
          ip: number | null
          ipf: number | null
          league_id: number | null
          level_id: number | null
          opps_0: number | null
          opps_1: number | null
          opps_2: number | null
          opps_3: number | null
          opps_4: number | null
          opps_5: number | null
          opps_made_0: number | null
          opps_made_1: number | null
          opps_made_2: number | null
          opps_made_3: number | null
          opps_made_4: number | null
          opps_made_5: number | null
          pb: number | null
          player_id: number
          plays: number | null
          plays_base: number | null
          po: number | null
          position: number | null
          refresh_run_id: number
          roe: number | null
          rto: number | null
          sba: number | null
          source_id: number | null
          split_id: number | null
          tc: number | null
          team_id: number | null
          tp: number | null
          year: number
          zr: number | null
        }
        Insert: {
          a?: number | null
          arm?: number | null
          captured_at: string
          dp?: number | null
          e?: number | null
          er?: number | null
          framing?: number | null
          g?: number | null
          gs?: number | null
          id?: never
          ip?: number | null
          ipf?: number | null
          league_id?: number | null
          level_id?: number | null
          opps_0?: number | null
          opps_1?: number | null
          opps_2?: number | null
          opps_3?: number | null
          opps_4?: number | null
          opps_5?: number | null
          opps_made_0?: number | null
          opps_made_1?: number | null
          opps_made_2?: number | null
          opps_made_3?: number | null
          opps_made_4?: number | null
          opps_made_5?: number | null
          pb?: number | null
          player_id: number
          plays?: number | null
          plays_base?: number | null
          po?: number | null
          position?: number | null
          refresh_run_id: number
          roe?: number | null
          rto?: number | null
          sba?: number | null
          source_id?: number | null
          split_id?: number | null
          tc?: number | null
          team_id?: number | null
          tp?: number | null
          year: number
          zr?: number | null
        }
        Update: {
          a?: number | null
          arm?: number | null
          captured_at?: string
          dp?: number | null
          e?: number | null
          er?: number | null
          framing?: number | null
          g?: number | null
          gs?: number | null
          id?: never
          ip?: number | null
          ipf?: number | null
          league_id?: number | null
          level_id?: number | null
          opps_0?: number | null
          opps_1?: number | null
          opps_2?: number | null
          opps_3?: number | null
          opps_4?: number | null
          opps_5?: number | null
          opps_made_0?: number | null
          opps_made_1?: number | null
          opps_made_2?: number | null
          opps_made_3?: number | null
          opps_made_4?: number | null
          opps_made_5?: number | null
          pb?: number | null
          player_id?: number
          plays?: number | null
          plays_base?: number | null
          po?: number | null
          position?: number | null
          refresh_run_id?: number
          roe?: number | null
          rto?: number | null
          sba?: number | null
          source_id?: number | null
          split_id?: number | null
          tc?: number | null
          team_id?: number | null
          tp?: number | null
          year?: number
          zr?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_fielding_stats_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_fielding_stats_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      player_game_batting_lines: {
        Row: {
          ab: number | null
          bb: number | null
          game_box_score_id: number | null
          h: number | null
          hr: number | null
          id: number
          k: number | null
          lob: number | null
          player_id: number | null
          r: number | null
          rbi: number | null
        }
        Insert: {
          ab?: number | null
          bb?: number | null
          game_box_score_id?: number | null
          h?: number | null
          hr?: number | null
          id?: never
          k?: number | null
          lob?: number | null
          player_id?: number | null
          r?: number | null
          rbi?: number | null
        }
        Update: {
          ab?: number | null
          bb?: number | null
          game_box_score_id?: number | null
          h?: number | null
          hr?: number | null
          id?: never
          k?: number | null
          lob?: number | null
          player_id?: number | null
          r?: number | null
          rbi?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_game_batting_lines_game_box_score_id_fkey"
            columns: ["game_box_score_id"]
            isOneToOne: false
            referencedRelation: "game_box_scores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_batting_lines_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_game_pitching_lines: {
        Row: {
          game_box_score_id: number | null
          id: number
          player_id: number | null
        }
        Insert: {
          game_box_score_id?: number | null
          id?: never
          player_id?: number | null
        }
        Update: {
          game_box_score_id?: number | null
          id?: never
          player_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_game_pitching_lines_game_box_score_id_fkey"
            columns: ["game_box_score_id"]
            isOneToOne: false
            referencedRelation: "game_box_scores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_pitching_lines_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_pitching_stats_snapshots: {
        Row: {
          ab: number | null
          bb: number | null
          bf: number | null
          bk: number | null
          bs: number | null
          captured_at: string
          cg: number | null
          ci: number | null
          cs: number | null
          da: number | null
          dp: number | null
          er: number | null
          fb: number | null
          g: number | null
          game_id: number | null
          gb: number | null
          gf: number | null
          gs: number | null
          ha: number | null
          hld: number | null
          hp: number | null
          hra: number | null
          id: number
          ip: number | null
          ipf: number | null
          ir: number | null
          irs: number | null
          iw: number | null
          k: number | null
          l: number | null
          league_id: number | null
          level_id: number | null
          li: number | null
          md: number | null
          outs: number | null
          pi: number | null
          player_id: number
          qs: number | null
          r: number | null
          ra: number | null
          ra9war: number | null
          refresh_run_id: number
          rs: number | null
          s: number | null
          sa: number | null
          sb: number | null
          sd: number | null
          sf: number | null
          sh: number | null
          sho: number | null
          source_id: number | null
          split_id: number | null
          stint: number | null
          svo: number | null
          ta: number | null
          tb: number | null
          team_id: number | null
          w: number | null
          war: number | null
          wp: number | null
          wpa: number | null
          year: number
        }
        Insert: {
          ab?: number | null
          bb?: number | null
          bf?: number | null
          bk?: number | null
          bs?: number | null
          captured_at: string
          cg?: number | null
          ci?: number | null
          cs?: number | null
          da?: number | null
          dp?: number | null
          er?: number | null
          fb?: number | null
          g?: number | null
          game_id?: number | null
          gb?: number | null
          gf?: number | null
          gs?: number | null
          ha?: number | null
          hld?: number | null
          hp?: number | null
          hra?: number | null
          id?: never
          ip?: number | null
          ipf?: number | null
          ir?: number | null
          irs?: number | null
          iw?: number | null
          k?: number | null
          l?: number | null
          league_id?: number | null
          level_id?: number | null
          li?: number | null
          md?: number | null
          outs?: number | null
          pi?: number | null
          player_id: number
          qs?: number | null
          r?: number | null
          ra?: number | null
          ra9war?: number | null
          refresh_run_id: number
          rs?: number | null
          s?: number | null
          sa?: number | null
          sb?: number | null
          sd?: number | null
          sf?: number | null
          sh?: number | null
          sho?: number | null
          source_id?: number | null
          split_id?: number | null
          stint?: number | null
          svo?: number | null
          ta?: number | null
          tb?: number | null
          team_id?: number | null
          w?: number | null
          war?: number | null
          wp?: number | null
          wpa?: number | null
          year: number
        }
        Update: {
          ab?: number | null
          bb?: number | null
          bf?: number | null
          bk?: number | null
          bs?: number | null
          captured_at?: string
          cg?: number | null
          ci?: number | null
          cs?: number | null
          da?: number | null
          dp?: number | null
          er?: number | null
          fb?: number | null
          g?: number | null
          game_id?: number | null
          gb?: number | null
          gf?: number | null
          gs?: number | null
          ha?: number | null
          hld?: number | null
          hp?: number | null
          hra?: number | null
          id?: never
          ip?: number | null
          ipf?: number | null
          ir?: number | null
          irs?: number | null
          iw?: number | null
          k?: number | null
          l?: number | null
          league_id?: number | null
          level_id?: number | null
          li?: number | null
          md?: number | null
          outs?: number | null
          pi?: number | null
          player_id?: number
          qs?: number | null
          r?: number | null
          ra?: number | null
          ra9war?: number | null
          refresh_run_id?: number
          rs?: number | null
          s?: number | null
          sa?: number | null
          sb?: number | null
          sd?: number | null
          sf?: number | null
          sh?: number | null
          sho?: number | null
          source_id?: number | null
          split_id?: number | null
          stint?: number | null
          svo?: number | null
          ta?: number | null
          tb?: number | null
          team_id?: number | null
          w?: number | null
          war?: number | null
          wp?: number | null
          wpa?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_pitching_stats_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_pitching_stats_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      player_projected_splits: {
        Row: {
          computed_at: string
          id: number
          player_id: number
          pot_cntct_l: number | null
          pot_cntct_r: number | null
          pot_ctrl_l: number | null
          pot_ctrl_r: number | null
          pot_eye_l: number | null
          pot_eye_r: number | null
          pot_gap_l: number | null
          pot_gap_r: number | null
          pot_hra_l: number | null
          pot_hra_r: number | null
          pot_ks_l: number | null
          pot_ks_r: number | null
          pot_mov_l: number | null
          pot_mov_r: number | null
          pot_pbabip_l: number | null
          pot_pbabip_r: number | null
          pot_pow_l: number | null
          pot_pow_r: number | null
          pot_stf_l: number | null
          pot_stf_r: number | null
          refresh_run_id: number
        }
        Insert: {
          computed_at?: string
          id?: never
          player_id: number
          pot_cntct_l?: number | null
          pot_cntct_r?: number | null
          pot_ctrl_l?: number | null
          pot_ctrl_r?: number | null
          pot_eye_l?: number | null
          pot_eye_r?: number | null
          pot_gap_l?: number | null
          pot_gap_r?: number | null
          pot_hra_l?: number | null
          pot_hra_r?: number | null
          pot_ks_l?: number | null
          pot_ks_r?: number | null
          pot_mov_l?: number | null
          pot_mov_r?: number | null
          pot_pbabip_l?: number | null
          pot_pbabip_r?: number | null
          pot_pow_l?: number | null
          pot_pow_r?: number | null
          pot_stf_l?: number | null
          pot_stf_r?: number | null
          refresh_run_id: number
        }
        Update: {
          computed_at?: string
          id?: never
          player_id?: number
          pot_cntct_l?: number | null
          pot_cntct_r?: number | null
          pot_ctrl_l?: number | null
          pot_ctrl_r?: number | null
          pot_eye_l?: number | null
          pot_eye_r?: number | null
          pot_gap_l?: number | null
          pot_gap_r?: number | null
          pot_hra_l?: number | null
          pot_hra_r?: number | null
          pot_ks_l?: number | null
          pot_ks_r?: number | null
          pot_mov_l?: number | null
          pot_mov_r?: number | null
          pot_pbabip_l?: number | null
          pot_pbabip_r?: number | null
          pot_pow_l?: number | null
          pot_pow_r?: number | null
          pot_stf_l?: number | null
          pot_stf_r?: number | null
          refresh_run_id?: number
        }
        Relationships: []
      }
      player_ratings_snapshots: {
        Row: {
          acc: string | null
          armslot: string | null
          babip: number | null
          babip_l: number | null
          babip_r: number | null
          bunthit: number | null
          captured_at: string
          carm: number | null
          cblk: number | null
          cfrm: number | null
          chg: number | null
          circhg: number | null
          cntct: number | null
          cntct_l: number | null
          cntct_r: number | null
          crv: number | null
          ctrl: number | null
          ctrl_l: number | null
          ctrl_r: number | null
          cutt: number | null
          eye: number | null
          eye_l: number | null
          eye_r: number | null
          fbtype: string | null
          frk: number | null
          fst: number | null
          gap: number | null
          gap_l: number | null
          gap_r: number | null
          gb: number | null
          gbtype: string | null
          greed: string | null
          hold: number | null
          hra: number | null
          hra_l: number | null
          hra_r: number | null
          id: number
          ifa: number | null
          ife: number | null
          ifr: number | null
          int_: string | null
          knbl: number | null
          kncrv: number | null
          ks: number | null
          ks_l: number | null
          ks_r: number | null
          lead: string | null
          league: number | null
          lg_lvl: number | null
          loy: string | null
          mov: number | null
          mov_l: number | null
          mov_r: number | null
          ofa: number | null
          ofe: number | null
          ofr: number | null
          org: number | null
          ovr: number | null
          pbabip: number | null
          pbabip_l: number | null
          pbabip_r: number | null
          player_id: number
          pos: string | null
          pos_1b: number | null
          pos_2b: number | null
          pos_3b: number | null
          pos_c: number | null
          pos_cf: number | null
          pos_lf: number | null
          pos_p: number | null
          pos_rf: number | null
          pos_ss: number | null
          pot: number | null
          pot_1b: number | null
          pot_2b: number | null
          pot_3b: number | null
          pot_babip: number | null
          pot_c: number | null
          pot_cf: number | null
          pot_chg: number | null
          pot_circhg: number | null
          pot_cntct: number | null
          pot_crv: number | null
          pot_ctrl: number | null
          pot_cutt: number | null
          pot_eye: number | null
          pot_frk: number | null
          pot_fst: number | null
          pot_gap: number | null
          pot_hra: number | null
          pot_knbl: number | null
          pot_kncrv: number | null
          pot_ks: number | null
          pot_lf: number | null
          pot_mov: number | null
          pot_p: number | null
          pot_pbabip: number | null
          pot_pow: number | null
          pot_rf: number | null
          pot_scr: number | null
          pot_sld: number | null
          pot_snk: number | null
          pot_splt: number | null
          pot_ss: number | null
          pot_stf: number | null
          pot_vel: string | null
          pow: number | null
          pow_l: number | null
          pow_r: number | null
          prone: string | null
          refresh_run_id: number
          run: number | null
          sacbunt: number | null
          scr: number | null
          sld: number | null
          snk: number | null
          speed: number | null
          splt: number | null
          steal: number | null
          stf: number | null
          stf_l: number | null
          stf_r: number | null
          stlrt: number | null
          stm: number | null
          tdp: number | null
          team: number | null
          vel: string | null
          wrkethic: string | null
        }
        Insert: {
          acc?: string | null
          armslot?: string | null
          babip?: number | null
          babip_l?: number | null
          babip_r?: number | null
          bunthit?: number | null
          captured_at: string
          carm?: number | null
          cblk?: number | null
          cfrm?: number | null
          chg?: number | null
          circhg?: number | null
          cntct?: number | null
          cntct_l?: number | null
          cntct_r?: number | null
          crv?: number | null
          ctrl?: number | null
          ctrl_l?: number | null
          ctrl_r?: number | null
          cutt?: number | null
          eye?: number | null
          eye_l?: number | null
          eye_r?: number | null
          fbtype?: string | null
          frk?: number | null
          fst?: number | null
          gap?: number | null
          gap_l?: number | null
          gap_r?: number | null
          gb?: number | null
          gbtype?: string | null
          greed?: string | null
          hold?: number | null
          hra?: number | null
          hra_l?: number | null
          hra_r?: number | null
          id?: never
          ifa?: number | null
          ife?: number | null
          ifr?: number | null
          int_?: string | null
          knbl?: number | null
          kncrv?: number | null
          ks?: number | null
          ks_l?: number | null
          ks_r?: number | null
          lead?: string | null
          league?: number | null
          lg_lvl?: number | null
          loy?: string | null
          mov?: number | null
          mov_l?: number | null
          mov_r?: number | null
          ofa?: number | null
          ofe?: number | null
          ofr?: number | null
          org?: number | null
          ovr?: number | null
          pbabip?: number | null
          pbabip_l?: number | null
          pbabip_r?: number | null
          player_id: number
          pos?: string | null
          pos_1b?: number | null
          pos_2b?: number | null
          pos_3b?: number | null
          pos_c?: number | null
          pos_cf?: number | null
          pos_lf?: number | null
          pos_p?: number | null
          pos_rf?: number | null
          pos_ss?: number | null
          pot?: number | null
          pot_1b?: number | null
          pot_2b?: number | null
          pot_3b?: number | null
          pot_babip?: number | null
          pot_c?: number | null
          pot_cf?: number | null
          pot_chg?: number | null
          pot_circhg?: number | null
          pot_cntct?: number | null
          pot_crv?: number | null
          pot_ctrl?: number | null
          pot_cutt?: number | null
          pot_eye?: number | null
          pot_frk?: number | null
          pot_fst?: number | null
          pot_gap?: number | null
          pot_hra?: number | null
          pot_knbl?: number | null
          pot_kncrv?: number | null
          pot_ks?: number | null
          pot_lf?: number | null
          pot_mov?: number | null
          pot_p?: number | null
          pot_pbabip?: number | null
          pot_pow?: number | null
          pot_rf?: number | null
          pot_scr?: number | null
          pot_sld?: number | null
          pot_snk?: number | null
          pot_splt?: number | null
          pot_ss?: number | null
          pot_stf?: number | null
          pot_vel?: string | null
          pow?: number | null
          pow_l?: number | null
          pow_r?: number | null
          prone?: string | null
          refresh_run_id: number
          run?: number | null
          sacbunt?: number | null
          scr?: number | null
          sld?: number | null
          snk?: number | null
          speed?: number | null
          splt?: number | null
          steal?: number | null
          stf?: number | null
          stf_l?: number | null
          stf_r?: number | null
          stlrt?: number | null
          stm?: number | null
          tdp?: number | null
          team?: number | null
          vel?: string | null
          wrkethic?: string | null
        }
        Update: {
          acc?: string | null
          armslot?: string | null
          babip?: number | null
          babip_l?: number | null
          babip_r?: number | null
          bunthit?: number | null
          captured_at?: string
          carm?: number | null
          cblk?: number | null
          cfrm?: number | null
          chg?: number | null
          circhg?: number | null
          cntct?: number | null
          cntct_l?: number | null
          cntct_r?: number | null
          crv?: number | null
          ctrl?: number | null
          ctrl_l?: number | null
          ctrl_r?: number | null
          cutt?: number | null
          eye?: number | null
          eye_l?: number | null
          eye_r?: number | null
          fbtype?: string | null
          frk?: number | null
          fst?: number | null
          gap?: number | null
          gap_l?: number | null
          gap_r?: number | null
          gb?: number | null
          gbtype?: string | null
          greed?: string | null
          hold?: number | null
          hra?: number | null
          hra_l?: number | null
          hra_r?: number | null
          id?: never
          ifa?: number | null
          ife?: number | null
          ifr?: number | null
          int_?: string | null
          knbl?: number | null
          kncrv?: number | null
          ks?: number | null
          ks_l?: number | null
          ks_r?: number | null
          lead?: string | null
          league?: number | null
          lg_lvl?: number | null
          loy?: string | null
          mov?: number | null
          mov_l?: number | null
          mov_r?: number | null
          ofa?: number | null
          ofe?: number | null
          ofr?: number | null
          org?: number | null
          ovr?: number | null
          pbabip?: number | null
          pbabip_l?: number | null
          pbabip_r?: number | null
          player_id?: number
          pos?: string | null
          pos_1b?: number | null
          pos_2b?: number | null
          pos_3b?: number | null
          pos_c?: number | null
          pos_cf?: number | null
          pos_lf?: number | null
          pos_p?: number | null
          pos_rf?: number | null
          pos_ss?: number | null
          pot?: number | null
          pot_1b?: number | null
          pot_2b?: number | null
          pot_3b?: number | null
          pot_babip?: number | null
          pot_c?: number | null
          pot_cf?: number | null
          pot_chg?: number | null
          pot_circhg?: number | null
          pot_cntct?: number | null
          pot_crv?: number | null
          pot_ctrl?: number | null
          pot_cutt?: number | null
          pot_eye?: number | null
          pot_frk?: number | null
          pot_fst?: number | null
          pot_gap?: number | null
          pot_hra?: number | null
          pot_knbl?: number | null
          pot_kncrv?: number | null
          pot_ks?: number | null
          pot_lf?: number | null
          pot_mov?: number | null
          pot_p?: number | null
          pot_pbabip?: number | null
          pot_pow?: number | null
          pot_rf?: number | null
          pot_scr?: number | null
          pot_sld?: number | null
          pot_snk?: number | null
          pot_splt?: number | null
          pot_ss?: number | null
          pot_stf?: number | null
          pot_vel?: string | null
          pow?: number | null
          pow_l?: number | null
          pow_r?: number | null
          prone?: string | null
          refresh_run_id?: number
          run?: number | null
          sacbunt?: number | null
          scr?: number | null
          sld?: number | null
          snk?: number | null
          speed?: number | null
          splt?: number | null
          steal?: number | null
          stf?: number | null
          stf_l?: number | null
          stf_r?: number | null
          stlrt?: number | null
          stm?: number | null
          tdp?: number | null
          team?: number | null
          vel?: string | null
          wrkethic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_ratings_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_ratings_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          age: number | null
          bats: number | null
          date_of_birth: string | null
          days_on_waivers: number | null
          days_on_waivers_left: number | null
          designated_for_assignment: boolean | null
          dl_days_this_year: number | null
          draft_eligible: boolean | null
          draft_league_id: number | null
          draft_overall_pick: number | null
          draft_pick: number | null
          draft_round: number | null
          draft_supplemental: boolean | null
          draft_team_id: number | null
          draft_year: number | null
          first_name: string | null
          free_agent: boolean | null
          hall_of_fame: boolean | null
          has_received_arbitration: boolean | null
          height: number | null
          id: number
          inducted: boolean | null
          injury_dl_left: number | null
          injury_is_injured: boolean | null
          injury_left: number | null
          is_active: boolean | null
          is_on_dl: boolean | null
          is_on_dl60: boolean | null
          is_on_secondary: boolean | null
          is_on_waivers: boolean | null
          last_name: string | null
          last_team_id: number | null
          league_id: number | null
          level: number | null
          mlb_service_days: number | null
          mlb_service_days_this_year: number | null
          mlb_service_years: number | null
          nation_id: number | null
          organization_id: number | null
          parent_team_id: number | null
          pos: number | null
          pro_service_days: number | null
          pro_service_days_this_year: number | null
          pro_service_years: number | null
          retired: boolean | null
          role: number | null
          secondary_service_days: number | null
          secondary_service_days_this_year: number | null
          secondary_service_years: number | null
          team_id: number | null
          throws: number | null
          uniform_number: number | null
          updated_at: string
          was_traded: boolean | null
          weight: number | null
          years_protected_from_rule_5: number | null
        }
        Insert: {
          age?: number | null
          bats?: number | null
          date_of_birth?: string | null
          days_on_waivers?: number | null
          days_on_waivers_left?: number | null
          designated_for_assignment?: boolean | null
          dl_days_this_year?: number | null
          draft_eligible?: boolean | null
          draft_league_id?: number | null
          draft_overall_pick?: number | null
          draft_pick?: number | null
          draft_round?: number | null
          draft_supplemental?: boolean | null
          draft_team_id?: number | null
          draft_year?: number | null
          first_name?: string | null
          free_agent?: boolean | null
          hall_of_fame?: boolean | null
          has_received_arbitration?: boolean | null
          height?: number | null
          id: number
          inducted?: boolean | null
          injury_dl_left?: number | null
          injury_is_injured?: boolean | null
          injury_left?: number | null
          is_active?: boolean | null
          is_on_dl?: boolean | null
          is_on_dl60?: boolean | null
          is_on_secondary?: boolean | null
          is_on_waivers?: boolean | null
          last_name?: string | null
          last_team_id?: number | null
          league_id?: number | null
          level?: number | null
          mlb_service_days?: number | null
          mlb_service_days_this_year?: number | null
          mlb_service_years?: number | null
          nation_id?: number | null
          organization_id?: number | null
          parent_team_id?: number | null
          pos?: number | null
          pro_service_days?: number | null
          pro_service_days_this_year?: number | null
          pro_service_years?: number | null
          retired?: boolean | null
          role?: number | null
          secondary_service_days?: number | null
          secondary_service_days_this_year?: number | null
          secondary_service_years?: number | null
          team_id?: number | null
          throws?: number | null
          uniform_number?: number | null
          updated_at?: string
          was_traded?: boolean | null
          weight?: number | null
          years_protected_from_rule_5?: number | null
        }
        Update: {
          age?: number | null
          bats?: number | null
          date_of_birth?: string | null
          days_on_waivers?: number | null
          days_on_waivers_left?: number | null
          designated_for_assignment?: boolean | null
          dl_days_this_year?: number | null
          draft_eligible?: boolean | null
          draft_league_id?: number | null
          draft_overall_pick?: number | null
          draft_pick?: number | null
          draft_round?: number | null
          draft_supplemental?: boolean | null
          draft_team_id?: number | null
          draft_year?: number | null
          first_name?: string | null
          free_agent?: boolean | null
          hall_of_fame?: boolean | null
          has_received_arbitration?: boolean | null
          height?: number | null
          id?: number
          inducted?: boolean | null
          injury_dl_left?: number | null
          injury_is_injured?: boolean | null
          injury_left?: number | null
          is_active?: boolean | null
          is_on_dl?: boolean | null
          is_on_dl60?: boolean | null
          is_on_secondary?: boolean | null
          is_on_waivers?: boolean | null
          last_name?: string | null
          last_team_id?: number | null
          league_id?: number | null
          level?: number | null
          mlb_service_days?: number | null
          mlb_service_days_this_year?: number | null
          mlb_service_years?: number | null
          nation_id?: number | null
          organization_id?: number | null
          parent_team_id?: number | null
          pos?: number | null
          pro_service_days?: number | null
          pro_service_days_this_year?: number | null
          pro_service_years?: number | null
          retired?: boolean | null
          role?: number | null
          secondary_service_days?: number | null
          secondary_service_days_this_year?: number | null
          secondary_service_years?: number | null
          team_id?: number | null
          throws?: number | null
          uniform_number?: number | null
          updated_at?: string
          was_traded?: boolean | null
          weight?: number | null
          years_protected_from_rule_5?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "players_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_bios: {
        Row: {
          bio_text: string
          generated_at: string
          player_id: number
          refresh_run_id: number
        }
        Insert: {
          bio_text: string
          generated_at?: string
          player_id: number
          refresh_run_id: number
        }
        Update: {
          bio_text?: string
          generated_at?: string
          player_id?: number
          refresh_run_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "prospect_bios_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_bios_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      rating_weights: {
        Row: {
          avoid_ks: number
          catcher_batting_multiplier: number
          catcher_fielding_bonus: number
          cf_batting_multiplier: number
          contact: number
          contact_gate_low_multiplier: number
          contact_gate_low_threshold: number
          contact_gate_mid_multiplier: number
          contact_gate_mid_threshold: number
          control: number
          control_gate_low_multiplier: number
          control_gate_low_threshold: number
          control_gate_mid_multiplier: number
          control_gate_mid_threshold: number
          created_at: string
          developed_age_threshold: number
          eye: number
          fielding: number
          gap: number
          id: number
          infield_fielding_bonus: number
          is_active: boolean
          label: string
          movement: number
          notes: string | null
          outfield_fielding_bonus: number
          pbabip: number
          power: number
          qp_multiplier: number
          qp_threshold: number
          qpp_threshold: number
          sp_rp_min_pitches: number
          sp_rp_stamina_threshold: number
          speed: number
          ss_batting_multiplier: number
          stamina: number
          stuff: number
        }
        Insert: {
          avoid_ks: number
          catcher_batting_multiplier?: number
          catcher_fielding_bonus?: number
          cf_batting_multiplier?: number
          contact: number
          contact_gate_low_multiplier?: number
          contact_gate_low_threshold?: number
          contact_gate_mid_multiplier?: number
          contact_gate_mid_threshold?: number
          control: number
          control_gate_low_multiplier?: number
          control_gate_low_threshold?: number
          control_gate_mid_multiplier?: number
          control_gate_mid_threshold?: number
          created_at?: string
          developed_age_threshold?: number
          eye: number
          fielding: number
          gap: number
          id?: never
          infield_fielding_bonus?: number
          is_active?: boolean
          label: string
          movement: number
          notes?: string | null
          outfield_fielding_bonus?: number
          pbabip: number
          power: number
          qp_multiplier: number
          qp_threshold?: number
          qpp_threshold?: number
          sp_rp_min_pitches?: number
          sp_rp_stamina_threshold?: number
          speed: number
          ss_batting_multiplier?: number
          stamina: number
          stuff: number
        }
        Update: {
          avoid_ks?: number
          catcher_batting_multiplier?: number
          catcher_fielding_bonus?: number
          cf_batting_multiplier?: number
          contact?: number
          contact_gate_low_multiplier?: number
          contact_gate_low_threshold?: number
          contact_gate_mid_multiplier?: number
          contact_gate_mid_threshold?: number
          control?: number
          control_gate_low_multiplier?: number
          control_gate_low_threshold?: number
          control_gate_mid_multiplier?: number
          control_gate_mid_threshold?: number
          created_at?: string
          developed_age_threshold?: number
          eye?: number
          fielding?: number
          gap?: number
          id?: never
          infield_fielding_bonus?: number
          is_active?: boolean
          label?: string
          movement?: number
          notes?: string | null
          outfield_fielding_bonus?: number
          pbabip?: number
          power?: number
          qp_multiplier?: number
          qp_threshold?: number
          qpp_threshold?: number
          sp_rp_min_pitches?: number
          sp_rp_stamina_threshold?: number
          speed?: number
          ss_batting_multiplier?: number
          stamina?: number
          stuff?: number
        }
        Relationships: []
      }
      refresh_runs: {
        Row: {
          completed_at: string | null
          draft_pool_count: number | null
          free_agent_count: number | null
          game_date: string | null
          id: number
          international_count: number | null
          minor_league_count: number | null
          mlb_count: number | null
          notes: string | null
          ratings_included: boolean
          retired_count: number | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          draft_pool_count?: number | null
          free_agent_count?: number | null
          game_date?: string | null
          id?: never
          international_count?: number | null
          minor_league_count?: number | null
          mlb_count?: number | null
          notes?: string | null
          ratings_included?: boolean
          retired_count?: number | null
          started_at?: string
          status: string
        }
        Update: {
          completed_at?: string | null
          draft_pool_count?: number | null
          free_agent_count?: number | null
          game_date?: string | null
          id?: never
          international_count?: number | null
          minor_league_count?: number | null
          mlb_count?: number | null
          notes?: string | null
          ratings_included?: boolean
          retired_count?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      system_rank_weights: {
        Row: {
          balance_penalty: number
          blue_chip_cutoff: number
          created_at: string
          id: number
          is_active: boolean
          label: string
          notes: string | null
        }
        Insert: {
          balance_penalty?: number
          blue_chip_cutoff?: number
          created_at?: string
          id?: never
          is_active?: boolean
          label: string
          notes?: string | null
        }
        Update: {
          balance_penalty?: number
          blue_chip_cutoff?: number
          created_at?: string
          id?: never
          is_active?: boolean
          label?: string
          notes?: string | null
        }
        Relationships: []
      }
      team_batting_stats_snapshots: {
        Row: {
          ab: number | null
          abbr: string | null
          avg: number | null
          babip: number | null
          bb: number | null
          bb_pct: number | null
          captured_at: string
          ci: number | null
          cs: number | null
          d: number | null
          gidp: number | null
          h: number | null
          hp: number | null
          hr: number | null
          ibb: number | null
          id: number
          iso: number | null
          k: number | null
          k_pct: number | null
          obp: number | null
          ops: number | null
          pa: number | null
          r: number | null
          rbi: number | null
          refresh_run_id: number
          s: number | null
          sb: number | null
          sf: number | null
          sh: number | null
          slg: number | null
          split_id: number | null
          t: number | null
          tb: number | null
          team_id: number
          woba: number | null
          xbh: number | null
          year: number | null
        }
        Insert: {
          ab?: number | null
          abbr?: string | null
          avg?: number | null
          babip?: number | null
          bb?: number | null
          bb_pct?: number | null
          captured_at: string
          ci?: number | null
          cs?: number | null
          d?: number | null
          gidp?: number | null
          h?: number | null
          hp?: number | null
          hr?: number | null
          ibb?: number | null
          id?: never
          iso?: number | null
          k?: number | null
          k_pct?: number | null
          obp?: number | null
          ops?: number | null
          pa?: number | null
          r?: number | null
          rbi?: number | null
          refresh_run_id: number
          s?: number | null
          sb?: number | null
          sf?: number | null
          sh?: number | null
          slg?: number | null
          split_id?: number | null
          t?: number | null
          tb?: number | null
          team_id: number
          woba?: number | null
          xbh?: number | null
          year?: number | null
        }
        Update: {
          ab?: number | null
          abbr?: string | null
          avg?: number | null
          babip?: number | null
          bb?: number | null
          bb_pct?: number | null
          captured_at?: string
          ci?: number | null
          cs?: number | null
          d?: number | null
          gidp?: number | null
          h?: number | null
          hp?: number | null
          hr?: number | null
          ibb?: number | null
          id?: never
          iso?: number | null
          k?: number | null
          k_pct?: number | null
          obp?: number | null
          ops?: number | null
          pa?: number | null
          r?: number | null
          rbi?: number | null
          refresh_run_id?: number
          s?: number | null
          sb?: number | null
          sf?: number | null
          sh?: number | null
          slg?: number | null
          split_id?: number | null
          t?: number | null
          tb?: number | null
          team_id?: number
          woba?: number | null
          xbh?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_batting_stats_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_batting_stats_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_computed: {
        Row: {
          balance_index: number | null
          batting: number | null
          batting_prospect_rank: number | null
          batting_rank: number | null
          blue_chip_score: number | null
          captured_at: string
          depth_score: number | null
          draft_rating: number | null
          fielding: number | null
          fielding_rank: number | null
          id: number
          minor_league_batting_rating: number | null
          minor_league_pitching_rating: number | null
          minor_league_rating: number | null
          minor_league_readiness_rating: number | null
          minors_rank: number | null
          pitching: number | null
          pitching_prospect_rank: number | null
          pitching_rank: number | null
          power_rank: number | null
          power_ranking: number | null
          rank_rank: number | null
          refresh_run_id: number
          roster_rank: number | null
          system_rank_weights_id: number | null
          tbl_readiness_rank: number | null
          team_id: number
          team_ovr: number | null
          team_rank: number | null
          top_100_prospects_count: number | null
          w_rank: number | null
          weights_id: number | null
        }
        Insert: {
          balance_index?: number | null
          batting?: number | null
          batting_prospect_rank?: number | null
          batting_rank?: number | null
          blue_chip_score?: number | null
          captured_at: string
          depth_score?: number | null
          draft_rating?: number | null
          fielding?: number | null
          fielding_rank?: number | null
          id?: never
          minor_league_batting_rating?: number | null
          minor_league_pitching_rating?: number | null
          minor_league_rating?: number | null
          minor_league_readiness_rating?: number | null
          minors_rank?: number | null
          pitching?: number | null
          pitching_prospect_rank?: number | null
          pitching_rank?: number | null
          power_rank?: number | null
          power_ranking?: number | null
          rank_rank?: number | null
          refresh_run_id: number
          roster_rank?: number | null
          system_rank_weights_id?: number | null
          tbl_readiness_rank?: number | null
          team_id: number
          team_ovr?: number | null
          team_rank?: number | null
          top_100_prospects_count?: number | null
          w_rank?: number | null
          weights_id?: number | null
        }
        Update: {
          balance_index?: number | null
          batting?: number | null
          batting_prospect_rank?: number | null
          batting_rank?: number | null
          blue_chip_score?: number | null
          captured_at?: string
          depth_score?: number | null
          draft_rating?: number | null
          fielding?: number | null
          fielding_rank?: number | null
          id?: never
          minor_league_batting_rating?: number | null
          minor_league_pitching_rating?: number | null
          minor_league_rating?: number | null
          minor_league_readiness_rating?: number | null
          minors_rank?: number | null
          pitching?: number | null
          pitching_prospect_rank?: number | null
          pitching_rank?: number | null
          power_rank?: number | null
          power_ranking?: number | null
          rank_rank?: number | null
          refresh_run_id?: number
          roster_rank?: number | null
          system_rank_weights_id?: number | null
          tbl_readiness_rank?: number | null
          team_id?: number
          team_ovr?: number | null
          team_rank?: number | null
          top_100_prospects_count?: number | null
          w_rank?: number | null
          weights_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_computed_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_computed_system_rank_weights_id_fkey"
            columns: ["system_rank_weights_id"]
            isOneToOne: false
            referencedRelation: "system_rank_weights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_computed_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_computed_weights_id_fkey"
            columns: ["weights_id"]
            isOneToOne: false
            referencedRelation: "rating_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      team_pitching_stats_snapshots: {
        Row: {
          ab: number | null
          abbr: string | null
          avg: number | null
          babip: number | null
          bb: number | null
          bb_pct: number | null
          bf: number | null
          bk: number | null
          bs: number | null
          captured_at: string
          cg: number | null
          ci: number | null
          d: number | null
          e_f: number | null
          er: number | null
          era: number | null
          fb: number | null
          fip: number | null
          gb: number | null
          gbfb: number | null
          ha: number | null
          hp: number | null
          hr_pct: number | null
          hra: number | null
          hrfb: number | null
          id: number
          ip: number | null
          ipf: number | null
          iw: number | null
          k: number | null
          k_bb_pct: number | null
          k_pct: number | null
          lob: number | null
          obp: number | null
          outs: number | null
          pi: number | null
          r: number | null
          refresh_run_id: number
          s: number | null
          sa: number | null
          sf: number | null
          sh: number | null
          split_id: number | null
          t: number | null
          tb: number | null
          team_id: number
          wp: number | null
          x_fip: number | null
          year: number | null
        }
        Insert: {
          ab?: number | null
          abbr?: string | null
          avg?: number | null
          babip?: number | null
          bb?: number | null
          bb_pct?: number | null
          bf?: number | null
          bk?: number | null
          bs?: number | null
          captured_at: string
          cg?: number | null
          ci?: number | null
          d?: number | null
          e_f?: number | null
          er?: number | null
          era?: number | null
          fb?: number | null
          fip?: number | null
          gb?: number | null
          gbfb?: number | null
          ha?: number | null
          hp?: number | null
          hr_pct?: number | null
          hra?: number | null
          hrfb?: number | null
          id?: never
          ip?: number | null
          ipf?: number | null
          iw?: number | null
          k?: number | null
          k_bb_pct?: number | null
          k_pct?: number | null
          lob?: number | null
          obp?: number | null
          outs?: number | null
          pi?: number | null
          r?: number | null
          refresh_run_id: number
          s?: number | null
          sa?: number | null
          sf?: number | null
          sh?: number | null
          split_id?: number | null
          t?: number | null
          tb?: number | null
          team_id: number
          wp?: number | null
          x_fip?: number | null
          year?: number | null
        }
        Update: {
          ab?: number | null
          abbr?: string | null
          avg?: number | null
          babip?: number | null
          bb?: number | null
          bb_pct?: number | null
          bf?: number | null
          bk?: number | null
          bs?: number | null
          captured_at?: string
          cg?: number | null
          ci?: number | null
          d?: number | null
          e_f?: number | null
          er?: number | null
          era?: number | null
          fb?: number | null
          fip?: number | null
          gb?: number | null
          gbfb?: number | null
          ha?: number | null
          hp?: number | null
          hr_pct?: number | null
          hra?: number | null
          hrfb?: number | null
          id?: never
          ip?: number | null
          ipf?: number | null
          iw?: number | null
          k?: number | null
          k_bb_pct?: number | null
          k_pct?: number | null
          lob?: number | null
          obp?: number | null
          outs?: number | null
          pi?: number | null
          r?: number | null
          refresh_run_id?: number
          s?: number | null
          sa?: number | null
          sf?: number | null
          sh?: number | null
          split_id?: number | null
          t?: number | null
          tb?: number | null
          team_id?: number
          wp?: number | null
          x_fip?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_pitching_stats_snapshots_refresh_run_id_fkey"
            columns: ["refresh_run_id"]
            isOneToOne: false
            referencedRelation: "refresh_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_pitching_stats_snapshots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          id: number
          name: string
          nickname: string
          parent_team_id: number | null
          updated_at: string
        }
        Insert: {
          id: number
          name: string
          nickname: string
          parent_team_id?: number | null
          updated_at?: string
        }
        Update: {
          id?: number
          name?: string
          nickname?: string
          parent_team_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_parent_team_id_fkey"
            columns: ["parent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_block_snapshots: {
        Row: {
          captured_at: string
          id: number
          note: string
          player_id: number
          refresh_run_id: number
        }
        Insert: {
          captured_at?: string
          id?: never
          note?: string
          player_id: number
          refresh_run_id: number
        }
        Update: {
          captured_at?: string
          id?: never
          note?: string
          player_id?: number
          refresh_run_id?: number
        }
        Relationships: []
      }
      trade_event_items: {
        Row: {
          cash_amount: number | null
          id: number
          pick_round: number | null
          pick_team_id: number | null
          pick_team_name: string | null
          pick_year: number | null
          player_id: number | null
          retained_salary_pct: number | null
          side: string
          trade_event_id: number
        }
        Insert: {
          cash_amount?: number | null
          id?: never
          pick_round?: number | null
          pick_team_id?: number | null
          pick_team_name?: string | null
          pick_year?: number | null
          player_id?: number | null
          retained_salary_pct?: number | null
          side: string
          trade_event_id: number
        }
        Update: {
          cash_amount?: number | null
          id?: never
          pick_round?: number | null
          pick_team_id?: number | null
          pick_team_name?: string | null
          pick_year?: number | null
          player_id?: number | null
          retained_salary_pct?: number | null
          side?: string
          trade_event_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "trade_event_items_pick_team_id_fkey"
            columns: ["pick_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_event_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_event_items_trade_event_id_fkey"
            columns: ["trade_event_id"]
            isOneToOne: false
            referencedRelation: "trade_events"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_events: {
        Row: {
          captured_at: string
          id: number
          status: string
          team_a_id: number | null
          team_a_name: string | null
          team_b_id: number | null
          team_b_name: string | null
          trade_date: string
          trade_key: string
        }
        Insert: {
          captured_at?: string
          id?: never
          status?: string
          team_a_id?: number | null
          team_a_name?: string | null
          team_b_id?: number | null
          team_b_name?: string | null
          trade_date: string
          trade_key: string
        }
        Update: {
          captured_at?: string
          id?: never
          status?: string
          team_a_id?: number | null
          team_a_name?: string | null
          team_b_id?: number | null
          team_b_name?: string | null
          trade_date?: string
          trade_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_events_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_events_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
