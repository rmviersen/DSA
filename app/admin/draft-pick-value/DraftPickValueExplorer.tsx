"use client";

import { useMemo, useState } from "react";
import {
  Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Legend,
  ResponsiveContainer, Line, ComposedChart,
} from "recharts";
import type { DraftRoundValue, DraftedPlayerPoint } from "../../../lib/draft-pick-value-query";
import { warPerYearTier, percentileRank } from "../../../lib/draft-pick-value-query";

// Interactive view for the draft-pick value curve (2026-09-04, Rees's ask)
// -- same scatter + fitted-curve-overlay + drill-down-table pattern as
// MarketRateExplorer.tsx, and the same explicit per-Scatter hover/click
// handlers (not recharts' built-in <Tooltip>, which doesn't reliably fire
// with multiple series -- see MarketRateExplorer's own note on this).

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

const TIER_COLORS: Record<string, string> = {
  Elite: "#57904a",
  Plus: "#3f6b32",
  Average: "#a8763a",
  "Below Average": "#8a5a45",
  "Well Below Average": "#b0413e",
};

interface Props {
  rounds: DraftRoundValue[];
  players: DraftedPlayerPoint[];
}

export default function DraftPickValueExplorer({ rounds, players }: Props) {
  const [drilldownRound, setDrilldownRound] = useState<number | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<DraftedPlayerPoint | null>(null);
  const [pinnedPoint, setPinnedPoint] = useState<DraftedPlayerPoint | null>(null);
  const activePoint = hoveredPoint ?? pinnedPoint;

  const allWarPerYear = useMemo(() => players.map((p) => p.warPerYear), [players]);

  // "Hit rate" per round -- % of that round's OWN players who individually
  // graded Plus-tier or better -- not a round-average-vs-population tier.
  // Comparing a round's AVERAGE against the individual-player distribution
  // was tried first and produced a near-useless result: the population is so
  // skewed (84% of all players never post a positive career WAR) that almost
  // any positive round average clears the 70th/90th percentile trivially,
  // grading nearly every round "Elite" or "Plus" and making the column
  // useless for telling rounds apart. Hit rate answers the real question --
  // "how often does this round actually produce a genuinely valuable
  // player" -- correctly scaled against the same population.
  const hitRateByRound = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of rounds) {
      const inRound = players.filter((p) => p.draftRound === r.round);
      if (inRound.length === 0) { map.set(r.round, 0); continue; }
      const hits = inRound.filter((p) => percentileRank(p.warPerYear, allWarPerYear) >= 70).length;
      map.set(r.round, (hits / inRound.length) * 100);
    }
    return map;
  }, [rounds, players, allWarPerYear]);

  const curveLine = useMemo(() => rounds.map((r) => ({ round: r.round, smoothed: r.smoothedWarPerYear })), [rounds]);
  const avgLine = useMemo(() => rounds.map((r) => ({ round: r.round, avg: r.avgWarPerYear })), [rounds]);

  const drilldownPlayers = useMemo(() => {
    if (drilldownRound == null) return [];
    return players.filter((p) => p.draftRound === drilldownRound).sort((a, b) => b.warPerYear - a.warPerYear);
  }, [players, drilldownRound]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Draft classes</div>
          <div style={statValueStyle}>{rounds.length > 0 ? `${Math.min(...players.map((p) => p.draftYear))}–${Math.max(...players.map((p) => p.draftYear))}` : "—"}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Players</div>
          <div style={statValueStyle}>{players.length.toLocaleString()}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Rounds tracked</div>
          <div style={statValueStyle}>{rounds.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Round 1 avg WAR/yr</div>
          <div style={statValueStyle}>{rounds[0]?.avgWarPerYear.toFixed(2) ?? "—"}</div>
        </div>
      </div>

      {/* Scatter + curve */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Draft Round vs. Career WAR/Year</h2>
          <div
            style={{
              minWidth: 260, minHeight: 64, padding: "0.5rem 0.85rem", borderRadius: 6,
              border: `1px solid ${activePoint ? "var(--color-border-strong)" : "var(--color-border)"}`,
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
                <div style={{ color: "var(--color-text-muted)" }}>Round {activePoint.draftRound} · {activePoint.draftYear} draft</div>
                <div style={{ fontWeight: 600 }}>
                  {activePoint.warPerYear.toFixed(2)} WAR/yr · {activePoint.careerWar.toFixed(1)} career WAR over {activePoint.yearsSinceDraft} yrs
                </div>
              </>
            ) : (
              <div style={{ color: "var(--color-text-muted)", lineHeight: "64px" }}>Hover or click a point for details</div>
            )}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={460}>
          <ComposedChart margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis type="number" dataKey="round" name="Round" domain={[1, "auto"]} tick={{ fontSize: 12 }} label={{ value: "Draft Round", position: "insideBottom", offset: -5, fontSize: 12 }} />
            <YAxis type="number" dataKey="warPerYear" name="WAR/yr" tick={{ fontSize: 12 }} width={50} label={{ value: "Career WAR / Year", angle: -90, position: "insideLeft", fontSize: 12 }} />
            <ZAxis range={[35, 35]} />
            <Legend verticalAlign="top" height={32} />
            <Scatter
              name="Player"
              data={players}
              dataKey="warPerYear"
              fill="var(--color-border-strong)"
              fillOpacity={0.35}
              cursor="pointer"
              onMouseEnter={(data: unknown) => setHoveredPoint(data as DraftedPlayerPoint)}
              onMouseLeave={() => setHoveredPoint(null)}
              onClick={(data: unknown) => {
                const point = data as DraftedPlayerPoint;
                setPinnedPoint((prev) => (prev && prev.playerId === point.playerId ? null : point));
              }}
            />
            <Line type="monotone" dataKey="avg" data={avgLine} xAxisId={0} dot={false} activeDot={false} name="Round avg" stroke="var(--color-tan)" strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} />
            <Line type="monotone" dataKey="smoothed" data={curveLine} xAxisId={0} dot={false} activeDot={false} name="Smoothed curve" stroke="var(--color-navy)" strokeWidth={2.5} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
          Each dot is one drafted player. The solid line (smoothed curve) is what the trade-value composite reads — it can
          never show a later round as more valuable than an earlier one, even where the raw round average (dashed line)
          briefly bumps up from sample noise.
        </div>
      </div>

      {/* Round summary table */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>By round</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--color-table-header)", textAlign: "left" }}>
                {["Round", "n", "Avg WAR/yr", "Median", "Smoothed", "Hit rate", "Best pick"].map((h) => (
                  <th key={h} style={{ padding: "0.5rem 0.75rem", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr
                  key={r.round}
                  onClick={() => setDrilldownRound(drilldownRound === r.round ? null : r.round)}
                  style={{
                    borderTop: "1px solid var(--color-border)", cursor: "pointer",
                    background: drilldownRound === r.round ? "var(--color-table-hover)" : "transparent",
                  }}
                >
                  <td style={{ padding: "0.5rem 0.75rem", fontWeight: 700 }}>{r.round}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.sampleSize}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.avgWarPerYear.toFixed(3)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.medianWarPerYear.toFixed(3)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{r.smoothedWarPerYear.toFixed(3)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{(hitRateByRound.get(r.round) ?? 0).toFixed(1)}%</td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    {r.bestPlayerName} <span style={{ color: "var(--color-text-muted)" }}>({r.bestPlayerWarPerYear?.toFixed(2)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
          Hit rate = the share of that round&apos;s OWN players who individually graded Plus-tier or better against the
          full population (not a fixed WAR cutoff — the real distribution is heavily skewed, so an absolute cutoff would
          call almost everything &quot;replacement level&quot;). Click a row to see that round&apos;s individual players
          and their own tier grades.
        </div>
      </div>

      {/* Drill-down detail */}
      {drilldownRound != null && (
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Round {drilldownRound} — players ({drilldownPlayers.length})</h2>
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "var(--color-table-header)", textAlign: "left", position: "sticky", top: 0 }}>
                  {["Player", "Draft Year", "Career WAR", "Years Since Draft", "WAR/yr", "Tier"].map((h) => (
                    <th key={h} style={{ padding: "0.5rem 0.75rem", fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drilldownPlayers.map((p) => {
                  const tier = warPerYearTier(percentileRank(p.warPerYear, allWarPerYear));
                  return (
                    <tr key={p.playerId} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "0.45rem 0.75rem" }}>{p.playerName}</td>
                      <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{p.draftYear}</td>
                      <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{p.careerWar.toFixed(1)}</td>
                      <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{p.yearsSinceDraft}</td>
                      <td style={{ padding: "0.45rem 0.75rem", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{p.warPerYear.toFixed(2)}</td>
                      <td style={{ padding: "0.45rem 0.75rem" }}>
                        <span style={{ color: TIER_COLORS[tier] ?? "var(--color-text)", fontWeight: 600 }}>{tier}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Methodology note */}
      <div style={{ ...cardStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
        <strong style={{ color: "var(--color-text)" }}>Methodology.</strong> Real MLB (level_id=1) career WAR accumulated
        since being drafted, divided by years since draft — draft classes need at least 3 years on the books to qualify,
        so the most recent classes aren&apos;t included yet (not enough time has passed to show real outcomes). This will
        get better, not be replaced, over time: every future draft adds a class, and as recent classes keep accumulating
        real MLB seasons, this curve will naturally sharpen. Full detail in HANDOFF.md&apos;s transaction-analysis section.
      </div>
    </div>
  );
}
