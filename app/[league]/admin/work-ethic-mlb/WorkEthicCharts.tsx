import type { GroupStat, StratumStat, WorkEthic, WorkEthicReport } from "../../../../lib/work-ethic-report-query";
import { WE_ORDER, WE_LABEL } from "../../../../lib/work-ethic-report-query";

// Plain server-rendered SVG charts (no chart library in this project). Colors match
// PlayerTable's Work Ethic coloring: green = High, red = Low, neutral = Normal.
const WE_COLOR: Record<WorkEthic, string> = { H: "rgb(34,197,94)", N: "rgb(120,138,160)", L: "rgb(220,38,38)" };
const pctText = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
const AXIS = "var(--color-text-muted, #888)";
const TEXT = "var(--color-text, #ddd)";

function niceMax(v: number): number {
  const steps = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 1];
  return steps.find((s) => s >= v) ?? 1;
}

// One bar per Work Ethic group, whiskers = 95% Wilson interval.
export function OverallBars({ overall }: { overall: Record<WorkEthic, GroupStat> }) {
  const W = 520, H = 300, padL = 52, padR = 16, padT = 28, padB = 58;
  const max = niceMax(Math.max(...WE_ORDER.map((w) => overall[w].hi)));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const bw = 96, gap = (W - padL - padR - bw * 3) / 4;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Percent of prospects who reached MLB, by work ethic" style={{ width: "100%", maxWidth: 560, height: "auto" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border, #333)" strokeWidth={0.7} />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={AXIS}>{pctText(t)}</text>
        </g>
      ))}
      {WE_ORDER.map((w, i) => {
        const g = overall[w];
        const x = padL + gap + i * (bw + gap);
        const cx = x + bw / 2;
        return (
          <g key={w}>
            <rect x={x} y={y(g.pct)} width={bw} height={Math.max(0, y(0) - y(g.pct))} fill={WE_COLOR[w]} rx={3} opacity={0.9} />
            <line x1={cx} x2={cx} y1={y(g.lo)} y2={y(g.hi)} stroke={TEXT} strokeWidth={1.5} />
            <line x1={cx - 7} x2={cx + 7} y1={y(g.hi)} y2={y(g.hi)} stroke={TEXT} strokeWidth={1.5} />
            <line x1={cx - 7} x2={cx + 7} y1={y(g.lo)} y2={y(g.lo)} stroke={TEXT} strokeWidth={1.5} />
            <text x={cx} y={y(g.hi) - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill={TEXT}>{pctText(g.pct)}</text>
            <text x={cx} y={H - padB + 18} textAnchor="middle" fontSize={13} fontWeight={600} fill={TEXT}>{WE_LABEL[w]}</text>
            <text x={cx} y={H - padB + 34} textAnchor="middle" fontSize={11} fill={AXIS}>{g.mlb} of {g.n.toLocaleString()}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Grouped bars: one cluster per stratum (potential tier / age bucket), 3 bars each.
export function GroupedBars({ strata, height = 300 }: { strata: StratumStat[]; height?: number }) {
  const W = 760, H = height, padL = 52, padR = 12, padT = 22, padB = 64;
  const max = niceMax(Math.max(...strata.flatMap((s) => WE_ORDER.map((w) => s.byWe[w].pct))) * 1.15);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const clusterW = (W - padL - padR) / strata.length;
  const bw = Math.min(30, (clusterW - 14) / 3);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Percent reaching MLB by work ethic within each group" style={{ width: "100%", height: "auto" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border, #333)" strokeWidth={0.7} />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={AXIS}>{pctText(t)}</text>
        </g>
      ))}
      {strata.map((s, i) => {
        const cx = padL + clusterW * i + clusterW / 2;
        return (
          <g key={s.label}>
            {WE_ORDER.map((w, k) => {
              const g = s.byWe[w];
              const x = cx - (bw * 3) / 2 + k * bw;
              return (
                <g key={w}>
                  <rect x={x + 1} y={y(g.pct)} width={bw - 2} height={Math.max(0, y(0) - y(g.pct))} fill={WE_COLOR[w]} rx={2} opacity={g.n === 0 ? 0.15 : 0.9} />
                  <text x={x + bw / 2} y={y(g.pct) - 4} textAnchor="middle" fontSize={9.5} fill={TEXT}>{g.n === 0 ? "" : g.mlb}</text>
                </g>
              );
            })}
            <text x={cx} y={H - padB + 16} textAnchor="middle" fontSize={11} fontWeight={600} fill={TEXT}>{s.label.split(":")[0]}</text>
            <text x={cx} y={H - padB + 30} textAnchor="middle" fontSize={9.5} fill={AXIS}>{s.label.includes(":") ? s.label.split(": ")[1] : ""}</text>
            <text x={cx} y={H - padB + 44} textAnchor="middle" fontSize={9} fill={AXIS}>n = {WE_ORDER.map((w) => s.byWe[w].n).join(" / ")}</text>
          </g>
        );
      })}
    </svg>
  );
}

// "How many prospect-potential points is each grade worth?" -- point estimate + 95% CI
// against reference lines at +/-3 (the constants Draft Value currently assumes).
export function PointsEquivalent({ model }: { model: NonNullable<WorkEthicReport["model"]> }) {
  const W = 620, H = 150, padL = 70, padR = 24;
  const rows: { key: WorkEthic; v: number | null; ci: [number, number] | null }[] = [
    { key: "H", v: model.highPointsEquiv, ci: model.highPointsCi },
    { key: "L", v: model.lowPointsEquiv, ci: model.lowPointsCi },
  ];
  const all = rows.flatMap((r) => (r.ci ? [r.ci[0], r.ci[1], r.v ?? 0] : [])).concat([-3, 3]);
  const bound = Math.max(6, Math.ceil(Math.max(...all.map(Math.abs)) / 2) * 2);
  const x = (v: number) => padL + ((v + bound) / (2 * bound)) * (W - padL - padR);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Prospect-potential points equivalent of High and Low work ethic" style={{ width: "100%", maxWidth: 680, height: "auto" }}>
      <line x1={x(0)} x2={x(0)} y1={12} y2={H - 34} stroke="var(--color-border-strong, #888)" strokeWidth={1.2} />
      {[-3, 3].map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={12} y2={H - 34} stroke={AXIS} strokeWidth={1} strokeDasharray="4 3" />
          <text x={x(v)} y={H - 22} textAnchor="middle" fontSize={10} fill={AXIS}>Draft Value {v > 0 ? "+3" : "−3"}</text>
        </g>
      ))}
      <text x={x(0)} y={H - 22} textAnchor="middle" fontSize={10} fill={AXIS}>Normal</text>
      {[-bound, bound].map((v) => <text key={v} x={x(v)} y={H - 6} textAnchor="middle" fontSize={10} fill={AXIS}>{v > 0 ? `+${v}` : v} pts</text>)}
      {rows.map((r, i) => {
        const cy = 40 + i * 44;
        return (
          <g key={r.key}>
            <text x={padL - 10} y={cy + 4} textAnchor="end" fontSize={13} fontWeight={700} fill={WE_COLOR[r.key]}>{WE_LABEL[r.key]}</text>
            {r.v !== null && r.ci ? (
              <>
                <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={cy} y2={cy} stroke={WE_COLOR[r.key]} strokeWidth={3} opacity={0.55} />
                <circle cx={x(r.v)} cy={cy} r={6} fill={WE_COLOR[r.key]} />
                <text x={x(r.v)} y={cy - 11} textAnchor="middle" fontSize={11} fontWeight={700} fill={TEXT}>{r.v > 0 ? "+" : ""}{r.v.toFixed(1)}</text>
              </>
            ) : <text x={x(0) + 10} y={cy + 4} fontSize={11} fill={AXIS}>not estimable</text>}
          </g>
        );
      })}
    </svg>
  );
}
