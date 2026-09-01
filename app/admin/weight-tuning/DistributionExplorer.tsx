"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { RatingDistributionPoint } from "../../../lib/weight-tuning-query";

// Overall/Potential distribution curves, by role (2026-09-02, Rees's ask --
// "this will help me visualize the rescaling once we begin"). The point is
// specifically to have a real "before" picture on record: once the hitter/
// pitcher rescale ships, this same chart should be the fastest way to see
// whether it actually closed the gap between roles, not just take it on
// faith. Scoped to real MLB roster players (see getRatingDistributionPoints'
// comment) -- same reference population as every hitter/pitcher-scale
// comparison this session.
//
// A real KDE would need its own bandwidth-selection logic this app has no
// use for anywhere else; a binned histogram rendered as a connected line
// (bin width 2, matching the ~50-point real spread these ratings live on)
// reads as a "distribution curve" without that complexity, consistent with
// how every other chart on this page is built (recharts, no extra library).
// Each role's curve is normalized to a % of that role's OWN population, not
// raw counts -- roles range from ~25 players (CF) to ~330 (RP), and raw
// counts would make the small ones look like flat lines next to RP/hitting
// roles regardless of their actual shape.

const ROLE_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "COF", "CF", "DH"];
const ROLE_COLORS: Record<string, string> = {
  SP: "#0b3049", RP: "#3f6b32", C: "#a8763a", "1B": "#6b4a24", INF: "#123a54",
  SS: "#57904a", CF: "#c99a5c", COF: "#8a5a9e", DH: "#b0413e",
};
const BIN_WIDTH = 2;

const cardStyle: React.CSSProperties = {
  background: "var(--color-surface)", border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "1.25rem 1.5rem",
};
const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: "1.1875rem", fontWeight: 700,
  margin: "0 0 0.75rem", color: "var(--color-heading)",
};

interface Props { points: RatingDistributionPoint[] }

export default function DistributionExplorer({ points }: Props) {
  const [metric, setMetric] = useState<"overall" | "potential">("overall");
  const rolesPresent = useMemo(() => ROLE_ORDER.filter((r) => points.some((p) => p.role === r)), [points]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(() => new Set(rolesPresent));

  function toggleRole(role: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  const byRole = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const p of points) {
      const v = metric === "overall" ? p.overall : p.potential;
      if (!map.has(p.role)) map.set(p.role, []);
      map.get(p.role)!.push(v);
    }
    return map;
  }, [points, metric]);

  const stats = useMemo(() => {
    const result: { role: string; n: number; mean: number }[] = [];
    for (const role of rolesPresent) {
      const vals = byRole.get(role) ?? [];
      if (vals.length === 0) continue;
      result.push({ role, n: vals.length, mean: vals.reduce((s, v) => s + v, 0) / vals.length });
    }
    return result;
  }, [byRole, rolesPresent]);

  // Shared bin edges across every role (not just selected ones) so toggling
  // a role on/off never shifts the x-axis underneath the curves already shown.
  const { binStarts } = useMemo(() => {
    const all = points.map((p) => (metric === "overall" ? p.overall : p.potential));
    if (all.length === 0) return { binStarts: [] as number[] };
    const min = Math.floor(Math.min(...all) / BIN_WIDTH) * BIN_WIDTH;
    const max = Math.ceil(Math.max(...all) / BIN_WIDTH) * BIN_WIDTH;
    const starts: number[] = [];
    for (let b = min; b < max; b += BIN_WIDTH) starts.push(b);
    return { binStarts: starts };
  }, [points, metric]);

  const chartData = useMemo(() => {
    return binStarts.map((start) => {
      const row: Record<string, number> = { bin: start + BIN_WIDTH / 2 };
      for (const role of rolesPresent) {
        const vals = byRole.get(role) ?? [];
        if (vals.length === 0) continue;
        const count = vals.filter((v) => v >= start && v < start + BIN_WIDTH).length;
        row[role] = (count / vals.length) * 100;
      }
      return row;
    });
  }, [binStarts, byRole, rolesPresent]);

  const metricLabel = metric === "overall" ? "Overall" : "Potential";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: "1.25rem", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["overall", "potential"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              style={{
                padding: "0.35rem 0.85rem", borderRadius: "999px", fontSize: "0.8125rem", fontWeight: 600,
                border: `1px solid ${metric === m ? "var(--color-border-strong)" : "var(--color-border)"}`,
                background: metric === m ? "var(--color-table-hover)" : "transparent",
                color: "var(--color-text)", cursor: "pointer", textTransform: "capitalize",
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {rolesPresent.map((role) => {
            const active = selectedRoles.has(role);
            return (
              <button
                key={role}
                onClick={() => toggleRole(role)}
                style={{
                  padding: "0.3rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700,
                  border: `1.5px solid ${active ? ROLE_COLORS[role] : "var(--color-border)"}`,
                  background: active ? ROLE_COLORS[role] : "transparent",
                  color: active ? "#fff" : "var(--color-text-muted)", cursor: "pointer",
                }}
              >
                {role}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto" }}>
          <button onClick={() => setSelectedRoles(new Set(rolesPresent))} style={{ padding: "0.3rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", color: "var(--color-text)" }}>All</button>
          <button onClick={() => setSelectedRoles(new Set())} style={{ padding: "0.3rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", color: "var(--color-text)" }}>None</button>
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>{metricLabel} distribution by role</h2>
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={chartData} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="bin" type="number" domain={["auto", "auto"]} tick={{ fontSize: 12 }} label={{ value: metricLabel, position: "insideBottom", offset: -5, fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={50} label={{ value: "% of role", angle: -90, position: "insideLeft", fontSize: 12 }} />
            <Tooltip
              formatter={(value) => `${Number(value).toFixed(1)}%`}
              labelFormatter={(bin) => `${metricLabel} ≈ ${Number(bin).toFixed(0)}`}
              contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", fontSize: "0.8125rem" }}
            />
            <Legend verticalAlign="top" height={32} />
            {rolesPresent.filter((r) => selectedRoles.has(r)).map((role) => (
              <Line key={role} type="monotone" dataKey={role} name={role} stroke={ROLE_COLORS[role]} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.75rem", fontSize: "0.8125rem" }}>
          {stats.filter((s) => selectedRoles.has(s.role)).map((s) => (
            <div key={s.role} style={{ color: "var(--color-text-muted)" }}>
              <strong style={{ color: ROLE_COLORS[s.role] }}>{s.role}</strong>: mean {s.mean.toFixed(1)}, n={s.n}
            </div>
          ))}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
          Each curve is normalized to a % of that role&apos;s own population (roles range from ~25 to ~330 players),
          not raw counts, so shapes are comparable regardless of role size. Real MLB roster players only.
        </div>
      </div>
    </div>
  );
}
