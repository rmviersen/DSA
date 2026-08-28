"use client";

import { Fragment, useMemo, useState } from "react";
import type { MinorsPlayerRow, TeamPositionCounts, RoleHealthRow } from "@/lib/org-minors-query";
// gradeStyle/statsPlusPlayerUrl: pure, no-Supabase-dependency helpers, live
// in display-helpers.ts specifically so a "use client" component can safely
// import them as values (gotcha 16 -- importing a value from org-minors-
// query.ts here would bundle its whole Supabase-client chain into the browser).
import { gradeStyle, statsPlusPlayerUrl } from "@/lib/display-helpers";

type SortKey = "name" | "team" | "level" | "age" | "pos" | "role" | "overall" | "potential" | "ab" | "ip" | "war" | "flag";

const LEVEL_ORDER: Record<string, number> = { MLB: 0, AAA: 1, AA: 2, "A+": 3, "A-": 4, Rookie: 5 };

// Canonical role order (2026-08-28, Rees's spec) -- used for the role
// filter buttons, the roster tables' Role column sort, AND the RAG table's
// row order below (the RAG table interleaves its two aggregate rows into
// this same sequence -- see ROLE_HEALTH_ROWS in org-minors-query.ts).
const ROLE_FILTER_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "CF", "COF", "DH"];

const RAG_COLOR: Record<RoleHealthRow["byLevel"][number]["status"], string> = {
  red: "#c0392b",
  amber: "#b4960a",
  green: "#3a7d44",
  none: "transparent",
};

function fmt1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}
function fmt0(n: number | null): string {
  return n === null ? "—" : Math.round(n).toLocaleString();
}

export default function MinorsTable({ rows, teamCounts, roleHealth }: { rows: MinorsPlayerRow[]; teamCounts: TeamPositionCounts[]; roleHealth: RoleHealthRow[] }) {
  const [filter, setFilter] = useState<"all" | "H" | "P">("all");
  // Multi-select role filter, same pattern as PlayerTable.tsx/ProspectTable.tsx
  // (2026-08-28, Rees's ask -- clickable role buttons instead of a dropdown).
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("potential");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handlePhFilter(f: "all" | "H" | "P") {
    setFilter(f);
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

  const phFiltered = useMemo(() => rows.filter((r) => filter === "all" || r.ph === filter), [rows, filter]);

  // Role options derived from the current H/P-filtered set, same pattern as
  // PlayerTable/ProspectTable -- switching to Pitchers only ever offers SP/RP.
  const roleOptions = useMemo(() => {
    const present = new Set(phFiltered.map((r) => r.role).filter((r): r is string => !!r));
    return ROLE_FILTER_ORDER.filter((role) => present.has(role));
  }, [phFiltered]);

  const filtered = useMemo(
    () => (roleFilter.size === 0 ? phFiltered : phFiltered.filter((r) => r.role !== null && roleFilter.has(r.role))),
    [phFiltered, roleFilter]
  );

  const sorted = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (sortKey) {
        case "name": av = `${a.last_name}, ${a.first_name}`; bv = `${b.last_name}, ${b.first_name}`; break;
        case "team": av = a.team_nickname ?? ""; bv = b.team_nickname ?? ""; break;
        case "level": av = LEVEL_ORDER[a.levelLabel] ?? 9; bv = LEVEL_ORDER[b.levelLabel] ?? 9; break;
        case "age": av = a.age ?? -1; bv = b.age ?? -1; break;
        case "pos": av = a.pos ?? ""; bv = b.pos ?? ""; break;
        // Fixed role order (same as the RAG table/filter buttons above), not
        // alphabetical -- 2026-08-28, Rees's ask. Missing role sorts last
        // regardless of direction.
        case "role": av = a.role ? ROLE_FILTER_ORDER.indexOf(a.role) : 999; bv = b.role ? ROLE_FILTER_ORDER.indexOf(b.role) : 999; break;
        case "overall": av = a.overall ?? -1; bv = b.overall ?? -1; break;
        case "potential": av = a.potential ?? -1; bv = b.potential ?? -1; break;
        case "ab": av = a.ab ?? -1; bv = b.ab ?? -1; break;
        case "ip": av = a.ip ?? -1; bv = b.ip ?? -1; break;
        case "war": av = a.war ?? -99; bv = b.war ?? -99; break;
        case "flag": av = a.levelFlag ? 1 : 0; bv = b.levelFlag ? 1 : 0; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  // One independently-scrollable box per team. Grouping preserves the
  // already-applied global sort order within each team's list.
  const byTeam = useMemo(() => {
    const groups = new Map<number, MinorsPlayerRow[]>();
    for (const r of sorted) {
      if (r.team_id === null) continue;
      const arr = groups.get(r.team_id) ?? [];
      arr.push(r);
      groups.set(r.team_id, arr);
    }
    // Order teams the same way the position-counts table does (by level).
    return teamCounts
      .filter((t) => groups.has(t.team_id))
      .map((t) => ({ team: t, players: groups.get(t.team_id)! }));
  }, [sorted, teamCounts]);

  const th = (label: string, key: SortKey) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ cursor: "pointer", userSelect: "none", padding: "4px 8px", textAlign: "left", borderBottom: "2px solid var(--color-tan)", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}
    >
      {label}{sortKey === key ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );

  return (
    // "org-minors-page" marker class -- picked up by a `.site-main:has(...)`
    // rule in globals.css that widens just this page's shared max-width
    // (2026-08-28, Rees's ask: this page's tables need more room than the
    // site's normal 1200px content width). No effect on any other page.
    <div className="org-minors-page" style={{ fontFamily: "var(--font-body), system-ui, sans-serif", padding: "16px 24px", fontSize: 13 }}>
      <h1 style={{ marginBottom: 4, fontSize: 22 }}>Minor League System</h1>
      <p style={{ color: "var(--color-text-muted, #888)", marginTop: 0, marginBottom: 12, fontSize: 12 }}>
        {rows.length} players. Overall/Potential shown at full precision (this is your own org, not public).
      </p>

      {/* Role-health RAG table (2026-08-28, Rees's spec) -- healthy-only
          counts (DTD always counts; a player on a DL counts only if back
          within 7 days) by ROLE, per level, against fixed staffing minimums:
          13 pitchers / 5 of them SP, 2 catchers, 1 SS, 1 CF, 3 INF, 3 COF
          per level -- 1B/DH have no minimum, shown plain. Red = below
          minimum, amber = exactly at it (compliant but no depth), green =
          above it. */}
      <h2 style={{ fontSize: 14, marginBottom: 6 }}>Role health by level</h2>
      <p style={{ color: "var(--color-text-muted, #888)", marginTop: 0, marginBottom: 6, fontSize: 11 }}>
        Cnt = healthy headcount (injured-not-back-within-7-days shown in parens), graded against the role's staffing minimum.
        Lg/Org = average of each team's own top-N Overall at that role/level (N = expected playing-time slots, e.g. top 5 for SP) --
        Lg averages that number across every team in the league, Org is Oklahoma City's own number, graded against Lg (green +1 or above, red under -1).
      </p>
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ padding: "3px 8px", textAlign: "left", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)", verticalAlign: "bottom" }}>Role</th>
              {roleHealth[0]?.byLevel.map((c) => (
                <th key={c.level} colSpan={3} style={{ padding: "3px 8px", textAlign: "center", borderBottom: "1px solid var(--color-border)", borderLeft: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>{c.levelLabel}</th>
              ))}
            </tr>
            <tr>
              {roleHealth[0]?.byLevel.map((c) => (
                <Fragment key={c.level}>
                  <th style={{ padding: "2px 6px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", borderLeft: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy-muted)", fontWeight: 500 }}>Cnt</th>
                  <th style={{ padding: "2px 6px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy-muted)", fontWeight: 500 }}>Lg</th>
                  <th style={{ padding: "2px 6px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy-muted)", fontWeight: 500 }}>Org</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {roleHealth.map((row) => (
              <tr key={row.label}>
                <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border)", fontWeight: row.label.includes("Total") ? 600 : 400 }}>{row.label}</td>
                {row.byLevel.map((c) => (
                  <Fragment key={c.level}>
                    <td
                      style={{
                        padding: "3px 6px",
                        textAlign: "right",
                        borderBottom: "1px solid var(--color-border)",
                        borderLeft: "2px solid var(--color-tan)",
                        fontWeight: c.status === "none" ? 400 : 700,
                        // Font color carries the RAG signal (2026-08-28,
                        // Rees's ask) -- a background fill looked bad against
                        // the table's existing striping/borders. No color at
                        // all for "none" rows (RP -- no minimum to grade).
                        color: c.status === "none" ? undefined : RAG_COLOR[c.status],
                      }}
                      title={c.min > 0 ? `Minimum ${c.min}` : undefined}
                    >
                      {c.count}
                      {/* Injured count in parens (2026-08-28) -- players in
                          this role/level who exist but aren't counted above
                          (hurt, not back within 7 days), so a red/amber cell
                          reads as "actually short" vs. "fine on paper, just
                          hurt right now." Omitted entirely at 0, not "(0)". */}
                      {c.injuredCount > 0 && (
                        <span style={{ fontWeight: 400, color: "var(--color-text-muted, #888)" }}> ({c.injuredCount})</span>
                      )}
                    </td>
                    {/* Leaguewide average -- plain reference number, not
                        RAG-colored itself (2026-08-28) -- there's nothing to
                        grade about the league's own number, it's the
                        yardstick the Org column gets graded against. */}
                    <td style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted, #888)" }}>
                      {fmt1(c.leagueAvg)}
                    </td>
                    <td
                      style={{
                        padding: "3px 6px",
                        textAlign: "right",
                        borderBottom: "1px solid var(--color-border)",
                        fontWeight: c.avgStatus === "none" ? 400 : 700,
                        color: c.avgStatus === "none" ? undefined : RAG_COLOR[c.avgStatus],
                      }}
                      title={c.leagueAvg !== null ? `League average: ${fmt1(c.leagueAvg)}` : undefined}
                    >
                      {fmt1(c.orgAvg)}
                    </td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {(["all", "H", "P"] as const).map((f) => (
          <button
            key={f}
            onClick={() => handlePhFilter(f)}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              border: "1px solid var(--color-border-strong)",
              borderRadius: 4,
              background: filter === f ? "var(--color-navy)" : "transparent",
              color: filter === f ? "var(--color-text-on-navy)" : "inherit",
              cursor: "pointer",
            }}
          >
            {f === "all" ? "All" : f === "H" ? "Hitters" : "Pitchers"}
          </button>
        ))}
        {/* Role filter (2026-08-28) -- clickable buttons, not a dropdown, same
            multi-select pattern as PlayerTable/ProspectTable's Role filter.
            Applies across every team box below, same as the H/P filter. */}
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
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
        }}
      >
        {byTeam.map(({ team, players }) => (
          <div
            key={team.team_id}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-sm)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "6px 8px",
                fontWeight: 600,
                fontSize: 12,
                background: "var(--color-navy, #002030)",
                color: "var(--color-text-on-navy, #fff)",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{team.team_nickname} ({team.levelLabel})</span>
              <span style={{ opacity: 0.8, fontWeight: 400 }}>{players.length}</span>
            </div>
            {/* Independent scroll region per team -- scrolling one team's
                roster never affects any other team's box. */}
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                <thead>
                  <tr>
                    {th("Player", "name")}
                    {th("Age", "age")}
                    {th("Role", "role")}
                    {th("Pos", "pos")}
                    {th("Ovr", "overall")}
                    {th("Pot", "potential")}
                    {th("AB", "ab")}
                    {th("IP", "ip")}
                    {th("WAR", "war")}
                    {th("Flag", "flag")}
                  </tr>
                </thead>
                <tbody>
                  {players.map((r) => (
                    <tr key={r.player_id}>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)", whiteSpace: "nowrap" }}>
                        {/* StatsPlus profile link (2026-08-28, Rees's ask --
                            same change made to /players). Opens in a new tab
                            so the roster view isn't lost. */}
                        <a href={statsPlusPlayerUrl(r.player_id)} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                          {r.first_name} {r.last_name}
                        </a>
                        {!r.available && <span title="Injured, not back within 7 days" style={{ marginLeft: 4, color: "#c0392b" }}>✚</span>}
                      </td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{r.age ?? "—"}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{r.role ?? "—"}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{r.pos ?? "—"}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)", ...gradeStyle(r.overall) }}>{fmt1(r.overall)}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)", ...gradeStyle(r.potential) }}>{fmt1(r.potential)}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{fmt0(r.ab)}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{fmt0(r.ip)}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{fmt1(r.war)}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>
                        {r.levelFlag === "promote" ? <span style={{ color: "#3a7d44", fontWeight: 700 }}>▲</span> : r.levelFlag === "demote" ? <span style={{ color: "#c0392b", fontWeight: 700 }}>▼</span> : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--color-text-muted, #888)", fontSize: 11, marginTop: 10 }}>
        Sort/filter controls above apply to every team box. Flag: ▲ promote (current Overall already clears the role's average for the level above), ▼ demote (current Overall is below the role's own average for their current level) -- both against leaguewide Role × Level Overall benchmarks, not a scouted recommendation. ✚ marks a player who won't be healthy within 7 days.
      </p>
    </div>
  );
}
