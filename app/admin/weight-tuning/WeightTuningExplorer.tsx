"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { STREAMS, type Stream, type WeightTuningSnapshot, type WeightTuningHistoryPoint } from "../../../lib/weight-tuning-query";

// Same visual language as RatingValidationExplorer.tsx/MarketRateExplorer.tsx
// (pill toggles, card style, tabular-nums stat blocks) -- reused
// deliberately rather than reinvented, per this app's existing convention.

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

const STREAM_COLORS: Record<Stream, string> = {
  hitting: "#0b3049", baserunning: "#57904a", pitching: "#a8763a", overall_blend: "#8a5a9e",
  pitching_sp: "#a8763a", pitching_rp: "#c99a5c",
  pitching_sp_war: "#7a4f22", pitching_rp_war: "#b0824a",
};

interface Props {
  snapshots: Record<Stream, WeightTuningSnapshot | null>;
  history: WeightTuningHistoryPoint[];
}

// One horizontal bar per variable comparing implied vs. current weight on a
// shared 0..maxWeight scale -- deliberately simple (no chart library) since
// it's just two numbers per row, not a real dataset needing recharts.
function WeightBar({ implied, current, max, color }: { implied: number; current: number | null; max: number; color: string }) {
  const impliedPct = max > 0 ? Math.min(100, (implied / max) * 100) : 0;
  const currentPct = current != null && max > 0 ? Math.min(100, (current / max) * 100) : null;
  return (
    <div style={{ position: "relative", height: 20, background: "var(--color-surface-sunken, var(--color-bg))", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, width: `${impliedPct}%`, background: color, opacity: 0.55 }} />
      {currentPct != null && (
        <div style={{ position: "absolute", top: -2, bottom: -2, left: `${currentPct}%`, width: 2, background: "var(--color-heading)" }} title={`Current: ${current?.toFixed(3)}`} />
      )}
    </div>
  );
}

export default function WeightTuningExplorer({ snapshots, history }: Props) {
  const availableStreams = STREAMS.filter((s) => snapshots[s.key] != null);
  const [stream, setStream] = useState<Stream>(availableStreams[0]?.key ?? "hitting");
  const snapshot = snapshots[stream];

  const maxWeight = useMemo(() => {
    if (!snapshot) return 1;
    return Math.max(...snapshot.coefficients.flatMap((c) => [c.impliedWeight, c.currentWeight ?? 0]), 0.01);
  }, [snapshot]);

  // R² history, one line per stream, x-axis = refresh_run_id (a real
  // ordering of "seasons of data accumulated," not wall-clock time).
  const historyByRun = useMemo(() => {
    const runIds = [...new Set(history.map((h) => h.refreshRunId))].sort((a, b) => a - b);
    return runIds.map((runId) => {
      const row: Record<string, number | null> = { refreshRunId: runId };
      for (const s of STREAMS) {
        const point = history.find((h) => h.refreshRunId === runId && h.stream === s.key);
        row[s.key] = point ? point.rSquared : null;
      }
      return row;
    });
  }, [history]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Stream toggle */}
      <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {STREAMS.map((s) => {
            const has = snapshots[s.key] != null;
            const active = stream === s.key;
            return (
              <button
                key={s.key}
                disabled={!has}
                onClick={() => setStream(s.key)}
                style={{
                  padding: "0.35rem 0.85rem", borderRadius: "999px", fontSize: "0.8125rem", fontWeight: 600,
                  border: `1px solid ${active ? "var(--color-border-strong)" : "var(--color-border)"}`,
                  background: active ? "var(--color-table-hover)" : "transparent",
                  color: has ? "var(--color-text)" : "var(--color-text-muted)",
                  cursor: has ? "pointer" : "not-allowed", opacity: has ? 1 : 0.5,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {snapshot && (
          <div style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            vs. {snapshot.targetMetric} · refresh_run_id {snapshot.refreshRunId}
          </div>
        )}
      </div>

      {snapshot && (
        <>
          {/* Stat summary */}
          <div style={{ ...cardStyle, display: "flex", gap: "2rem" }}>
            <div><div style={statLabelStyle}>Target</div><div style={{ ...statValueStyle, fontSize: "1.0625rem" }}>{snapshot.targetMetric}</div></div>
            <div><div style={statLabelStyle}>R²</div><div style={statValueStyle}>{snapshot.rSquared.toFixed(3)}</div></div>
            <div><div style={statLabelStyle}>n</div><div style={statValueStyle}>{snapshot.sampleSize}</div></div>
          </div>

          {/* Coefficient table + implied-vs-current bars */}
          <div style={cardStyle}>
            <h2 style={sectionTitleStyle}>{STREAMS.find((s) => s.key === stream)?.label} — implied vs. current weight</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "var(--color-table-header)", textAlign: "left" }}>
                    {["Variable", "Standardized importance", "Implied weight", "Current weight", "Weight comparison"].map((h) => (
                      <th key={h} style={{ padding: "0.5rem 0.75rem", fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.coefficients.map((c) => (
                    <tr key={c.key} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>{c.label}</td>
                      <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums", color: c.standardizedCoefficient < 0 ? "var(--color-bad, #a8452f)" : undefined }}>
                        {c.standardizedCoefficient.toFixed(3)}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{c.impliedWeight.toFixed(3)}</td>
                      <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-muted)" }}>
                        {c.currentWeight != null ? c.currentWeight.toFixed(3) : "—"}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", minWidth: 160 }}>
                        <WeightBar implied={c.impliedWeight} current={c.currentWeight} max={maxWeight} color={STREAM_COLORS[stream]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
              Shaded bar = implied weight (this regression&apos;s standardized coefficients, clamped at 0, rescaled to sum to 1). Dark tick = today&apos;s live <code>rating_weights</code> value for comparison. Diagnostic only — nothing here writes to <code>rating_weights</code>.
            </div>
          </div>
        </>
      )}

      {/* R² history across refreshes -- the "track over time" half of the ask */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>R² over time, by stream</h2>
        {historyByRun.length <= 1 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
            Only one refresh&apos;s worth of history so far — this chart fills in as more refreshes run (all four
            scripts now run automatically every refresh, see <code>refresh.ts</code>). Come back after a few more
            sims to see a real trend instead of a single point.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={historyByRun} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="refreshRunId" tick={{ fontSize: 12 }} label={{ value: "refresh_run_id", position: "insideBottom", offset: -5, fontSize: 12 }} />
              <YAxis domain={[0, "auto"]} tick={{ fontSize: 12 }} width={45} label={{ value: "R²", angle: -90, position: "insideLeft", fontSize: 12 }} />
              <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", fontSize: "0.8125rem" }} />
              <Legend verticalAlign="top" height={32} />
              {STREAMS.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={STREAM_COLORS[s.key]} strokeWidth={2} connectNulls dot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
