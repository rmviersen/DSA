"use client";

import { useMemo, useState } from "react";
import {
  Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Legend,
  ResponsiveContainer, Line, ComposedChart,
} from "recharts";
import type { MarketRateCurve, RoleMultiplier, TrainingContractPoint } from "../../../lib/market-rate-query";

// Interactive tuning view for the market-rate curve (2026-08-31, Rees's
// ask) -- a scatterplot of the accumulated training pool (Overall vs. AAV)
// with the fitted regression overlaid, plus a per-role summary/drill-down
// table underneath. Client component: recharts needs the browser, and the
// role filter/hover/drill-down interactions are all local UI state, no
// reason to round-trip to the server for any of it -- the whole training
// pool is small (hundreds of rows, not thousands) so filtering in-browser
// is instant.

const ROLE_COLORS: Record<string, string> = {
  SP: "#0b3049", RP: "#3f6b32", C: "#a8763a", "1B": "#6b4a24", INF: "#123a54",
  SS: "#57904a", CF: "#c99a5c", COF: "#8a5a9e", DH: "#b0413e",
};
function colorForRole(role: string): string {
  return ROLE_COLORS[role] ?? "#5b6b72";
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const cardStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "1.25rem 1.5rem",
};
const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.1875rem",
  fontWeight: 700,
  margin: "0 0 0.75rem",
  color: "var(--color-heading)",
};
const statLabelStyle: React.CSSProperties = { fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" };
const statValueStyle: React.CSSProperties = { fontSize: "1.375rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--color-heading)" };

interface Props {
  curves: MarketRateCurve[];
  roleMultipliers: RoleMultiplier[];
  contracts: TrainingContractPoint[];
}

type PlayerTypeFilter = "all" | "hitter" | "pitcher";

export default function MarketRateExplorer({ curves, roleMultipliers, contracts }: Props) {
  const allRoles = useMemo(() => [...new Set(contracts.map((c) => c.role))].sort(), [contracts]);
  const [playerTypeFilter, setPlayerTypeFilter] = useState<PlayerTypeFilter>("all");
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set(allRoles));
  const [drilldownRole, setDrilldownRole] = useState<string | null>(null);

  // Point detail panel, driven by explicit per-Scatter handlers rather than
  // recharts' built-in <Tooltip> (2026-08-31 fix -- the built-in tooltip
  // wasn't firing on hover at all; recharts v3 supports onMouseEnter/
  // onMouseLeave/onClick directly on <Scatter>, dispatched per-symbol, which
  // is both more reliable and gives "hover OR click" for free, per Rees's
  // ask). Hovering shows a live preview; clicking pins a point so its detail
  // stays visible even after the mouse moves away -- cleared by clicking the
  // same point again or picking a different one.
  const [hoveredPoint, setHoveredPoint] = useState<TrainingContractPoint | null>(null);
  const [pinnedPoint, setPinnedPoint] = useState<TrainingContractPoint | null>(null);
  const activePoint = hoveredPoint ?? pinnedPoint;

  const hitterCurve = curves.find((c) => c.playerType === "hitter");
  const pitcherCurve = curves.find((c) => c.playerType === "pitcher");

  function toggleRole(role: string) {
    setRoleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  }

  const filtered = useMemo(() => {
    return contracts.filter((c) => {
      if (playerTypeFilter !== "all" && c.playerType !== playerTypeFilter) return false;
      if (!roleFilter.has(c.role)) return false;
      return true;
    });
  }, [contracts, playerTypeFilter, roleFilter]);

  // Curve line points, one series per player type currently in view.
  const curveLines = useMemo(() => {
    const lines: { type: "hitter" | "pitcher"; points: { overall: number; aav: number }[] }[] = [];
    for (const curve of [hitterCurve, pitcherCurve]) {
      if (!curve) continue;
      if (playerTypeFilter !== "all" && playerTypeFilter !== curve.playerType) continue;
      const visibleForType = filtered.filter((c) => c.playerType === curve.playerType);
      if (visibleForType.length === 0 && playerTypeFilter === "all") continue;
      const points: { overall: number; aav: number }[] = [];
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const x = curve.minOverallInSample + ((curve.maxOverallInSample - curve.minOverallInSample) * i) / steps;
        points.push({ overall: x, aav: Math.exp(curve.intercept + curve.slope * x) });
      }
      lines.push({ type: curve.playerType, points });
    }
    return lines;
  }, [hitterCurve, pitcherCurve, playerTypeFilter, filtered]);

  const roleRowsForTable = useMemo(() => {
    const visibleRoles = new Set(filtered.map((c) => c.role));
    return roleMultipliers.filter((r) => visibleRoles.has(r.role));
  }, [roleMultipliers, filtered]);

  const drilldownContracts = useMemo(() => {
    if (!drilldownRole) return [];
    return filtered.filter((c) => c.role === drilldownRole).sort((a, b) => b.aav - a.aav);
  }, [filtered, drilldownRole]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Filters */}
      <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: "1.25rem", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["all", "hitter", "pitcher"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setPlayerTypeFilter(t)}
              style={{
                padding: "0.35rem 0.85rem", borderRadius: "999px", fontSize: "0.8125rem", fontWeight: 600,
                border: `1px solid ${playerTypeFilter === t ? "var(--color-border-strong)" : "var(--color-border)"}`,
                background: playerTypeFilter === t ? "var(--color-table-hover)" : "transparent",
                color: "var(--color-text)", cursor: "pointer", textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {allRoles.map((role) => {
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
          {filtered.length} of {contracts.length} training contracts shown
        </div>
      </div>

      {/* Fit stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
        {[hitterCurve, pitcherCurve].filter((c): c is MarketRateCurve => !!c).map((curve) => (
          <div key={curve.playerType} style={cardStyle}>
            <div style={{ ...statLabelStyle, marginBottom: "0.35rem" }}>{curve.playerType} curve</div>
            <div style={{ fontSize: "0.8125rem", fontFamily: "monospace", color: "var(--color-text)", marginBottom: "0.6rem" }}>
              ln(AAV) = {curve.intercept.toFixed(3)} + {curve.slope.toFixed(4)} × Overall
            </div>
            <div style={{ display: "flex", gap: "1.5rem" }}>
              <div>
                <div style={statLabelStyle}>R²</div>
                <div style={statValueStyle}>{curve.rSquared.toFixed(3)}</div>
              </div>
              <div>
                <div style={statLabelStyle}>Residual SD</div>
                <div style={statValueStyle}>{curve.residualStdDev.toFixed(3)}</div>
              </div>
              <div>
                <div style={statLabelStyle}>n</div>
                <div style={statValueStyle}>{curve.sampleSize}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Scatter plot */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Overall vs. Contract Value (AAV)</h2>
          {/* Point detail panel -- always rendered (even empty) so the layout
              doesn't jump as the user hovers/clicks around. */}
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
                    <button
                      onClick={() => setPinnedPoint(null)}
                      style={{ border: "none", background: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "0.75rem", padding: 0 }}
                    >
                      clear ✕
                    </button>
                  )}
                </div>
                <div style={{ color: "var(--color-text-muted)" }}>{activePoint.role} · Overall {activePoint.overall.toFixed(1)}</div>
                <div style={{ fontWeight: 600 }}>{fmtMoney(activePoint.aav)} AAV · {activePoint.years}yr, signed {activePoint.seasonYear}</div>
              </>
            ) : (
              <div style={{ color: "var(--color-text-muted)", lineHeight: "64px" }}>Hover or click a point for details</div>
            )}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={480}>
          <ComposedChart margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis type="number" dataKey="overall" name="Overall" domain={["auto", "auto"]} tick={{ fontSize: 12 }} label={{ value: "Overall", position: "insideBottom", offset: -5, fontSize: 12 }} />
            <YAxis type="number" dataKey="aav" name="AAV" tickFormatter={fmtMoney} tick={{ fontSize: 12 }} width={70} label={{ value: "AAV", angle: -90, position: "insideLeft", fontSize: 12 }} />
            <ZAxis range={[70, 70]} />
            <Legend verticalAlign="top" height={32} />
            {allRoles.filter((r) => roleFilter.has(r) && (playerTypeFilter === "all" || filtered.some((c) => c.role === r))).map((role) => (
              <Scatter
                key={role}
                name={role}
                data={filtered.filter((c) => c.role === role)}
                fill={colorForRole(role)}
                fillOpacity={0.75}
                cursor="pointer"
                onMouseEnter={(data: unknown) => setHoveredPoint(data as TrainingContractPoint)}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={(data: unknown) => {
                  const point = data as TrainingContractPoint;
                  setPinnedPoint((prev) => (prev && prev.playerId === point.playerId && prev.seasonYear === point.seasonYear ? null : point));
                }}
              />
            ))}
            {curveLines.map((line) => (
              <Line
                key={line.type}
                type="monotone"
                dataKey="aav"
                data={line.points}
                xAxisId={0}
                dot={false}
                activeDot={false}
                legendType="none"
                stroke={line.type === "hitter" ? "var(--color-navy)" : "var(--color-tan)"}
                strokeWidth={2}
                strokeDasharray={line.type === "hitter" ? undefined : "6 4"}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          <span><span style={{ display: "inline-block", width: 16, height: 2, background: "var(--color-navy)", marginRight: 6, verticalAlign: "middle" }} />hitter curve</span>
          <span><span style={{ display: "inline-block", width: 16, height: 2, background: "var(--color-tan)", marginRight: 6, verticalAlign: "middle", borderTop: "2px dashed var(--color-tan)" }} />pitcher curve</span>
        </div>
      </div>

      {/* Role summary table */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>Per-role multipliers</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--color-table-header)", textAlign: "left" }}>
                {["Role", "n", "Avg Overall", "Actual AAV", "Curve AAV", "Raw", "Shrunk", "Final"].map((h) => (
                  <th key={h} style={{ padding: "0.5rem 0.75rem", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roleRowsForTable.map((r) => (
                <tr
                  key={r.role}
                  onClick={() => setDrilldownRole(drilldownRole === r.role ? null : r.role)}
                  style={{
                    borderTop: "1px solid var(--color-border)", cursor: "pointer",
                    background: drilldownRole === r.role ? "var(--color-table-hover)" : "transparent",
                  }}
                >
                  <td style={{ padding: "0.5rem 0.75rem", fontWeight: 700, color: colorForRole(r.role) }}>{r.role}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.sampleSize}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.avgOverallInSample.toFixed(1)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.avgActualAav)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.avgCurvePredictedAav)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>×{r.rawMultiplier.toFixed(2)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>×{r.shrunkMultiplier.toFixed(2)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                    ×{r.finalMultiplier.toFixed(2)}{r.dhCapped ? " 🔒" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
          🔒 = capped against the lowest other hitting-role multiplier (DH can never legitimately outrank a position that also plays defense). Click a row to drill into its underlying contracts.
        </div>
      </div>

      {/* Drill-down detail */}
      {drilldownRole && (
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>{drilldownRole} — underlying contracts ({drilldownContracts.length})</h2>
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "var(--color-table-header)", textAlign: "left", position: "sticky", top: 0 }}>
                  {["Player", "Overall", "AAV", "Years", "Signed"].map((h) => (
                    <th key={h} style={{ padding: "0.5rem 0.75rem", fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drilldownContracts.map((c) => (
                  <tr key={`${c.playerId}-${c.seasonYear}-${c.years}`} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "0.45rem 0.75rem" }}>{c.playerName}</td>
                    <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{c.overall.toFixed(1)}</td>
                    <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(c.aav)}</td>
                    <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{c.years}</td>
                    <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{c.seasonYear}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
