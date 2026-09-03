"use client";

import { useMemo, useState } from "react";
import {
  Bar, BarChart, XAxis, YAxis, CartesianGrid, LabelList,
  ResponsiveContainer,
} from "recharts";
import type { DraftRoundValue, DraftedPlayerPoint } from "../../../lib/draft-pick-value-query";
import { warPerYearTier, percentileRank } from "../../../lib/draft-pick-value-query";

// Interactive view for the draft-pick value curve (2026-09-04, Rees's ask).
//
// REBUILT same day after real feedback on the first version: (1) the
// scatter chart wasn't rendering any dots at all -- root cause was a stray
// `dataKey` prop set directly on <Scatter>, which isn't how the working
// MarketRateExplorer.tsx reference pattern does it (there, XAxis/YAxis's
// OWN dataKey pulls straight from each point in `data`; Scatter itself
// never repeats it). (2) a raw WAR/year scatter isn't very insightful on
// its own and its linear y-axis was badly stretched by a handful of
// outliers (max ~5.4) against a population where 84% of players sit at
// exactly 0 -- nothing in the useful middle was visible. Replaced entirely
// with two %-based bar charts (naturally bounded 0-100%, no scaling
// problem to have) answering the more direct question Rees actually
// wanted: what share of picks make the majors at all, by round and by
// draft class.

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

function pctLabel(v: number): string {
  return `${v.toFixed(0)}%`;
}

interface Props {
  rounds: DraftRoundValue[];
  players: DraftedPlayerPoint[];
}

// Real bug caught by Rees questioning round 1's reach-MLB rate (2026-09-04):
// pooling every eligible (>=3 years since draft) class into one % blends
// fully-matured classes (75-90%+ reach rate) with recent classes that
// haven't had time yet (12-50%, still climbing) -- round 1's TRUE mature
// rate is ~75%, not the 69.8% the pooled number showed. Checked league-wide:
// 96.4% of every real debut happens within 8 years of being drafted, so 8 is
// a safe, near-complete maturity cutoff. The by-round chart's own pct comes
// pre-filtered this way from the server (draft_pick_value_curve.pct_reached_
// mlb); the by-class chart is built client-side from individual players, so
// it needs the same filter applied here.
const MIN_YEARS_FOR_REACH_RATE = 8;

export default function DraftPickValueExplorer({ rounds, players }: Props) {
  const [drilldownRound, setDrilldownRound] = useState<number | null>(null);

  const allWarPerYear = useMemo(() => players.map((p) => p.warPerYear), [players]);

  const roundChartData = useMemo(
    () => rounds.map((r) => ({ round: r.round, pct: r.pctReachedMlb })),
    [rounds]
  );

  const classChartData = useMemo(() => {
    const mature = players.filter((p) => p.yearsSinceDraft >= MIN_YEARS_FOR_REACH_RATE);
    const byYear = new Map<number, { total: number; reached: number }>();
    for (const p of mature) {
      const entry = byYear.get(p.draftYear) ?? { total: 0, reached: 0 };
      entry.total += 1;
      if (p.reachedMlb) entry.reached += 1;
      byYear.set(p.draftYear, entry);
    }
    return [...byYear.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, { total, reached }]) => ({ year, pct: (reached / total) * 100, n: total }));
  }, [players]);

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
          <div style={statValueStyle}>{players.length > 0 ? `${Math.min(...players.map((p) => p.draftYear))}–${Math.max(...players.map((p) => p.draftYear))}` : "—"}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Players</div>
          <div style={statValueStyle}>{players.length.toLocaleString()}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Round 1 reach-MLB rate</div>
          <div style={statValueStyle}>{rounds[0]?.pctReachedMlb.toFixed(0) ?? "—"}%</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Round 20+ reach-MLB rate</div>
          <div style={statValueStyle}>
            {(() => {
              const late = rounds.filter((r) => r.round >= 20);
              if (late.length === 0) return "—";
              return `${(late.reduce((a, r) => a + r.pctReachedMlb, 0) / late.length).toFixed(0)}%`;
            })()}
          </div>
        </div>
      </div>

      {/* % reached MLB by round */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>% of Picks Who Reached the Majors, by Round</h2>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={roundChartData} margin={{ top: 24, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="round" tick={{ fontSize: 11 }} interval={0} label={{ value: "Draft Round", position: "insideBottom", offset: -5, fontSize: 12 }} />
            <YAxis domain={[0, 100]} tickFormatter={pctLabel} tick={{ fontSize: 12 }} width={45} label={{ value: "% Reached MLB", angle: -90, position: "insideLeft", fontSize: 12 }} />
            <Bar dataKey="pct" fill="var(--color-navy)" radius={[3, 3, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(d: unknown) => {
              const point = d as { round: number };
              setDrilldownRound((prev) => (prev === point.round ? null : point.round));
            }}>
              <LabelList dataKey="pct" position="top" formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(0) : "")} style={{ fontSize: 10, fill: "var(--color-text-muted)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
          Click a bar to see that round&apos;s individual players below. Reach-MLB rate specifically requires at least{" "}
          {MIN_YEARS_FOR_REACH_RATE} years since being drafted (not just 3) to count — checked league-wide, 96.4% of
          every real debut happens within {MIN_YEARS_FOR_REACH_RATE} years, so anything younger hasn&apos;t had a fair
          chance to show up yet and would silently drag the rate down (round 1&apos;s true rate is ~75%, not the ~70%
          you&apos;d get pooling in still-developing recent classes).
        </div>
      </div>

      {/* % reached MLB by draft class */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>% of Picks Who Reached the Majors, by Draft Class</h2>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={classChartData} margin={{ top: 24, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} interval={1} label={{ value: "Draft Year", position: "insideBottom", offset: -5, fontSize: 12 }} />
            <YAxis domain={[0, 100]} tickFormatter={pctLabel} tick={{ fontSize: 12 }} width={45} label={{ value: "% Reached MLB", angle: -90, position: "insideLeft", fontSize: 12 }} />
            <Bar dataKey="pct" fill="var(--color-tan)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="pct" position="top" formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(0) : "")} style={{ fontSize: 10, fill: "var(--color-text-muted)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
          Every player drafted that year (all rounds combined), not just one round — a way to see whether talent
          depth/graduation rates have shifted across the league&apos;s history. Only shows classes at least{" "}
          {MIN_YEARS_FOR_REACH_RATE} years removed from their draft, same reason as the round chart above.
        </div>
      </div>

      {/* Round summary table */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>By round — full detail</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--color-table-header)", textAlign: "left" }}>
                {["Round", "n", "% Reached MLB (n)", "Avg WAR/yr", "Median", "Smoothed", "Hit rate", "Best pick"].map((h) => (
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
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                    {r.pctReachedMlb.toFixed(1)}% <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>(n={r.reachRateSampleSize})</span>
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.avgWarPerYear.toFixed(3)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.medianWarPerYear.toFixed(3)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{r.smoothedWarPerYear.toFixed(3)}</td>
                  <td style={{ padding: "0.5rem 0.75rem", fontVariantNumeric: "tabular-nums" }}>{(hitRateByRound.get(r.round) ?? 0).toFixed(1)}%</td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    {r.bestPlayerName} <span style={{ color: "var(--color-text-muted)" }}>({r.bestPlayerCareerWar?.toFixed(1)} career WAR)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
          Hit rate = the share of that round&apos;s OWN players who individually graded Plus-tier or better against the
          full population (percentile-based, not a fixed WAR cutoff — the real distribution is heavily skewed, so an
          absolute cutoff would call almost everything &quot;replacement level&quot;). Smoothed WAR/yr is what the
          trade-value composite will actually read. Click a row to see that round&apos;s individual players.
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
                  {["Player", "Draft Year", "Reached MLB?", "Career WAR", "Years Since Draft", "WAR/yr", "Tier"].map((h) => (
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
                      <td style={{ padding: "0.45rem 0.75rem" }}>{p.reachedMlb ? "Yes" : "No"}</td>
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
        <strong style={{ color: "var(--color-text)" }}>Methodology.</strong> &quot;Reached MLB&quot; means at least one
        real plate appearance or inning pitched at the MLB level, ever — a much lower bar than producing positive career
        value. WAR/year (in the table below) is real MLB career WAR accumulated since being drafted, divided by years
        since draft, so a recent pick still early in his career isn&apos;t penalized against one who&apos;s had decades
        to accumulate value — that metric needs at least 3 years on the books to qualify. Reach-MLB rate needs at
        least {MIN_YEARS_FOR_REACH_RATE} years — checked league-wide, 96.4% of every real debut happens within{" "}
        {MIN_YEARS_FOR_REACH_RATE} years of being drafted, so anything younger hasn&apos;t had a fair chance yet and
        would silently drag the rate down if pooled in (round 1&apos;s true mature rate is ~75%, not ~70%). This will
        get better, not be replaced, over time — every future draft adds a class, and more recent classes clear the{" "}
        {MIN_YEARS_FOR_REACH_RATE}-year bar every year. Full detail in HANDOFF.md&apos;s transaction-analysis section.
      </div>
    </div>
  );
}
