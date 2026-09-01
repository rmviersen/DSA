"use client";

import { useMemo, useState } from "react";
import {
  Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Legend,
  ResponsiveContainer, Line, ComposedChart,
} from "recharts";
import { fitLine } from "../../../lib/regression";
import { HITTER_VARIABLES, PITCHER_VARIABLES, type ValidationPoint } from "../../../lib/rating-validation-query";

// Rating-engine validity check (2026-08-31, Rees's ask): does Overall
// actually predict real production, and which of the individual weighted
// grade inputs matter most? Same interactive pattern as
// app/admin/market-rates/MarketRateExplorer.tsx (scatter + regression +
// hover/click detail panel via explicit Scatter handlers, not the built-in
// <Tooltip> -- that one silently didn't fire in real use, see HANDOFF.md),
// reused deliberately rather than reinvented.

const ROLE_COLORS: Record<string, string> = {
  SP: "#0b3049", RP: "#3f6b32", C: "#a8763a", "1B": "#6b4a24", INF: "#123a54",
  SS: "#57904a", CF: "#c99a5c", COF: "#8a5a9e", DH: "#b0413e",
};
function colorForRole(role: string): string {
  return ROLE_COLORS[role] ?? "#5b6b72";
}

const cardStyle: React.CSSProperties = {
  background: "var(--color-surface)", border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: "1.25rem 1.5rem",
};
const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: "1.1875rem", fontWeight: 700,
  margin: "0 0 0.75rem", color: "var(--color-heading)",
};
const statLabelStyle: React.CSSProperties = { fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" };
const statValueStyle: React.CSSProperties = { fontSize: "1.375rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--color-heading)" };

interface Variable { key: string; label: string; getValue: (p: ValidationPoint) => number | null }

function buildVariables(playerType: "hitter" | "pitcher"): Variable[] {
  const overall: Variable = { key: "overall", label: "Overall", getValue: (p) => p.overall };
  const gradeVars = (playerType === "hitter" ? HITTER_VARIABLES : PITCHER_VARIABLES).map((v) => ({
    key: v.key, label: v.label, getValue: (p: ValidationPoint) => p.grades[v.key] ?? null,
  }));
  return [overall, ...gradeVars];
}

interface Props { points: ValidationPoint[] }

export default function RatingValidationExplorer({ points }: Props) {
  const [playerType, setPlayerType] = useState<"hitter" | "pitcher">("hitter");
  const variables = useMemo(() => buildVariables(playerType), [playerType]);
  const [selectedKey, setSelectedKey] = useState<string>("overall");

  const typeRoles = useMemo(() => [...new Set(points.filter((p) => p.playerType === playerType).map((p) => p.role))].sort(), [points, playerType]);
  const [roleFilter, setRoleFilter] = useState<Set<string>>(() => new Set(typeRoles));

  function switchType(t: "hitter" | "pitcher") {
    setPlayerType(t);
    setSelectedKey("overall");
    setRoleFilter(new Set([...new Set(points.filter((p) => p.playerType === t).map((p) => p.role))]));
  }
  function toggleRole(role: string) {
    setRoleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  const filtered = useMemo(
    () => points.filter((p) => p.playerType === playerType && roleFilter.has(p.role)),
    [points, playerType, roleFilter]
  );

  // Regression stats for EVERY variable (not just the selected one) --
  // powers the always-visible comparison table so you can see which grade
  // actually predicts WAR best without clicking through each one.
  const variableStats = useMemo(() => {
    return variables.map((v) => {
      const vPoints = filtered
        .map((p) => ({ x: v.getValue(p), y: p.war, raw: p }))
        .filter((d): d is { x: number; y: number; raw: ValidationPoint } => d.x != null);
      if (vPoints.length < 5) return { variable: v, n: vPoints.length, fit: null };
      const fit = fitLine(vPoints.map((d) => ({ x: d.x, y: d.y })));
      return { variable: v, n: vPoints.length, fit };
    }).sort((a, b) => (b.fit?.rSquared ?? -1) - (a.fit?.rSquared ?? -1));
  }, [variables, filtered]);

  const selected = variables.find((v) => v.key === selectedKey) ?? variables[0];
  const selectedStat = variableStats.find((s) => s.variable.key === selected.key);
  const chartData = useMemo(
    () => filtered.map((p) => ({ ...p, x: selected.getValue(p) })).filter((p) => p.x != null),
    [filtered, selected]
  );
  const curveLine = useMemo(() => {
    if (!selectedStat?.fit || chartData.length === 0) return null;
    const xs = chartData.map((d) => d.x as number);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const { intercept, slope } = selectedStat.fit;
    return [
      { x: minX, y: intercept + slope * minX },
      { x: maxX, y: intercept + slope * maxX },
    ];
  }, [selectedStat, chartData]);

  const [hoveredPoint, setHoveredPoint] = useState<ValidationPoint | null>(null);
  const [pinnedPoint, setPinnedPoint] = useState<ValidationPoint | null>(null);
  const activePoint = hoveredPoint ?? pinnedPoint;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Filters */}
      <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: "1.25rem", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["hitter", "pitcher"] as const).map((t) => (
            <button
              key={t}
              onClick={() => switchType(t)}
              style={{
                padding: "0.35rem 0.85rem", borderRadius: "999px", fontSize: "0.8125rem", fontWeight: 600,
                border: `1px solid ${playerType === t ? "var(--color-border-strong)" : "var(--color-border)"}`,
                background: playerType === t ? "var(--color-table-hover)" : "transparent",
                color: "var(--color-text)", cursor: "pointer", textTransform: "capitalize",
              }}
            >
              {t}s
            </button>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {typeRoles.map((role) => {
            const active = roleFilter.has(role);
            return (
              <button
                key={role}
                onClick={() => toggleRole(role)}
                style={{
                  padding: "0.3rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700,
                  border: `1.5px solid ${active ? colorForRole(role) : "var(--color-border)"}`,
                  background: active ? colorForRole(role) : "transparent",
                  color: active ? "#fff" : "var(--color-text-muted)", cursor: "pointer",
                }}
              >
                {role}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {filtered.length} {playerType}s (2031 MLB, {playerType === "hitter" ? "50+ PA" : "20+ IP"})
        </div>
      </div>

      {/* Variable comparison table -- always shows every variable */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>Which inputs actually predict 2031 WAR?</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--color-table-header)", textAlign: "left" }}>
                {["Variable", "n", "R²", "Slope", "Residual SD"].map((h) => (
                  <th key={h} style={{ padding: "0.5rem 0.75rem", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {variableStats.map((s) => (
                <tr
                  key={s.variable.key}
                  onClick={() => setSelectedKey(s.variable.key)}
                  style={{
                    borderTop: "1px solid var(--color-border)", cursor: "pointer",
                    background: selectedKey === s.variable.key ? "var(--color-table-hover)" : "transparent",
                  }}
                >
                  <td style={{ padding: "0.5rem 0.75rem", fontWeight: s.variable.key === "overall" ? 700 : 500 }}>
                    {s.variable.key === "overall" ? "★ " : ""}{s.variable.label}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{s.n}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{s.fit ? s.fit.rSquared.toFixed(3) : "—"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{s.fit ? s.fit.slope.toFixed(3) : "—"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{s.fit ? s.fit.residualStdDev.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
          ★ Overall is the rating engine's composite; the rest are the raw grades that feed into it. Click a row to plot it below. Higher R² = that variable explains more of the real variation in 2031 WAR.
        </div>
      </div>

      {/* Scatter plot for the selected variable */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <h2 style={{ ...sectionTitleStyle, margin: 0 }}>{selected.label} vs. 2031 WAR</h2>
          <div
            style={{
              minWidth: 260, minHeight: 64, padding: "0.5rem 0.85rem", borderRadius: 6,
              border: `1px solid ${activePoint ? colorForRole(activePoint.role) : "var(--color-border)"}`,
              background: "var(--color-bg)", fontSize: "0.8125rem",
            }}
          >
            {activePoint ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 700 }}>{activePoint.playerName}</span>
                  {pinnedPoint && !hoveredPoint && (
                    <button onClick={() => setPinnedPoint(null)} style={{ border: "none", background: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "0.75rem", padding: 0 }}>
                      clear ✕
                    </button>
                  )}
                </div>
                <div style={{ color: "var(--color-text-muted)" }}>{activePoint.role} · Overall {activePoint.overall.toFixed(1)}</div>
                <div style={{ fontWeight: 600 }}>
                  {activePoint.war.toFixed(1)} WAR · {activePoint.playingTime.toFixed(0)} {activePoint.playerType === "hitter" ? "PA" : "IP"}
                </div>
              </>
            ) : (
              <div style={{ color: "var(--color-text-muted)", lineHeight: "64px" }}>Hover or click a point for details</div>
            )}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={480}>
          <ComposedChart margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis type="number" dataKey="x" name={selected.label} domain={["auto", "auto"]} tick={{ fontSize: 12 }} label={{ value: selected.label, position: "insideBottom", offset: -5, fontSize: 12 }} />
            <YAxis type="number" dataKey="war" name="WAR" tick={{ fontSize: 12 }} width={50} label={{ value: "2031 WAR", angle: -90, position: "insideLeft", fontSize: 12 }} />
            <ZAxis range={[70, 70]} />
            <Legend verticalAlign="top" height={32} />
            {typeRoles.filter((r) => roleFilter.has(r)).map((role) => (
              <Scatter
                key={role}
                name={role}
                data={chartData.filter((d) => d.role === role)}
                fill={colorForRole(role)}
                fillOpacity={0.75}
                cursor="pointer"
                onMouseEnter={(data: unknown) => setHoveredPoint(data as ValidationPoint)}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={(data: unknown) => {
                  const point = data as ValidationPoint;
                  setPinnedPoint((prev) => (prev && prev.playerId === point.playerId ? null : point));
                }}
              />
            ))}
            {curveLine && (
              <Line
                type="linear" dataKey="y" data={curveLine} xAxisId={0} dot={false} activeDot={false}
                legendType="none" stroke="var(--color-navy)" strokeWidth={2} isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {selectedStat?.fit && (
          <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem" }}>
            <div><div style={statLabelStyle}>R²</div><div style={statValueStyle}>{selectedStat.fit.rSquared.toFixed(3)}</div></div>
            <div><div style={statLabelStyle}>Slope</div><div style={statValueStyle}>{selectedStat.fit.slope.toFixed(3)}</div></div>
            <div><div style={statLabelStyle}>Residual SD</div><div style={statValueStyle}>{selectedStat.fit.residualStdDev.toFixed(2)}</div></div>
            <div><div style={statLabelStyle}>n</div><div style={statValueStyle}>{selectedStat.n}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}
