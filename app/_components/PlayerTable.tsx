"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { PlayerRow } from "../../lib/queries";
// Import from display-helpers directly, NOT queries.ts -- queries.ts also
// creates a Supabase client at module scope using server-only secrets, which
// would crash the browser bundle if a "use client" component pulled in even
// one unrelated value export from that file. See display-helpers.ts's top
// comment (and ProspectTable.tsx, which hit this for real first).
import { gradeStyle, percentileStyle, statsPlusPlayerUrl } from "../../lib/display-helpers";

// Raw/full precision throughout (2026-08-27, Rees's spec) -- both /players
// and /draft (the two pages sharing this component) are admin-only, not on
// the public site (see middleware.ts's GUEST_ALLOWED_PATHS), so the
// nearest-5 public rounding rule (roundGrade, see display-helpers.ts) does
// NOT apply here -- same reasoning /org-minors already uses for its own org.
const fmt1 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(1));
const fmtInt = (n: number | null) => (n === null || n === undefined ? "—" : Math.round(n));
const fmtMoney = (n: number | null) => {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
// Value-gap color (2026-09-04, Rees's ask) reuses percentileStyle -- the
// same red/orange/yellow/green/blue "how good is this, relatively" scale
// already used for Role Health's RAG comparisons -- rather than inventing a
// new color language for this one column. valueGapPct (positive = asking
// for LESS than he's worth, a bargain; negative = asking for MORE, an
// overpay) isn't itself a 0-100 percentile, so it's re-anchored here: 0%
// gap (fair value) -> 50 (neutral yellow), +/-50% gap -> the scale's ends.
const valueGapStyle = (pct: number | null) => (pct === null ? undefined : percentileStyle(Math.max(0, Math.min(100, 50 + pct))));

// Same fixed display order as ProspectTable's Role filter (2026-08-20 spec) --
// roughly pitchers first, then hitter roles by defensive spectrum.
const ROLE_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "COF", "CF", "DH"];

// Injury proneness (2026-09-09, Rees's ask) -- best to worst, the real
// distinct values confirmed in player_ratings_snapshots.prone. Colors follow
// the sitewide gradient's own stops loosely (green=good, red=bad) rather
// than a numeric interpolation, since this is a 5-tier category, not a
// 20-80 grade.
const PRONE_ORDER = ["Iron Man", "Durable", "Normal", "Fragile", "Wrecked"];
const PRONE_COLORS: Record<string, string> = {
  "Iron Man": "rgb(56,189,248)", Durable: "rgb(34,197,94)", Normal: "var(--color-text-muted, #888)",
  Fragile: "rgb(249,115,22)", Wrecked: "rgb(220,38,38)",
};

type SortKey =
  | "name" | "pos" | "role" | "team" | "age"
  // Combined hitter/pitcher tool columns (2026-09-04, Rees's ask -- cuts 8
  // columns to 4 so everything fits on one screen without a scrollbar).
  // Each pairs the hitter grade with its closest pitcher analog; only one
  // side is ever meaningful for a given player (the other reads a flat 20,
  // the "not applicable" placeholder), so showing both in the same column
  // loses no information.
  | "contactStuff" | "powerMovement" | "eyeControl" | "speedStamina"
  | "overall" | "potential" | "ab" | "ip" | "war" | "prospect_potential" | "prospect_rank"
  | "demand" | "fairValue" | "valueGap" | "sign" | "prone";

// r.ph is "H" for a hitter, "P" for a pitcher (null is not expected in
// practice but falls back to the hitter side, matching every other
// nullable-ph default in this component).
const combined = (r: PlayerRow, hitterVal: number | null, pitcherVal: number | null) => (r.ph === "P" ? pitcherVal : hitterVal);

export function PlayerTable({ rows, showTeam, showProspectCols, showStatLevel, showValueVsDemand, showSign, renderLimit }: { rows: PlayerRow[]; showTeam: boolean; showProspectCols: boolean; showStatLevel?: boolean; showValueVsDemand?: boolean; showSign?: boolean; renderLimit?: number }) {
  // Multi-league routing (2026-09-10) -- this table is only ever rendered
  // under a page inside app/[league]/..., so the league slug is always in
  // the URL.
  const { league } = useParams<{ league: string }>();
  const [phFilter, setPhFilter] = useState<"all" | "H" | "P">("all");
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  // Age filter (2026-09-06, Rees's ask) -- plain text state (not number) so
  // an in-progress edit (e.g. a lone "-" or an empty field while retyping)
  // doesn't fight the input; parsed to a number only where actually used
  // below. Empty string = no bound on that side.
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  // Min Overall filter (2026-09-07, Rees's ask -- for the Rule 5 Draft
  // Board, but generically useful anywhere, same reasoning as Age) -- min
  // only, per the actual ask, not a range like Age; easy to add a max later
  // if that's ever wanted too.
  const [overallMin, setOverallMin] = useState("");
  // Sign-only filter (2026-09-06, Rees's ask) -- only meaningful where the
  // Sign column itself is shown (showSign), same gating as the column.
  const [signOnly, setSignOnly] = useState(false);
  // Injury Proneness filter (2026-09-09, Rees's ask) -- multi-select chips,
  // same pattern as Role. Generic (not gated behind a prop), same reasoning
  // as Age/Min Overall -- prone is now populated for every PlayerTable
  // consumer, not just /free-agency.
  const [proneFilter, setProneFilter] = useState<Set<string>>(new Set());
  // Demand filter (2026-09-09, Rees's ask) -- only meaningful where Demand
  // itself is shown (showValueVsDemand), same gating as those columns.
  // Entered in whole millions (matching fmtMoney's own display convention)
  // rather than raw dollars -- typing "5" for $5M beats typing "5000000".
  const [demandMinM, setDemandMinM] = useState("");
  const [demandMaxM, setDemandMaxM] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handlePhFilter(f: "all" | "H" | "P") {
    setPhFilter(f);
    setRoleFilter(new Set()); // last role selection may not apply to the new H/P set
  }

  function toggleRole(role: string) {
    setRoleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  function toggleProne(prone: string) {
    setProneFilter((prev) => {
      const next = new Set(prev);
      if (next.has(prone)) next.delete(prone);
      else next.add(prone);
      return next;
    });
  }

  const phFiltered = useMemo(
    () => (phFilter === "all" ? rows : rows.filter((r) => r.ph === phFilter)),
    [rows, phFilter]
  );

  // Role options derived from the current H/P-filtered set, same pattern as
  // ProspectTable -- switching to Pitchers only ever offers SP/RP, etc.
  const roleOptions = useMemo(() => {
    const present = new Set(phFiltered.map((r) => r.role).filter((r): r is string => !!r));
    return ROLE_ORDER.filter((role) => present.has(role));
  }, [phFiltered]);

  // Prone options, same derivation pattern as Role -- only offer chips for
  // categories actually present in the current H/P-filtered set.
  const proneOptions = useMemo(() => {
    const present = new Set(phFiltered.map((r) => r.prone).filter((p): p is string => !!p));
    return PRONE_ORDER.filter((p) => present.has(p));
  }, [phFiltered]);

  // Multi-select: empty set = no role/prone filter applied. Age min/max,
  // Overall min, Demand min/max, and sign-only chain on top -- a player
  // missing age/overall or a null/false Sign never matches an active bound
  // rather than passing through by default. Demand is the one exception:
  // a null demandSalary passes a max filter (no ask on file reads as "no
  // demand," not "unknown/excluded") but still fails a min filter (see the
  // demandMax/demandMin lines below for why).
  const filteredRows = useMemo(() => {
    let out = roleFilter.size === 0 ? phFiltered : phFiltered.filter((r) => r.role !== null && roleFilter.has(r.role));
    if (proneFilter.size > 0) out = out.filter((r) => r.prone !== null && proneFilter.has(r.prone));
    const min = ageMin.trim() === "" ? null : Number(ageMin);
    const max = ageMax.trim() === "" ? null : Number(ageMax);
    if (min !== null && !Number.isNaN(min)) out = out.filter((r) => r.age !== null && r.age >= min);
    if (max !== null && !Number.isNaN(max)) out = out.filter((r) => r.age !== null && r.age <= max);
    const minOverall = overallMin.trim() === "" ? null : Number(overallMin);
    if (minOverall !== null && !Number.isNaN(minOverall)) out = out.filter((r) => r.overall >= minOverall);
    const demandMin = demandMinM.trim() === "" ? null : Number(demandMinM) * 1_000_000;
    const demandMax = demandMaxM.trim() === "" ? null : Number(demandMaxM) * 1_000_000;
    if (demandMin !== null && !Number.isNaN(demandMin)) out = out.filter((r) => r.demandSalary !== null && r.demandSalary >= demandMin);
    // Max is a ceiling, not a range bound -- a null demand (no real ask on
    // file, e.g. a minor-league-contract guy) is effectively "no demand,"
    // which is always under any max, so it should pass a max filter rather
    // than get excluded the way a genuinely-too-expensive player would be
    // (2026-09-09 fix, Rees: "the max demand filter filters out players
    // with no demand... that is incorrect"). Min keeps excluding nulls --
    // "at least $X" is a real bar a no-demand player hasn't cleared.
    if (demandMax !== null && !Number.isNaN(demandMax)) out = out.filter((r) => r.demandSalary === null || r.demandSalary <= demandMax);
    if (signOnly) out = out.filter((r) => r.signFlag === true);
    return out;
  }, [phFiltered, roleFilter, proneFilter, ageMin, ageMax, overallMin, demandMinM, demandMaxM, signOnly]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    return [...filteredRows].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (sortKey) {
        case "name": av = `${a.last_name}, ${a.first_name}`; bv = `${b.last_name}, ${b.first_name}`; break;
        case "pos": av = a.pos ?? ""; bv = b.pos ?? ""; break;
        case "role": av = a.role ?? ""; bv = b.role ?? ""; break;
        case "team": av = a.team_abbr ?? a.team_nickname ?? ""; bv = b.team_abbr ?? b.team_nickname ?? ""; break;
        case "age": av = a.age ?? -1; bv = b.age ?? -1; break;
        case "contactStuff": av = combined(a, a.cntct, a.stf) ?? -1; bv = combined(b, b.cntct, b.stf) ?? -1; break;
        case "powerMovement": av = combined(a, a.pow, a.mov) ?? -1; bv = combined(b, b.pow, b.mov) ?? -1; break;
        case "eyeControl": av = combined(a, a.eye, a.ctrl) ?? -1; bv = combined(b, b.eye, b.ctrl) ?? -1; break;
        case "speedStamina": av = combined(a, a.speed, a.stm) ?? -1; bv = combined(b, b.speed, b.stm) ?? -1; break;
        case "overall": av = a.overall ?? -1; bv = b.overall ?? -1; break;
        case "potential": av = a.potential ?? -1; bv = b.potential ?? -1; break;
        case "ab": av = a.ab ?? -1; bv = b.ab ?? -1; break;
        case "ip": av = a.ip ?? -1; bv = b.ip ?? -1; break;
        case "war": av = a.war ?? -999; bv = b.war ?? -999; break; // WAR can be genuinely negative, unlike the other -1-sentinel columns above
        // Missing prospect_potential/prospect_rank sort to the bottom
        // regardless of direction intent for rank (999999, not -1 -- a
        // smaller rank is "better", so an absent one shouldn't sort first
        // on ascending).
        case "prospect_potential": av = a.prospect_potential ?? -1; bv = b.prospect_potential ?? -1; break;
        case "prospect_rank": av = a.prospect_rank ?? 999999; bv = b.prospect_rank ?? 999999; break;
        case "demand": av = a.demandSalary ?? -1; bv = b.demandSalary ?? -1; break;
        case "fairValue": av = a.fairValueAav ?? -1; bv = b.fairValueAav ?? -1; break;
        // Missing valueGapPct (no demand or no fair-value estimate) sorts to
        // the bottom regardless of direction -- there's no real "unknown is
        // better/worse" answer, so it shouldn't compete with real values.
        case "valueGap": av = a.valueGapPct ?? -999; bv = b.valueGapPct ?? -999; break;
        // Missing (null, unevaluable) sorts to the bottom regardless of
        // direction, same reasoning as valueGap above; true before false.
        case "sign": av = a.signFlag === true ? 1 : a.signFlag === false ? 0 : -1; bv = b.signFlag === true ? 1 : b.signFlag === false ? 0 : -1; break;
        // Ranked by real durability (Iron Man best, Wrecked worst), not
        // alphabetically -- higher score = more durable, so "desc" reads as
        // "most durable first," consistent with every other column here.
        case "prone": av = a.prone ? PRONE_ORDER.length - PRONE_ORDER.indexOf(a.prone) : -1; bv = b.prone ? PRONE_ORDER.length - PRONE_ORDER.indexOf(b.prone) : -1; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filteredRows, sortKey, sortDir]);

  // renderLimit (2026-09-07, Rees's ask -- "show up to 100 players with
  // filters, sorting and all interactions included"). Applied HERE, after
  // filtering/sorting, not to `rows` itself -- capping the input instead
  // would mean a filter (Sign-only, a young Age range) could only ever
  // search within whatever happened to already be in the first N by
  // Overall, which defeats filters that specifically surface players who
  // AREN'T at the top of that list. This way "up to 100" always means the
  // top 100 of your CURRENT view, recomputed live as filters/sort change.
  const visibleRows = renderLimit ? sortedRows.slice(0, renderLimit) : sortedRows;

  // Headers wrap, values don't (2026-09-04, Rees's ask) -- overrides
  // globals.css's sitewide `th { white-space: nowrap }` (shared by every
  // table on the site, so changed here inline rather than there, to avoid
  // touching Top Prospects/System Rankings/etc.). Allowing wrap alone isn't
  // enough on its own -- table-layout:auto sizes a column to fit its
  // widest UNWRAPPED content regardless of white-space, so nothing actually
  // wraps until something caps the header's own preferred width. maxWidth
  // does that: the header wraps within it, and the column then shrinks to
  // roughly that width, UNLESS a value cell (still nowrap) is genuinely
  // wider, in which case the value correctly wins and the header just
  // wraps further to match -- values are never the thing forced to shrink.
  const th = (label: string, key: SortKey) => (
    <th onClick={() => toggleSort(key)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "normal", lineHeight: 1.2, maxWidth: "4.5rem" }}>
      {label}{sortKey === key ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );

  // Base 14: Name/Pos/Role/Age/Durability/Overall/Potential/AB/IP/WAR + the 4
  // combined grade columns. Fixed 2026-09-04 to actually account for
  // showStatLevel/showValueVsDemand -- previously hardcoded at a stale 15
  // that predated both those props, so the empty-state row's colSpan
  // silently under- or over-counted (a cosmetic miss: the "No players
  // match" message just wouldn't span the real table width in those
  // cases). Bumped 13->14 on 2026-09-09 for the new always-shown
  // Durability column.
  const colCount = 14 + (showTeam ? 1 : 0) + (showStatLevel ? 1 : 0) + (showValueVsDemand ? 3 : 0) + (showProspectCols ? 2 : 0) + (showSign ? 1 : 0);

  return (
    // player-table-page marker (2026-09-04, Rees's ask) -- widens .site-main
    // for every page using this table (see globals.css's .site-main:has()
    // rule), same established mechanism as the org-minors/prospects-report
    // page-specific width overrides. Measured real: at the site's normal
    // 1200px, /free-agency's full column set (18 with Level + value-vs-
    // demand) already renders at ~1270px, already forcing .table-wrap's
    // horizontal-scroll fallback -- this removes that.
    <div className="player-table-page">
      <div className="filter-bar" style={{ flexWrap: "wrap" }}>
        {(["all", "H", "P"] as const).map((f) => (
          <button
            key={f}
            onClick={() => handlePhFilter(f)}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              border: "1px solid var(--color-border-strong)",
              borderRadius: 4,
              background: phFilter === f ? "var(--color-navy)" : "transparent",
              color: phFilter === f ? "var(--color-text-on-navy)" : "inherit",
              cursor: "pointer",
            }}
          >
            {f === "all" ? "All" : f === "H" ? "Hitters" : "Pitchers"}
          </button>
        ))}
        <span style={{ fontSize: 12 }}>Role</span>
        {roleOptions.map((role) => (
          <button
            key={role}
            onClick={() => toggleRole(role)}
            aria-pressed={roleFilter.has(role)}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              border: "1px solid var(--color-border-strong)",
              borderRadius: 4,
              background: roleFilter.has(role) ? "var(--color-navy)" : "transparent",
              color: roleFilter.has(role) ? "var(--color-text-on-navy)" : "inherit",
              cursor: "pointer",
            }}
          >
            {role}
          </button>
        ))}
        {roleFilter.size > 0 && (
          <button
            onClick={() => setRoleFilter(new Set())}
            style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
          >
            Clear roles
          </button>
        )}
        {/* Injury Proneness filter (2026-09-09, Rees's ask) -- same
            multi-select-chip pattern as Role, colored by durability
            (green=durable, red=injury-prone) rather than the neutral
            navy-highlight Role uses, so a glance at the active chips already
            reads as "which risk level am I including." */}
        {proneOptions.length > 0 && <span style={{ fontSize: 12 }}>Durability</span>}
        {proneOptions.map((prone) => {
          const active = proneFilter.has(prone);
          const color = PRONE_COLORS[prone] ?? "var(--color-border-strong)";
          return (
            <button
              key={prone}
              onClick={() => toggleProne(prone)}
              aria-pressed={active}
              style={{
                padding: "3px 10px",
                fontSize: 12,
                border: `1.5px solid ${color}`,
                borderRadius: 4,
                background: active ? color : "transparent",
                color: active ? "#fff" : "inherit",
                cursor: "pointer",
              }}
            >
              {prone}
            </button>
          );
        })}
        {proneFilter.size > 0 && (
          <button
            onClick={() => setProneFilter(new Set())}
            style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
          >
            Clear durability
          </button>
        )}
        {/* Age filter (2026-09-06, Rees's ask) -- plain min/max number
            inputs rather than chips, since age is a continuous range, not a
            small fixed set like H/P or Role. */}
        <span style={{ fontSize: 12 }}>Age</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="min"
          value={ageMin}
          onChange={(e) => setAgeMin(e.target.value)}
          style={{ width: 52, padding: "3px 6px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", color: "inherit" }}
        />
        <span style={{ fontSize: 12, color: "var(--color-text-muted, #888)" }}>–</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="max"
          value={ageMax}
          onChange={(e) => setAgeMax(e.target.value)}
          style={{ width: 52, padding: "3px 6px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", color: "inherit" }}
        />
        {(ageMin !== "" || ageMax !== "") && (
          <button
            onClick={() => { setAgeMin(""); setAgeMax(""); }}
            style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
          >
            Clear age
          </button>
        )}
        {/* Min Overall filter (2026-09-07, Rees's ask, for /rule5-draft's
            Draft Board -- generically available like Age, min-only per the
            actual ask). */}
        <span style={{ fontSize: 12 }}>Min Overall</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="min"
          value={overallMin}
          onChange={(e) => setOverallMin(e.target.value)}
          style={{ width: 52, padding: "3px 6px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", color: "inherit" }}
        />
        {overallMin !== "" && (
          <button
            onClick={() => setOverallMin("")}
            style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
          >
            Clear min Overall
          </button>
        )}
        {/* Demand filter (2026-09-09, Rees's ask) -- only where Demand
            itself is shown (showValueVsDemand); not a meaningful concept
            elsewhere. Entered in whole $M, matching fmtMoney's own display
            convention, converted to raw dollars at filter time. */}
        {showValueVsDemand && (
          <>
            <span style={{ fontSize: 12 }}>Demand ($M)</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="min"
              value={demandMinM}
              onChange={(e) => setDemandMinM(e.target.value)}
              style={{ width: 52, padding: "3px 6px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", color: "inherit" }}
            />
            <span style={{ fontSize: 12, color: "var(--color-text-muted, #888)" }}>–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="max"
              value={demandMaxM}
              onChange={(e) => setDemandMaxM(e.target.value)}
              style={{ width: 52, padding: "3px 6px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", color: "inherit" }}
            />
            {(demandMinM !== "" || demandMaxM !== "") && (
              <button
                onClick={() => { setDemandMinM(""); setDemandMaxM(""); }}
                style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
              >
                Clear demand
              </button>
            )}
          </>
        )}
        {/* Sign-only filter (2026-09-06, Rees's ask) -- only where the Sign
            column itself is shown; not a meaningful concept elsewhere. */}
        {showSign && (
          <button
            onClick={() => setSignOnly((v) => !v)}
            aria-pressed={signOnly}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              border: "1px solid var(--color-border-strong)",
              borderRadius: 4,
              background: signOnly ? "var(--color-navy)" : "transparent",
              color: signOnly ? "var(--color-text-on-navy)" : "inherit",
              cursor: "pointer",
            }}
          >
            ✓ Sign only
          </button>
        )}
        <span style={{ fontSize: 11, color: "var(--color-text-muted, #888)", marginLeft: "auto" }}>
          Grade color: <span style={{ color: "rgb(220,38,38)" }}>low</span> → <span style={{ color: "rgb(249,115,22)" }}>orange</span> → <span style={{ color: "rgb(180,150,10)" }}>yellow</span> → <span style={{ color: "rgb(34,197,94)" }}>green</span> → <span style={{ color: "rgb(56,189,248)" }}>elite</span>
        </span>
      </div>
      <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, marginTop: -6, marginBottom: 10 }}>
        {renderLimit && sortedRows.length > renderLimit
          ? `Top ${visibleRows.length} of ${sortedRows.length} matching your filters shown (${rows.length} total) — narrow the filters above to see fewer, more specific results.`
          : `${sortedRows.length} of ${rows.length} shown.`}{" "}
        Overall/Potential{showProspectCols ? "/Prospect Potential" : ""} at full precision — internal admin view, not public.
      </p>
      <div className="table-wrap">
        <table className="player-table">
          <thead>
            <tr>
              {th("Name", "name")}
              {th("Pos", "pos")}
              {th("Role", "role")}
              {showTeam && th("Team", "team")}
              {th("Age", "age")}
              {/* Durability (2026-09-09, Rees's ask) -- bio info, so grouped
                  with Age rather than off in the ratings columns. Gives the
                  new Injury Proneness filter something visible to look at. */}
              {th("Durability", "prone")}
              {/* Our analysis (computed output) first, then the underlying
                  raw ratings at the end (2026-09-04, Rees's ask) -- the
                  engine's own conclusions are what you scan first, the
                  ingredients are there to check if you want to dig in. */}
              {th("Overall", "overall")}
              {th("Potential", "potential")}
              {showStatLevel && <th style={{ whiteSpace: "normal", lineHeight: 1.2, maxWidth: "4.5rem" }} title="The level this AB/IP/WAR line was earned at -- two players can show the same WAR from very different levels">Level</th>}
              {showSign && th("Sign", "sign")}
              {th("AB", "ab")}
              {th("IP", "ip")}
              {th("WAR", "war")}
              {showValueVsDemand && (
                <>
                  {th("Demand (AAV)", "demand")}
                  {th("Fair Value", "fairValue")}
                  {th("Value Gap", "valueGap")}
                </>
              )}
              {showProspectCols && (
                <>
                  {th("Prospect Pot.", "prospect_potential")}
                  {th("Prospect Rank", "prospect_rank")}
                </>
              )}
              {th("Con/Stf", "contactStuff")}
              {th("Pow/Mov", "powerMovement")}
              {th("Eye/Ctrl", "eyeControl")}
              {th("Spd/Stm", "speedStamina")}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.player_id}>
                {/* StatsPlus profile link (2026-08-28, Rees's ask -- same
                    change made on the Minor League System page). New tab so
                    the table's sort/filter state isn't lost. */}
                <td style={{ whiteSpace: "nowrap" }}>
                  {/* Name links to our own player detail page (2026-08-29);
                      StatsPlus is a small separate "↗" link right after. */}
                  <Link href={`/${league}/players/${r.player_id}`} style={{ color: r.isInjured ? "rgb(220,38,38)" : "inherit" }}>{r.first_name} {r.last_name}</Link>
                  {/* Injury badge (2026-09-10, Rees's ask -- red name plus
                      injury length, "in a small, discreet way so it doesn't
                      add another wide column"). Compact text right next to
                      the name rather than a real column; hover for the full
                      status ("DL-60, 12 days left") via title. Only rendered
                      when actually injured -- a healthy player's row looks
                      exactly like it did before this. */}
                  {r.isInjured && (
                    <span title={r.injuryLabel} style={{ marginLeft: 4, fontSize: 10, color: "rgb(220,38,38)", opacity: 0.85 }}>
                      ({r.injuryBadge})
                    </span>
                  )}
                  <a href={statsPlusPlayerUrl(r.player_id)} target="_blank" rel="noopener noreferrer" title="View on StatsPlus" style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>↗</a>
                </td>
                <td>{r.pos ?? "—"}</td>
                <td>{r.role ?? "—"}</td>
                {/* team_abbr comes from team_batting_stats_snapshots, which
                    only covers MLB-level teams (2026-09-07 finding, on the
                    Rule 5 page -- almost every row there is a minor-league
                    affiliate player, the first page to make this gap this
                    visible). team_nickname (from the `teams` table itself)
                    is always populated regardless of level, so it's a real
                    fallback, not a guess -- e.g. "Bulls" for an AAA
                    affiliate with no MLB-only abbreviation on file. */}
                {showTeam && <td>{r.team_abbr ?? r.team_nickname ?? "—"}</td>}
                <td>{r.age ?? "—"}</td>
                <td style={r.prone ? { color: PRONE_COLORS[r.prone] } : undefined}>{r.prone ?? "—"}</td>
                <td style={gradeStyle(r.overall)}>{fmt1(r.overall)}</td>
                <td style={gradeStyle(r.potential)}>{fmt1(r.potential)}</td>
                {showStatLevel && <td>{r.statLevel ?? "—"}</td>}
                {showSign && (
                  <td style={r.signFlag ? { color: "rgb(34,197,94)", fontWeight: 700 } : undefined} title={r.signFlag === null ? "Not enough data to evaluate (no real stat-based level on file)" : r.signFlag ? "Would improve OKC's system at this role/level" : "Would not improve OKC's system at this role/level"}>
                    {r.signFlag === true ? "✓ " : ""}{r.suggestedSignLevel ?? "—"}
                  </td>
                )}
                <td>{fmtInt(r.ab)}</td>
                <td>{fmt1(r.ip)}</td>
                <td>{fmt1(r.war)}</td>
                {showValueVsDemand && (
                  <>
                    <td>{fmtMoney(r.demandSalary)}</td>
                    <td>{fmtMoney(r.fairValueAav)}</td>
                    <td style={valueGapStyle(r.valueGapPct)}>{r.valueGapPct === null ? "—" : `${r.valueGapPct > 0 ? "+" : ""}${r.valueGapPct.toFixed(0)}%`}</td>
                  </>
                )}
                {showProspectCols && (
                  <>
                    <td style={gradeStyle(r.prospect_potential)}>{fmt1(r.prospect_potential)}</td>
                    <td>{r.prospect_rank ?? "—"}</td>
                  </>
                )}
                <td style={gradeStyle(combined(r, r.cntct, r.stf))}>{fmtInt(combined(r, r.cntct, r.stf))}</td>
                <td style={gradeStyle(combined(r, r.pow, r.mov))}>{fmtInt(combined(r, r.pow, r.mov))}</td>
                <td style={gradeStyle(combined(r, r.eye, r.ctrl))}>{fmtInt(combined(r, r.eye, r.ctrl))}</td>
                <td style={gradeStyle(combined(r, r.speed, r.stm))}>{fmtInt(combined(r, r.speed, r.stm))}</td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty-state">No players match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
