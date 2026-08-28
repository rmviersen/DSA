"use client";

import { useMemo, useState } from "react";
import type { MinorsPlayerRow, TeamPositionCounts, RoleHealthRow } from "@/lib/org-minors-query";
// gradeStyle/statsPlusPlayerUrl: pure, no-Supabase-dependency helpers, live
// in display-helpers.ts specifically so a "use client" component can safely
// import them as values (gotcha 16 -- importing a value from org-minors-
// query.ts here would bundle its whole Supabase-client chain into the browser).
import { gradeStyle, statsPlusPlayerUrl } from "@/lib/display-helpers";

type SortKey = "name" | "team" | "level" | "age" | "pos" | "role" | "overall" | "potential" | "ab" | "ip" | "war" | "flag";

const LEVEL_ORDER: Record<string, number> = { MLB: 0, AAA: 1, AA: 2, "A+": 3, "A-": 4, Rookie: 5 };

// All roles that can appear, in the same order as the RAG table above it --
// used for both the role filter's option order and (loosely) sort tie-break.
const ROLE_FILTER_ORDER = ["SP", "RP", "C", "SS", "CF", "INF", "COF", "1B", "DH"];

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
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("potential");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(
    () => rows.filter((r) => (filter === "all" || r.ph === filter) && (roleFilter === "all" || r.role === roleFilter)),
    [rows, filter, roleFilter]
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
        case "role": av = a.role ?? ""; bv = b.role ?? ""; break;
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

  const allPositions = useMemo(() => {
    const s = new Set<string>();
    teamCounts.forEach((t) => Object.keys(t.counts).forEach((p) => s.add(p)));
    return [...s].sort();
  }, [teamCounts]);

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
    <div style={{ fontFamily: "var(--font-body), system-ui, sans-serif", padding: "16px 40px", fontSize: 13 }}>
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
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ padding: "3px 8px", textAlign: "left", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>Role</th>
              {roleHealth[0]?.byLevel.map((c) => (
                <th key={c.level} style={{ padding: "3px 8px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>{c.levelLabel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roleHealth.map((row) => (
              <tr key={row.label}>
                <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border)" }}>{row.label}</td>
                {row.byLevel.map((c) => (
                  <td
                    key={c.level}
                    style={{
                      padding: "3px 8px",
                      textAlign: "right",
                      borderBottom: "1px solid var(--color-border)",
                      fontWeight: c.status === "none" ? 400 : 700,
                      color: c.status === "none" ? undefined : "#fff",
                      background: c.status === "none" ? undefined : RAG_COLOR[c.status],
                    }}
                    title={c.min > 0 ? `Minimum ${c.min}` : undefined}
                  >
                    {c.count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 14, marginBottom: 6 }}>Position counts by team</h2>
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ padding: "3px 8px", textAlign: "left", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>Team (Level)</th>
              {allPositions.map((p) => (
                <th key={p} style={{ padding: "3px 8px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>{p}</th>
              ))}
              <th style={{ padding: "3px 8px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {teamCounts.map((t) => {
              const total = Object.values(t.counts).reduce((a, b) => a + b, 0);
              return (
                <tr key={t.team_id}>
                  <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border)" }}>{t.team_nickname} ({t.levelLabel})</td>
                  {allPositions.map((p) => (
                    <td key={p} style={{ padding: "3px 8px", textAlign: "right", borderBottom: "1px solid var(--color-border)" }}>{t.counts[p] ?? ""}</td>
                  ))}
                  <td style={{ padding: "3px 8px", textAlign: "right", borderBottom: "1px solid var(--color-border)", fontWeight: 600 }}>{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {(["all", "H", "P"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
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
        {/* Role filter (2026-08-28) -- applies across every team box below,
            same as the existing H/P filter. */}
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{ padding: "3px 8px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "var(--color-surface)", color: "inherit" }}
        >
          <option value="all">All roles</option>
          {ROLE_FILTER_ORDER.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "var(--color-text-muted, #888)", marginLeft: 8 }}>
          Ovr/Pot color: <span style={{ color: "rgb(220,38,38)" }}>low</span> → <span style={{ color: "rgb(249,115,22)" }}>orange</span> → <span style={{ color: "rgb(180,150,10)" }}>yellow</span> → <span style={{ color: "rgb(34,197,94)" }}>green</span> → <span style={{ color: "rgb(56,189,248)" }}>elite</span>
        </span>
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
