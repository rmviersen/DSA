import { Fragment } from "react";
import Link from "next/link";
import { getWorkEthicMlbReport, WE_ORDER, WE_LABEL } from "../../../../lib/work-ethic-report-query";
import type { GroupStat, StratumStat } from "../../../../lib/work-ethic-report-query";
import { resolveLeagueId } from "../../../../lib/league";
import { OverallBars, GroupedBars, PointsEquivalent } from "./WorkEthicCharts";

export const dynamic = "force-dynamic";

// Work Ethic vs. reaching the majors (2026-09-19, Rees's ask: "% of players that make
// the major leagues with low vs normal vs high work ethic... graphically... sample size
// and criteria... cater this towards adding work ethic into our prospect potential
// rating"). Owner-only automatically (under /admin). All numbers come from
// lib/work-ethic-report-query.ts; the cohort SQL is work_ethic_mlb_cohort().

const titleStyle = { fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.25rem", color: "var(--color-heading)" } as const;
const h2Style = { fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: "1.125rem", fontWeight: 700, margin: "2rem 0 0.5rem", color: "var(--color-heading)" } as const;
const muted = { color: "var(--color-text-muted, #888)" } as const;
const card = { border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 16px", background: "var(--color-surface)", marginBottom: 12 } as const;
const cell = { padding: "4px 10px", textAlign: "right" as const, borderBottom: "1px solid var(--color-border, #333)", whiteSpace: "nowrap" as const };
const cellL = { ...cell, textAlign: "left" as const };
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const AGE_OPTIONS = [22, 25, 28];

function GroupTable({ rows }: { rows: { label: string; g: Record<"L" | "N" | "H", GroupStat> }[] }) {
  return (
    <div className="table-wrap">
      <table style={{ fontSize: "0.8125rem", width: "auto" }}>
        <thead>
          <tr>
            <th style={cellL}></th>
            {WE_ORDER.map((w) => <th key={w} style={{ ...cell, textAlign: "center" }} colSpan={2}>{WE_LABEL[w]}</th>)}
          </tr>
          <tr>
            <th style={cellL}></th>
            {WE_ORDER.map((w) => (
              <Fragment key={w}>
                <th style={{ ...cell, ...muted, fontWeight: 400 }}>n</th>
                <th style={{ ...cell, ...muted, fontWeight: 400 }}>made MLB</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={cellL}>{r.label}</td>
              {WE_ORDER.map((w) => (
                <Fragment key={w}>
                  <td style={cell}>{r.g[w].n.toLocaleString()}</td>
                  <td style={cell}>{r.g[w].mlb} <span style={muted}>({r.g[w].n ? pct(r.g[w].pct) : "—"})</span></td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const stratumRows = (s: StratumStat[]) => s.map((x) => ({ label: x.label, g: x.byWe }));

export default async function WorkEthicMlbPage({ params, searchParams }: { params: Promise<{ league: string }>; searchParams: Promise<{ maxAge?: string }> }) {
  const { league } = await params;
  const sp = await searchParams;
  const leagueId = await resolveLeagueId(league);
  const maxAge = AGE_OPTIONS.includes(Number(sp.maxAge)) ? Number(sp.maxAge) : 25;
  const r = await getWorkEthicMlbReport(leagueId, maxAge);
  if (!r) return <div style={{ padding: "2rem" }}><h1 style={titleStyle}>Work Ethic &amp; the Majors</h1><p style={muted}>No refresh with ratings and a game date found yet.</p></div>;

  const m = r.model;
  const sig = (p: number) => (p < 0.05 ? "statistically significant" : p < 0.15 ? "suggestive but not conclusive" : "not distinguishable from no effect");
  const rawH = r.overall.H, rawN = r.overall.N, rawL = r.overall.L;

  return (
    <div style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={titleStyle}>Work Ethic &amp; the Majors</h1>
      <p style={{ ...muted, margin: "0 0 1rem", maxWidth: 780 }}>
        Do prospects with High work ethic reach the major leagues at a higher rate than Normal or Low &mdash; and, once our
        prospect potential is accounted for, is the difference big enough to justify building work ethic into it?
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8, fontSize: 13 }}>
        <span style={muted}>Age cutoff at baseline:</span>
        {AGE_OPTIONS.map((a) => (
          <Link key={a} href={`?maxAge=${a}`} style={{ padding: "2px 10px", border: "1px solid var(--color-border-strong)", borderRadius: 4, textDecoration: "none", background: a === maxAge ? "var(--color-navy)" : "transparent", color: a === maxAge ? "var(--color-text-on-navy)" : "inherit" }}>
            {a} &amp; under{a === 25 ? " (site's prospect definition)" : ""}
          </Link>
        ))}
      </div>

      {/* ── Sample & criteria ── */}
      <h2 style={h2Style}>Sample &amp; criteria</h2>
      <div style={card}>
        <p style={{ margin: "0 0 8px", fontSize: 13.5, lineHeight: 1.5 }}>
          <b>Cohort:</b> every player in our ratings snapshot from the <b>baseline date {r.baselineDate}</b> (refresh run {r.baselineRun} &mdash; the
          earliest snapshot with ratings we have) who had a Work Ethic grade and a computed prospect potential, was <b>{r.maxAge} or under</b> on that
          date, and had <b>not yet played in MLB before the {r.baselineYear} season</b>.
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 13.5, lineHeight: 1.5 }}>
          <b>Outcome (&ldquo;made MLB&rdquo;):</b> appeared in at least one MLB game (an MLB stat row) from the {r.baselineYear} season through
          the latest data{r.dataThrough ? ` (${r.dataThrough})` : ""} &mdash; a window of roughly <b>{Math.max(0, (new Date(r.dataThrough ?? r.baselineDate).getTime() - new Date(r.baselineDate).getTime()) / (365.25 * 86400000)).toFixed(1)} years</b>.
          Players who retired before reaching MLB count as &ldquo;did not&rdquo;. Work Ethic is the grade as recorded at the baseline
          snapshot; prospect potential is our computed value from that same snapshot.
        </p>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table style={{ fontSize: "0.8125rem", width: "auto" }}>
            <tbody>
              <tr><td style={cellL}>Players in the baseline ratings snapshot</td><td style={cell}>{r.totalInBaseline.toLocaleString()}</td></tr>
              {r.exclusions.map((e) => <tr key={e.key}><td style={{ ...cellL, ...muted }}>&minus; {e.label}</td><td style={{ ...cell, ...muted }}>{e.n.toLocaleString()}</td></tr>)}
              <tr><td style={{ ...cellL, fontWeight: 700 }}>Cohort analyzed</td><td style={{ ...cell, fontWeight: 700 }}>{r.cohortSize.toLocaleString()}</td></tr>
              <tr><td style={{ ...cellL, fontWeight: 700 }}>&hellip; of whom made MLB in the window</td><td style={{ ...cell, fontWeight: 700 }}>{r.totalMlb.toLocaleString()} ({pct(r.totalMlb / Math.max(1, r.cohortSize))})</td></tr>
            </tbody>
          </table>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.5, ...muted }}>
          <b>Read this with these limits in mind:</b> (1) Our ratings history starts mid-2031, so the look-forward window is short and only
          {" "}<b>{r.totalMlb}</b> cohort players have reached MLB so far &mdash; small counts mean wide uncertainty. (2) Players who retired
          before the baseline aren&apos;t in the ratings data at all (retired players have no ratings), so this can&apos;t see very early washouts.
          (3) Debuting is also a function of age and opportunity, which is why the model below controls for both. (4) Baseline prospect potential
          uses the weights that were active when that snapshot was computed. Re-run as more seasons accumulate &mdash; the window widens automatically.
        </p>
      </div>

      {/* ── Headline ── */}
      <h2 style={h2Style}>1. Who reaches the majors?</h2>
      <p style={{ ...muted, margin: "0 0 8px", fontSize: 13 }}>Share of the cohort that made MLB in the window, by Work Ethic. Whiskers are 95% confidence intervals (Wilson).</p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 460px", minWidth: 0 }}><OverallBars overall={r.overall} /></div>
        <div style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="table-wrap">
            <table style={{ fontSize: "0.8125rem", width: "auto" }}>
              <thead><tr><th style={cellL}></th><th style={cell}>n</th><th style={cell}>Made MLB</th><th style={cell}>Rate</th><th style={cell}>95% CI</th><th style={cell}>Retired, no MLB</th><th style={cell}>Still active, no MLB</th></tr></thead>
              <tbody>
                {WE_ORDER.map((w) => {
                  const g = r.overall[w];
                  return (
                    <tr key={w}>
                      <td style={cellL}>{WE_LABEL[w]}</td><td style={cell}>{g.n.toLocaleString()}</td><td style={cell}>{g.mlb}</td>
                      <td style={cell}>{pct(g.pct)}</td><td style={{ ...cell, ...muted }}>{pct(g.lo)}&ndash;{pct(g.hi)}</td>
                      <td style={cell}>{g.retiredNoMlb}</td><td style={cell}>{g.activeNoMlb.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.5, margin: "10px 0 0" }}>
            High-work-ethic prospects reached MLB at <b>{pct(rawH.pct)}</b> vs. <b>{pct(rawN.pct)}</b> for Normal and <b>{pct(rawL.pct)}</b> for Low
            {rawN.pct > 0 ? <> &mdash; <b>{(rawH.pct / rawN.pct).toFixed(1)}&times;</b> the Normal rate</> : null}. But this raw view can&apos;t tell work ethic apart from talent
            (better prospects may also be more likely to grade High), which is what the next two sections separate out.
          </p>
        </div>
      </div>

      {/* ── Controlled: potential tiers ── */}
      <h2 style={h2Style}>2. Holding talent constant &mdash; within prospect-potential tiers</h2>
      <p style={{ ...muted, margin: "0 0 8px", fontSize: 13 }}>
        The cohort split into fifths by our prospect potential at baseline. Within each tier, do High-work-ethic players still reach MLB more often?
        Bar labels are the number who made MLB; the n row shows group sizes (Low / Normal / High). Tiers with only a handful of MLB players are noisy.
      </p>
      <GroupedBars strata={r.byPotentialTier} />
      <GroupTable rows={stratumRows(r.byPotentialTier)} />

      <h2 style={h2Style}>3. Holding age constant</h2>
      <GroupedBars strata={r.byAge} height={260} />
      <GroupTable rows={stratumRows(r.byAge)} />

      {/* ── Model ── */}
      <h2 style={h2Style}>4. What would it be worth in prospect potential?</h2>
      {m ? (
        <>
          <p style={{ ...muted, margin: "0 0 8px", fontSize: 13, maxWidth: 820 }}>
            A logistic regression of &ldquo;made MLB&rdquo; on prospect potential, age, and Work Ethic (Normal = baseline), n = {m.n.toLocaleString()}, {m.events} MLB debuts
            {m.converged ? "" : " (did not fully converge — treat with caution)"}. Because prospect potential is in the model, the Work Ethic effect is the part of the
            debut advantage <i>not already explained by our rating</i>. Dividing it by the potential coefficient converts it into potential points:
            &ldquo;a High grade moves the odds of reaching MLB as much as N extra points of prospect potential.&rdquo;
          </p>
          <PointsEquivalent model={m} />
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table style={{ fontSize: "0.8125rem", width: "auto" }}>
              <thead><tr><th style={cellL}></th><th style={cell}>Odds ratio vs. Normal</th><th style={cell}>95% CI</th><th style={cell}>p</th><th style={cell}>Potential-point equivalent</th><th style={cell}>95% CI</th></tr></thead>
              <tbody>
                {([["High", m.highOdds, m.highOddsCi, m.highP, m.highPointsEquiv, m.highPointsCi], ["Low", m.lowOdds, m.lowOddsCi, m.lowP, m.lowPointsEquiv, m.lowPointsCi]] as const).map(([label, or, ci, p, eq, eqCi]) => (
                  <tr key={label}>
                    <td style={cellL}>{label}</td><td style={cell}>{or.toFixed(2)}</td><td style={{ ...cell, ...muted }}>{ci[0].toFixed(2)}&ndash;{ci[1].toFixed(2)}</td>
                    <td style={cell}>{p < 0.001 ? "<0.001" : p.toFixed(3)}</td>
                    <td style={cell}>{eq === null ? "—" : `${eq > 0 ? "+" : ""}${eq.toFixed(1)} pts`}</td>
                    <td style={{ ...cell, ...muted }}>{eqCi ? `${eqCi[0].toFixed(1)} to ${eqCi[1].toFixed(1)}` : "—"}</td>
                  </tr>
                ))}
                <tr><td style={{ ...cellL, ...muted }}>Prospect potential (per +1 pt)</td><td style={cell}>{Math.exp(m.ppCoef).toFixed(3)}</td><td style={{ ...cell, ...muted }}>{Math.exp(m.ppCoef - 1.96 * m.ppSe).toFixed(3)}&ndash;{Math.exp(m.ppCoef + 1.96 * m.ppSe).toFixed(3)}</td><td style={cell}>{m.ppP < 0.001 ? "<0.001" : m.ppP.toFixed(3)}</td><td style={cell}></td><td style={cell}></td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ ...card, marginTop: 12 }}>
            <b style={{ fontSize: 13.5 }}>Plain-English read</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.55 }}>
              <li>
                <b>High work ethic:</b> holding potential and age equal, the odds of reaching MLB are <b>{m.highOdds.toFixed(2)}&times;</b> those of a Normal-work-ethic peer
                ({sig(m.highP)}). {m.highPointsEquiv !== null && m.highPointsCi ? <>That is worth roughly <b>{m.highPointsEquiv > 0 ? "+" : ""}{m.highPointsEquiv.toFixed(1)}</b> prospect-potential points, but the honest range is {m.highPointsCi[0].toFixed(1)} to {m.highPointsCi[1].toFixed(1)}.</> : null}
              </li>
              <li>
                <b>Low work ethic:</b> odds are <b>{m.lowOdds.toFixed(2)}&times;</b> Normal ({sig(m.lowP)}).
                {m.lowPointsEquiv !== null && m.lowPointsCi ? <> Roughly <b>{m.lowPointsEquiv > 0 ? "+" : ""}{m.lowPointsEquiv.toFixed(1)}</b> points (range {m.lowPointsCi[0].toFixed(1)} to {m.lowPointsCi[1].toFixed(1)}).</> : null}
              </li>
              <li>
                <b>For reference:</b> Draft Value currently applies +3 / &minus;3 points for High / Low work ethic (a hand-picked first cut). The dashed lines above show where those sit
                against the estimate. If a 95% range includes zero, the data can&apos;t yet confirm the direction; if it includes both 0 and &plusmn;3, it can&apos;t confirm or reject the current constants either.
              </li>
              <li>
                <b>Caution:</b> this measures <i>reaching</i> MLB in a short window, not how good the player becomes, and the counts are small. Treat it as directional evidence for
                sizing an adjustment, not a precise coefficient &mdash; and revisit as seasons accumulate.
              </li>
            </ul>
          </div>
        </>
      ) : (
        <p style={{ ...muted, fontSize: 13 }}>Not enough players in this cohort to fit the model (needs at least 200).</p>
      )}
    </div>
  );
}
