"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  | "demand" | "fairValue" | "valueGap";

// r.ph is "H" for a hitter, "P" for a pitcher (null is not expected in
// practice but falls back to the hitter side, matching every other
// nullable-ph default in this component).
const combined = (r: PlayerRow, hitterVal: number | null, pitcherVal: number | null) => (r.ph === "P" ? pitcherVal : hitterVal);

export function PlayerTable({ rows, showTeam, showProspectCols, showStatLevel, showValueVsDemand }: { rows: PlayerRow[]; showTeam: boolean; showProspectCols: boolean; showStatLevel?: boolean; showValueVsDemand?: boolean }) {
  const [phFilter, setPhFilter] = useState<"all" | "H" | "P">("all");
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
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

  // Multi-select: empty set = no role filter applied.
  const filteredRows = useMemo(
    () => (roleFilter.size === 0 ? phFiltered : phFiltered.filter((r) => r.role !== null && roleFilter.has(r.role))),
    [phFiltered, roleFilter]
  );

  const sortedRows = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    return [...filteredRows].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (sortKey) {
        case "name": av = `${a.last_name}, ${a.first_name}`; bv = `${b.last_name}, ${b.first_name}`; break;
        case "pos": av = a.pos ?? ""; bv = b.pos ?? ""; break;
        case "role": av = a.role ?? ""; bv = b.role ?? ""; break;
        case "team": av = a.team_abbr ?? ""; bv = b.team_abbr ?? ""; break;
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
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filteredRows, sortKey, sortDir]);

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

  // Base 13: Name/Pos/Role/Age/Overall/Potential/AB/IP/WAR + the 4 combined
  // grade columns. Fixed 2026-09-04 to actually account for showStatLevel/
  // showValueVsDemand -- previously hardcoded at a stale 15 that predated
  // both those props, so the empty-state row's colSpan silently under- or
  // over-counted (a cosmetic miss: the "No players match" message just
  // wouldn't span the real table width in those cases).
  const colCount = 13 + (showTeam ? 1 : 0) + (showStatLevel ? 1 : 0) + (showValueVsDemand ? 3 : 0) + (showProspectCols ? 2 : 0);

  return (
    <div>
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
        <span style={{ fontSize: 11, color: "var(--color-text-muted, #888)", marginLeft: "auto" }}>
          Grade color: <span style={{ color: "rgb(220,38,38)" }}>low</span> → <span style={{ color: "rgb(249,115,22)" }}>orange</span> → <span style={{ color: "rgb(180,150,10)" }}>yellow</span> → <span style={{ color: "rgb(34,197,94)" }}>green</span> → <span style={{ color: "rgb(56,189,248)" }}>elite</span>
        </span>
      </div>
      <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, marginTop: -6, marginBottom: 10 }}>
        {sortedRows.length} of {rows.length} shown. Overall/Potential{showProspectCols ? "/Prospect Potential" : ""} at full precision — internal admin view, not public.
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
              {/* Our analysis (computed output) first, then the underlying
                  raw ratings at the end (2026-09-04, Rees's ask) -- the
                  engine's own conclusions are what you scan first, the
                  ingredients are there to check if you want to dig in. */}
              {th("Overall", "overall")}
              {th("Potential", "potential")}
              {showStatLevel && <th style={{ whiteSpace: "normal", lineHeight: 1.2, maxWidth: "4.5rem" }} title="The level this AB/IP/WAR line was earned at -- two players can show the same WAR from very different levels">Level</th>}
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
            {sortedRows.map((r) => (
              <tr key={r.player_id}>
                {/* StatsPlus profile link (2026-08-28, Rees's ask -- same
                    change made on the Minor League System page). New tab so
                    the table's sort/filter state isn't lost. */}
                <td style={{ whiteSpace: "nowrap" }}>
                  {/* Name links to our own player detail page (2026-08-29);
                      StatsPlus is a small separate "↗" link right after. */}
                  <Link href={`/players/${r.player_id}`} style={{ color: "inherit" }}>{r.first_name} {r.last_name}</Link>
                  <a href={statsPlusPlayerUrl(r.player_id)} target="_blank" rel="noopener noreferrer" title="View on StatsPlus" style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>↗</a>
                </td>
                <td>{r.pos ?? "—"}</td>
                <td>{r.role ?? "—"}</td>
                {showTeam && <td>{r.team_abbr ?? "—"}</td>}
                <td>{r.age ?? "—"}</td>
                <td style={gradeStyle(r.overall)}>{fmt1(r.overall)}</td>
                <td style={gradeStyle(r.potential)}>{fmt1(r.potential)}</td>
                {showStatLevel && <td>{r.statLevel ?? "—"}</td>}
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
