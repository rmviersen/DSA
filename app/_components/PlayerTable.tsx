"use client";

import { useMemo, useState } from "react";
import type { PlayerRow } from "../../lib/queries";
// Import from display-helpers directly, NOT queries.ts -- queries.ts also
// creates a Supabase client at module scope using server-only secrets, which
// would crash the browser bundle if a "use client" component pulled in even
// one unrelated value export from that file. See display-helpers.ts's top
// comment (and ProspectTable.tsx, which hit this for real first).
import { gradeStyle, statsPlusPlayerUrl } from "../../lib/display-helpers";

// Raw/full precision throughout (2026-08-27, Rees's spec) -- both /players
// and /draft (the two pages sharing this component) are admin-only, not on
// the public site (see middleware.ts's GUEST_ALLOWED_PATHS), so the
// nearest-5 public rounding rule (roundGrade, see display-helpers.ts) does
// NOT apply here -- same reasoning /org-minors already uses for its own org.
const fmt1 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(1));
const fmtInt = (n: number | null) => (n === null || n === undefined ? "—" : Math.round(n));

// Same fixed display order as ProspectTable's Role filter (2026-08-20 spec) --
// roughly pitchers first, then hitter roles by defensive spectrum.
const ROLE_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "COF", "CF", "DH"];

type SortKey =
  | "name" | "pos" | "team" | "age"
  | "cntct" | "pow" | "eye" | "speed" | "stf" | "mov" | "ctrl" | "stm"
  | "overall" | "potential" | "ab" | "ip" | "war" | "prospect_potential" | "prospect_rank";

export function PlayerTable({ rows, showTeam, showProspectCols }: { rows: PlayerRow[]; showTeam: boolean; showProspectCols: boolean }) {
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
        case "team": av = a.team_nickname ?? ""; bv = b.team_nickname ?? ""; break;
        case "age": av = a.age ?? -1; bv = b.age ?? -1; break;
        case "cntct": av = a.cntct ?? -1; bv = b.cntct ?? -1; break;
        case "pow": av = a.pow ?? -1; bv = b.pow ?? -1; break;
        case "eye": av = a.eye ?? -1; bv = b.eye ?? -1; break;
        case "speed": av = a.speed ?? -1; bv = b.speed ?? -1; break;
        case "stf": av = a.stf ?? -1; bv = b.stf ?? -1; break;
        case "mov": av = a.mov ?? -1; bv = b.mov ?? -1; break;
        case "ctrl": av = a.ctrl ?? -1; bv = b.ctrl ?? -1; break;
        case "stm": av = a.stm ?? -1; bv = b.stm ?? -1; break;
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
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filteredRows, sortKey, sortDir]);

  const th = (label: string, key: SortKey) => (
    <th onClick={() => toggleSort(key)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      {label}{sortKey === key ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );

  const colCount = 14 + (showTeam ? 1 : 0) + (showProspectCols ? 2 : 0);

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
        <table>
          <thead>
            <tr>
              {th("Name", "name")}
              {th("Pos", "pos")}
              {showTeam && th("Team", "team")}
              {th("Age", "age")}
              {th("Cntct", "cntct")}
              {th("Pow", "pow")}
              {th("Eye", "eye")}
              {th("Spd", "speed")}
              {th("Stf", "stf")}
              {th("Mov", "mov")}
              {th("Ctrl", "ctrl")}
              {th("Stm", "stm")}
              {th("Overall", "overall")}
              {th("Potential", "potential")}
              {th("AB", "ab")}
              {th("IP", "ip")}
              {th("WAR", "war")}
              {showProspectCols && (
                <>
                  {th("Prospect Pot.", "prospect_potential")}
                  {th("Prospect Rank", "prospect_rank")}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.player_id}>
                {/* StatsPlus profile link (2026-08-28, Rees's ask -- same
                    change made on the Minor League System page). New tab so
                    the table's sort/filter state isn't lost. */}
                <td><a href={statsPlusPlayerUrl(r.player_id)} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{r.first_name} {r.last_name}</a></td>
                <td>{r.pos ?? "—"}</td>
                {showTeam && <td>{r.team_name ? `${r.team_name} ${r.team_nickname}` : "—"}</td>}
                <td>{r.age ?? "—"}</td>
                <td style={gradeStyle(r.cntct)}>{fmtInt(r.cntct)}</td>
                <td style={gradeStyle(r.pow)}>{fmtInt(r.pow)}</td>
                <td style={gradeStyle(r.eye)}>{fmtInt(r.eye)}</td>
                <td style={gradeStyle(r.speed)}>{fmtInt(r.speed)}</td>
                <td style={gradeStyle(r.stf)}>{fmtInt(r.stf)}</td>
                <td style={gradeStyle(r.mov)}>{fmtInt(r.mov)}</td>
                <td style={gradeStyle(r.ctrl)}>{fmtInt(r.ctrl)}</td>
                <td style={gradeStyle(r.stm)}>{fmtInt(r.stm)}</td>
                <td style={gradeStyle(r.overall)}>{fmt1(r.overall)}</td>
                <td style={gradeStyle(r.potential)}>{fmt1(r.potential)}</td>
                <td>{fmtInt(r.ab)}</td>
                <td>{fmt1(r.ip)}</td>
                <td>{fmt1(r.war)}</td>
                {showProspectCols && (
                  <>
                    <td style={gradeStyle(r.prospect_potential)}>{fmt1(r.prospect_potential)}</td>
                    <td>{r.prospect_rank ?? "—"}</td>
                  </>
                )}
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
