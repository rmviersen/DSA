"use client";

import { useMemo, useState } from "react";
import type { MinorsPlayerRow, TeamPositionCounts, RoleHealthRow } from "@/lib/org-minors-query";
// gradeStyle/percentileStyle/statsPlusPlayerUrl: pure, no-Supabase-dependency
// helpers, live in display-helpers.ts specifically so a "use client"
// component can safely import them as values (gotcha 16 -- importing a
// value from org-minors-query.ts here would bundle its whole Supabase-client
// chain into the browser).
import { gradeStyle, percentileStyle, statsPlusPlayerUrl } from "@/lib/display-helpers";

type SortKey = "name" | "team" | "level" | "age" | "pos" | "role" | "overall" | "potential" | "ab" | "ip" | "war" | "flag";

const LEVEL_ORDER: Record<string, number> = { MLB: 0, AAA: 1, AA: 2, "A+": 3, "A-": 4, Rookie: 5 };

// Canonical role order (2026-08-28, Rees's spec) -- used for the role
// filter buttons, the roster tables' Role column sort, AND the RAG table's
// row order below (the RAG table interleaves its two aggregate rows into
// this same sequence -- see ROLE_HEALTH_ROWS in org-minors-query.ts).
const ROLE_FILTER_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "CF", "COF", "DH"];

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

  // Role Health is stored role-major (roleHealth[i].byLevel[levelIdx]) --
  // 2026-08-28's card redesign needs it level-major instead (one card per
  // level, roles as rows within), so transpose it here rather than reshape
  // the query layer, which other code doesn't need transposed.
  const levelCards = useMemo(() => {
    if (roleHealth.length === 0) return [];
    return roleHealth[0].byLevel.map((_, levelIdx) => ({
      levelLabel: roleHealth[0].byLevel[levelIdx].levelLabel,
      byRole: roleHealth.map((row) => ({ label: row.label, cell: row.byLevel[levelIdx] })),
    }));
  }, [roleHealth]);

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

      {/* Role-health RAG cards (rebuilt 2026-08-28 from a single wide table
          into one card per level -- Rees's call, the table read as too
          heavy). Cnt = healthy headcount (DTD always counts; a player on a
          DL counts only if back within 7 days; injured-and-excluded shown in
          parens), graded against the role's staffing minimum. Org/Lg = each
          team's own top-N Overall average at that role/level (N = expected
          playing-time slots, e.g. top 5 for SP) -- Org is Oklahoma City's
          number, Lg is that number averaged across every team in the
          league. Rank is Oklahoma City's position among every team's Org
          number, best-first. Cnt/Org/Rank are all graded on the same 5-color
          gradient used for Overall grades elsewhere on the site (red ->
          orange -> yellow -> green -> blue); Lg is shown plain, it's the
          yardstick Org and Rank get graded against, not a thing to grade
          itself. */}
      <h2 style={{ fontSize: 14, marginBottom: 6 }}>Role health by level</h2>
      <p style={{ color: "var(--color-text-muted, #888)", marginTop: 0, marginBottom: 10, fontSize: 11 }}>
        Cnt = healthy headcount vs. the role&rsquo;s staffing minimum (injured-and-excluded shown in parens). Org/Lg = top-N Overall average
        (N = expected playing-time slots) for Oklahoma City vs. the leaguewide average of every team&rsquo;s own number. Rank = Oklahoma
        City&rsquo;s position among all teams&rsquo; Org numbers, best-first. Cnt/Org/Rank colored red&rarr;orange&rarr;yellow&rarr;green&rarr;blue, worst to best.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 16 }}>
        {levelCards.map((card) => (
          <div
            key={card.levelLabel}
            style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}
          >
            <div style={{ padding: "6px 8px", fontWeight: 600, fontSize: 12, background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>
              {card.levelLabel}
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ padding: "3px 6px", textAlign: "left", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>Role</th>
                  <th style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>Cnt</th>
                  <th style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>Org</th>
                  <th style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>Lg</th>
                  <th style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>Rank</th>
                </tr>
              </thead>
              <tbody>
                {card.byRole.map(({ label, cell }) => (
                  <tr key={label}>
                    <td style={{ padding: "3px 6px", borderBottom: "1px solid var(--color-border)", fontWeight: label.includes("Total") ? 600 : 400, whiteSpace: "nowrap" }}>{label}</td>
                    <td style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", ...percentileStyle(cell.countPct) }} title={cell.min > 0 ? `Minimum ${cell.min}` : undefined}>
                      {cell.count}
                      {/* Injured count in parens -- players in this role/level
                          who exist but aren't counted (hurt, not back within
                          7 days), so a low-graded cell reads as "actually
                          short" vs. "fine on paper, just hurt right now." */}
                      {cell.injuredCount > 0 && (
                        <span style={{ fontWeight: 400, color: "var(--color-text-muted, #888)" }}> ({cell.injuredCount})</span>
                      )}
                    </td>
                    <td style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", ...percentileStyle(cell.avgPct) }} title={cell.leagueAvg !== null ? `League average: ${fmt1(cell.leagueAvg)}` : undefined}>
                      {fmt1(cell.orgAvg)}
                    </td>
                    <td style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted, #888)" }}>
                      {fmt1(cell.leagueAvg)}
                    </td>
                    <td
                      style={{ padding: "3px 6px", textAlign: "right", borderBottom: "1px solid var(--color-border)", ...percentileStyle(cell.rankPct) }}
                      title={cell.totalTeams !== null ? `Rank among ${cell.totalTeams} teams with a player at this role/level` : undefined}
                    >
                      {cell.rank !== null && cell.totalTeams !== null ? `${cell.rank}/${cell.totalTeams}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
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
        Sort/filter controls above apply to every team box. Flag: ▲ promote (current Overall already clears the level above's own average -- ready to contribute there, not just better than average here), ▼ demote (current Overall is below the midpoint between this level's average and the level below's) -- both against leaguewide Role × Level Overall benchmarks, not a scouted recommendation. ✚ marks a player who won't be healthy within 7 days.
      </p>
    </div>
  );
}
