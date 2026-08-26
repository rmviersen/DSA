"use client";

import { useMemo, useState } from "react";
import type { MinorsPlayerRow, TeamPositionCounts } from "@/lib/org-minors-query";

type SortKey = "name" | "team" | "level" | "age" | "pos" | "overall" | "potential" | "promote";

const LEVEL_ORDER: Record<string, number> = { MLB: 0, AAA: 1, AA: 2, "A+": 3, "A-": 4, Rookie: 5 };

function fmt1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

// Grade-color gradient, low to high: red -> orange -> yellow -> green -> light
// blue (elite). Stops chosen to match real scouting-scale meaning (50 = MLB
// average, 65 = plus/above-average, 80 = elite/generational), not a naive
// min/max stretch of whatever's in the data this run.
const GRADIENT_STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 20, rgb: [220, 38, 38] },   // red
  { at: 40, rgb: [249, 115, 22] },  // orange
  { at: 50, rgb: [234, 179, 8] },   // yellow
  { at: 65, rgb: [34, 197, 94] },   // green
  { at: 80, rgb: [56, 189, 248] },  // light blue
];

function gradeStyle(v: number | null): { color: string; fontWeight: number } | undefined {
  if (v === null) return undefined;
  const stops = GRADIENT_STOPS;
  let rgb: [number, number, number];
  if (v <= stops[0].at) rgb = stops[0].rgb;
  else if (v >= stops[stops.length - 1].at) rgb = stops[stops.length - 1].rgb;
  else {
    let i = 0;
    while (i < stops.length - 2 && v > stops[i + 1].at) i++;
    const a = stops[i], b = stops[i + 1];
    const t = (v - a.at) / (b.at - a.at);
    rgb = [
      a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
      a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
      a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
    ];
  }
  const [r, g, b] = rgb.map(Math.round);
  return { color: `rgb(${r},${g},${b})`, fontWeight: 700 };
}

export default function MinorsTable({ rows, teamCounts }: { rows: MinorsPlayerRow[]; teamCounts: TeamPositionCounts[] }) {
  const [filter, setFilter] = useState<"all" | "H" | "P">("all");
  const [sortKey, setSortKey] = useState<SortKey>("potential");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.ph === filter)), [rows, filter]);

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
        case "overall": av = a.overall ?? -1; bv = b.overall ?? -1; break;
        case "potential": av = a.potential ?? -1; bv = b.potential ?? -1; break;
        case "promote": av = a.promoteFlag ? 1 : 0; bv = b.promoteFlag ? 1 : 0; break;
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
        {rows.length} minor-league players. Overall/Potential shown at full precision (this is your own org, not public).
      </p>

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

      <div style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
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
                    {th("Pos", "pos")}
                    {th("Ovr", "overall")}
                    {th("Pot", "potential")}
                    {th("Flag", "promote")}
                  </tr>
                </thead>
                <tbody>
                  {players.map((r) => (
                    <tr key={r.player_id}>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)", whiteSpace: "nowrap" }}>{r.first_name} {r.last_name}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{r.age ?? "—"}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{r.pos ?? "—"}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)", ...gradeStyle(r.overall) }}>{fmt1(r.overall)}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)", ...gradeStyle(r.potential) }}>{fmt1(r.potential)}</td>
                      <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border, #333)" }}>{r.promoteFlag ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--color-text-muted, #888)", fontSize: 11, marginTop: 10 }}>
        Sort/filter controls above apply to every team box. "Flag" is a rough heuristic only (old for level + close to ceiling) — not a real scouted promote/demote recommendation. StatsPlus doesn't expose actual promote/demote data yet.
      </p>
    </div>
  );
}
