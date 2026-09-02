import {
  getRoleLevelBenchmarks, getActiveWeightSet, getRoleRepresentation, getHandednessSplits, getCalibrationAnchor,
  type RoleRepresentationRow, type RoleLevelBenchmarkRow,
} from "../../lib/queries";
import { levelLabel, CANONICAL_LEVELS } from "../../lib/display-helpers";

export const dynamic = "force-dynamic";

// MLB/AAA/AA/A+/A/A-/Rookie/International -- see effectiveLevel() in
// lib/display-helpers.ts for the full canonical-level mapping.
const LEVELS = CANONICAL_LEVELS;

// How many players deep the Role Representation tables look (Rees's call).
const ROLE_REP_LIMIT = 100;

const sectionTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.1875rem",
  fontWeight: 700,
  margin: "0 0 0.5rem",
  color: "var(--color-heading)",
} as const;

const subTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1rem",
  fontWeight: 700,
  margin: "1.25rem 0 0.375rem",
  color: "var(--color-heading)",
} as const;

const bodyTextStyle = {
  fontSize: "0.9375rem",
  color: "var(--color-text)",
  lineHeight: 1.6,
  maxWidth: "72ch",
} as const;

const noteStyle = {
  ...bodyTextStyle,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
} as const;

const formulaStyle = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.8125rem",
  background: "var(--color-table-header, #e8e0d4)",
  padding: "0.625rem 0.875rem",
  borderRadius: "var(--radius-sm)",
  display: "block",
  margin: "0.5rem 0 0.75rem",
  maxWidth: "72ch",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
} as const;

const fmt1 = (n: number | null) => (n === null ? "—" : n.toFixed(1));
const fmt3 = (n: number | null) => (n === null ? "—" : n.toFixed(3));

// Real defensive-spectrum priority order used in rating-engine.ts's Role
// bucket logic -- documented here as data, not re-derived, so this table
// always matches the actual code.
const ROLE_PRIORITY = [
  { role: "C", rule: "pot_c ≥ 50, OR pot_c ≥ 45 AND cblk ≥ 50 AND cfrm ≥ 50" },
  { role: "SS", rule: "pot_ss ≥ 55 AND ifr ≥ 65" },
  { role: "CF", rule: "pot_cf ≥ 55 AND ofr ≥ 65" },
  { role: "INF (2B/3B)", rule: "ifr ≥ 50" },
  { role: "COF (LF/RF)", rule: "max(pot_lf, pot_rf) ≥ 50 AND ofr ≥ 50" },
  { role: "1B", rule: "pot_1b ≥ 55" },
  { role: "DH", rule: "fallback — didn't clear any bar above" },
];

const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtIndex = (n: number) => n.toFixed(0);

function RoleRepresentationTable({ rows, baselineLabel, limit }: { rows: RoleRepresentationRow[]; baselineLabel: string; limit: number }) {
  return (
    <div className="table-wrap" style={{ marginTop: "0.5rem", marginBottom: "1rem", maxWidth: "44rem" }}>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Top {limit} count</th>
            <th>Top {limit} %</th>
            <th>% {baselineLabel}</th>
            <th>Index</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.role}>
              <td style={{ fontWeight: 700 }}>{r.role}</td>
              <td>{r.topCount}</td>
              <td>{fmtPct(r.topPct)}</td>
              <td>{fmtPct(r.baselinePct)}</td>
              <td
                style={
                  r.index >= 130
                    ? { fontWeight: 700, color: "#dc2626" }
                    : r.index <= 70
                      ? { fontWeight: 700, color: "#2563eb" }
                      : undefined
                }
              >
                {fmtIndex(r.index)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-state">No data available.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RoleLevelBenchmarkTable({ rows }: { rows: RoleLevelBenchmarkRow[] }) {
  return (
    <div className="table-wrap" style={{ marginTop: "1rem", marginBottom: "1rem", maxWidth: "60rem" }}>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            {LEVELS.map((l) => (
              <th key={l}>{levelLabel(l)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.role}>
              <td style={{ fontWeight: 700 }}>{row.role}</td>
              {row.byLevel.map((cell) => (
                <td key={cell.level} style={cell.level === 1 ? { fontWeight: 700, color: "var(--color-heading)" } : undefined}>
                  {cell.avgValue === null ? (
                    "—"
                  ) : (
                    <>
                      {fmt1(cell.avgValue)}
                      <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", marginLeft: 4 }}>
                        (n={cell.n})
                      </span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={LEVELS.length + 1} className="empty-state">No data available.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function WeightRow({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <tr>
      <td>{label}</td>
      <td style={{ fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</td>
    </tr>
  );
}

export default async function GlossaryPage() {
  const [benchmarks, battingBenchmarks, fieldingBenchmarks, weights, roleRep, handSplits, calibration] = await Promise.all([
    getRoleLevelBenchmarks("overall"),
    getRoleLevelBenchmarks("batting"),
    getRoleLevelBenchmarks("fielding"),
    getActiveWeightSet(),
    getRoleRepresentation(ROLE_REP_LIMIT),
    getHandednessSplits(),
    getCalibrationAnchor(),
  ]);
  const { byOverall: roleRepByOverall, byProspectPotential: roleRepByProspectPotential } = roleRep;

  return (
    <>
      <header className="page-header">
        <h1>Glossary</h1>
        <p>Every formula behind the ratings, current values, and the diagnostic tables used to tune them.</p>
      </header>

      {/* ================= ROLE REPRESENTATION (WEIGHT-TESTING) ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Role Representation — Weight-Testing Diagnostic</h2>
        <p style={bodyTextStyle}>
          Is a role over- or under-valued by the active weights? Each table compares a role&apos;s share of the top{" "}
          {ROLE_REP_LIMIT} against that same role&apos;s share of the full population it&apos;s drawn from.{" "}
          <strong>Index</strong> = 100 means proportional representation; meaningfully above/below means the weights
          are pulling it up/down.
        </p>
        <p style={noteStyle}>
          Read the Index next to the Role bucket definitions further down, not in isolation — a narrow bucket (e.g. SS)
          over-indexes almost by construction, since only a genuinely small, elite population clears its bar. DH is
          the mirror case (the pure fallback bucket). Neither is evidence of a weighting problem by itself — what&apos;s
          worth a closer look is a role whose bucket definition is <em>not</em> unusually narrow or wide but still
          shows a large Index.
        </p>
        <h3 style={subTitleStyle}>By Overall (top {ROLE_REP_LIMIT}, league-wide)</h3>
        <RoleRepresentationTable rows={roleRepByOverall} baselineLabel="of all ranked players" limit={ROLE_REP_LIMIT} />
        <h3 style={subTitleStyle}>By Prospect Potential (top {ROLE_REP_LIMIT} of the prospect pool)</h3>
        <p style={noteStyle}>Baseline is each role&apos;s share of the prospect pool, not the full league.</p>
        <RoleRepresentationTable rows={roleRepByProspectPotential} baselineLabel="of the prospect pool" limit={ROLE_REP_LIMIT} />
      </section>

      {/* ================= ROLE × LEVEL BENCHMARKS ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Role × Level Benchmarks</h2>
        <p style={bodyTextStyle}>
          Average <strong>calibrated</strong> Overall/Batting/Fielding of every player currently at each level, by
          Role. MLB is restricted to the real active roster (excludes DFA&apos;d players and international/complex
          signees mistagged at level 1, which get their own column one rung below Rookie).
        </p>
        <h3 style={subTitleStyle}>Overall</h3>
        <RoleLevelBenchmarkTable rows={benchmarks} />
        <h3 style={subTitleStyle}>Batting</h3>
        <RoleLevelBenchmarkTable rows={battingBenchmarks} />
        <h3 style={subTitleStyle}>Fielding</h3>
        <RoleLevelBenchmarkTable rows={fieldingBenchmarks} />
      </section>

      {/* ================= RATING SYSTEM OVERVIEW ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Rating System Overview</h2>
        <p style={bodyTextStyle}>
          Every player gets four component composites — <strong>Hitting</strong> (Batting), <strong>Fielding</strong>,{" "}
          <strong>Baserunning</strong>, and <strong>Pitching</strong> — each computed twice, once from current grades
          and once from <code>pot_*</code> grades. Those blend into <strong>Overall</strong> and{" "}
          <strong>Potential</strong>, which blend into <strong>Prospect Potential</strong>. A final{" "}
          <strong>calibration</strong> step rescales Overall/Potential/Prospect Potential so hitters and pitchers
          read on the same 20–80-style ruler before anything is ranked or displayed. All of it lives in{" "}
          <code>lib/rating-engine.ts</code> (component formulas) and <code>scripts/compute-ratings.ts</code>{" "}
          (role gates, ranks, calibration) — every weight below is a live column in <code>rating_weights</code>, not
          a hardcoded constant, so a re-tune is a data change, never a code change.
        </p>
        <p style={noteStyle}>
          &quot;Overall&quot;/&quot;Potential&quot; anywhere on this site means <em>our</em> computed values below —
          never the raw <code>ovr</code>/<code>pot</code> fields StatsPlus reports, which are kept only as a
          comparison baseline and never read as an input.
        </p>

        <h3 style={subTitleStyle}>Active weight set</h3>
        <p style={bodyTextStyle}>
          {weights ? (
            <>
              <strong>#{weights.id} — {weights.label}</strong>
            </>
          ) : (
            "No active weight set found."
          )}
        </p>
        {weights && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Hitting</th></tr></thead>
                <tbody>
                  <WeightRow label="Contact" value={weights.contact} />
                  <WeightRow label="Power" value={weights.power} />
                  <WeightRow label="Eye" value={weights.eye} />
                  <WeightRow label="Gap" value={weights.gap} />
                  <WeightRow label="Avoid Ks" value={weights.avoid_ks} />
                  <WeightRow label="Speed" value={weights.speed} />
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Overall/Potential blend</th></tr></thead>
                <tbody>
                  <WeightRow label="Batting" value={weights.batting} />
                  <WeightRow label="Fielding" value={weights.fielding} />
                  <WeightRow label="Baserunning" value={weights.baserunning} />
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Baserunning (internal)</th></tr></thead>
                <tbody>
                  <WeightRow label="Speed" value={weights.baserunning_speed_weight} />
                  <WeightRow label="Run" value={weights.baserunning_run_weight} />
                  <WeightRow label="Steal" value={weights.baserunning_steal_weight} />
                  <WeightRow label="Steal tendency" value={weights.baserunning_stlrt_weight} />
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Pitching — SP</th></tr></thead>
                <tbody>
                  <WeightRow label="Stuff" value={weights.sp_stuff} />
                  <WeightRow label="Movement" value={weights.sp_movement} />
                  <WeightRow label="Control" value={weights.sp_control} />
                  <WeightRow label="Stamina" value={weights.sp_stamina} />
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Pitching — RP</th></tr></thead>
                <tbody>
                  <WeightRow label="Stuff" value={weights.rp_stuff} />
                  <WeightRow label="Movement" value={weights.rp_movement} />
                  <WeightRow label="Control" value={weights.rp_control} />
                  <WeightRow label="Stamina" value={weights.rp_stamina} />
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Pitching — shared</th></tr></thead>
                <tbody>
                  <WeightRow label="PBABIP" value={weights.pbabip} />
                  <WeightRow label="QP multiplier" value={weights.qp_multiplier} />
                  <WeightRow label="QP / QPP threshold" value={`${weights.qp_threshold} / ${weights.qpp_threshold}`} />
                  <WeightRow label="SP/RP stamina threshold" value={weights.sp_rp_stamina_threshold} />
                  <WeightRow label="SP/RP min. quality pitches" value={weights.sp_rp_min_pitches} />
                  <WeightRow label="Relief value multiplier" value={weights.relief_value_multiplier} />
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Position bonuses</th></tr></thead>
                <tbody>
                  <WeightRow label="Catcher batting mult." value={weights.catcher_batting_multiplier} />
                  <WeightRow label="SS batting mult." value={weights.ss_batting_multiplier} />
                  <WeightRow label="CF batting mult." value={weights.cf_batting_multiplier} />
                  <WeightRow label="Catcher fielding bonus" value={weights.catcher_fielding_bonus} />
                  <WeightRow label="Infield fielding bonus" value={weights.infield_fielding_bonus} />
                  <WeightRow label="Outfield fielding bonus" value={weights.outfield_fielding_bonus} />
                </tbody>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "20rem" }}>
              <table>
                <thead><tr><th colSpan={2}>Floor gates</th></tr></thead>
                <tbody>
                  <WeightRow label="Contact mid / low threshold" value={`${weights.contact_gate_mid_threshold} / ${weights.contact_gate_low_threshold}`} />
                  <WeightRow label="Contact mid / low mult." value={`${weights.contact_gate_mid_multiplier} / ${weights.contact_gate_low_multiplier}`} />
                  <WeightRow label="Control mid / low threshold" value={`${weights.control_gate_mid_threshold} / ${weights.control_gate_low_threshold}`} />
                  <WeightRow label="Control mid / low mult." value={`${weights.control_gate_mid_multiplier} / ${weights.control_gate_low_multiplier}`} />
                </tbody>
              </table>
            </div>
          </div>
        )}

        <h3 style={subTitleStyle}>League handedness splits</h3>
        <p style={bodyTextStyle}>
          Contact/Gap/Power/Eye/Avoid-Ks and Stuff/Movement/PBABIP/Control are each blended by real league-wide MLB
          playing time vs. lefties/righties over the last 3 seasons ({handSplits.years.join("/")}) — not each
          player&apos;s own split history. Recomputed every refresh from real AB (hitters) / IP (pitchers). Speed has
          no split field and stays unblended; Potential isn&apos;t blended (StatsPlus exposes no{" "}
          <code>pot_*_l/_r</code> data) except where a projected split is extrapolated (see Hitting/Pitching below).
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "36rem" }}>
          <table>
            <thead><tr><th></th><th>vs. Left</th><th>vs. Right</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700 }}>Batting</td>
                <td>{(handSplits.battingPctVsL * 100).toFixed(2)}%</td>
                <td>{(handSplits.battingPctVsR * 100).toFixed(2)}%</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Pitching</td>
                <td>{(handSplits.pitchingPctVsL * 100).toFixed(2)}%</td>
                <td>{(handSplits.pitchingPctVsR * 100).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ================= HITTING ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Hitting (Batting)</h2>
        <code style={formulaStyle}>
          XBlend = X(vL)×vsL% + X(vR)×vsR%   — for Contact, Gap, Power, Eye, Avoid-Ks{"\n"}
          BattingRaw = ContactBlend×contact + AvoidKsBlend×avoid_ks + PowerBlend×power{"\n"}
          {"           "}+ GapBlend×gap + EyeBlend×eye + Speed×speed{"\n"}
          Batting = BattingRaw × PositionMultiplier × ContactGate{"\n"}
          {"\n"}
          Batting Potential = same shape, using each grade&apos;s projected potential split
        </code>
        <p style={bodyTextStyle}>
          <strong>PositionMultiplier</strong>: catcher/SS/CF batting multiplier if the player&apos;s computed Role
          (below) qualifies for that bucket, else 1 — rewards a bat at a genuinely scarce defensive spot, gated on
          actually being able to play it, not just being rostered there.
        </p>
        <p style={bodyTextStyle}>
          <strong>ContactGate</strong>: 1.0 above the mid threshold; a penalty multiplier below it, harsher below the
          low threshold (values in the Floor gates table above) — a real hit-tool problem drags the whole number
          down instead of averaging away. The potential side always applies. The current side applies only once
          Contact is <strong>fully developed</strong> — current Contact has caught up to Potential Contact — so a
          low-minors player whose Contact hasn&apos;t finished developing isn&apos;t penalized today for a weakness
          his own Potential says he&apos;ll grow out of; a player whose current Contact already sits at his ceiling
          gets the real, independently-computed penalty.
        </p>
      </section>

      {/* ================= FIELDING ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Fielding</h2>
        <p style={bodyTextStyle}>
          The best of three positional composites — a player counts only his strongest defensive value. No separate
          SS composite (shares Infield with 2B/3B) or CF composite (shares Outfield with LF/RF); any Role-level gap
          comes from real grade differences in the population, not a formula bonus.
        </p>
        <code style={formulaStyle}>
          Catcher = (Block + Framing×2 + Arm) / 4 + catcher_fielding_bonus{"\n"}
          Infield = (Range×2 + Error + Arm + Turn2B) / 5 + infield_fielding_bonus{"\n"}
          Outfield = (Range×2 + Error + Arm) / 4 + outfield_fielding_bonus{"\n"}
          Fielding = max(Catcher, Infield, Outfield)
        </code>
        <p style={noteStyle}>
          Same Fielding value feeds both Overall and Potential — no separate potential-side range grade exists in
          this data.
        </p>
      </section>

      {/* ================= BASERUNNING ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Baserunning</h2>
        <code style={formulaStyle}>
          Baserunning = Speed×baserunning_speed_weight + Run×baserunning_run_weight{"\n"}
          {"            "}+ Steal×baserunning_steal_weight + StealTendency×baserunning_stlrt_weight
        </code>
        <p style={bodyTextStyle}>
          Internal weights are regression-fit against real UBR/100 PA (R²=0.553) — Run dominates by design; it&apos;s
          the strongest real predictor once it&apos;s in the model, with Speed and Steal mostly redundant with it.
        </p>
      </section>

      {/* ================= PITCHING ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Pitching</h2>
        <code style={formulaStyle}>
          isRP = Stamina ≤ sp_rp_stamina_threshold  OR  QPP &lt; sp_rp_min_pitches{"\n"}
          Weights = (SP set) if starter role, (RP set) if reliever role{"\n"}
          {"\n"}
          XBlend = X(vL)×vsL% + X(vR)×vsR%   — for Stuff, Movement, PBABIP, Control{"\n"}
          PitchingRaw = (StuffBlend + 5 if real position = SP, else StuffBlend) × Stuff-weight{"\n"}
          {"            "}+ MovementBlend×Movement-weight + PbabipBlend×pbabip + ControlBlend×Control-weight{"\n"}
          {"            "}+ Stamina×Stamina-weight + QP×qp_multiplier{"\n"}
          Pitching = PitchingRaw × ControlGate × RoleValueMultiplier{"\n"}
          {"\n"}
          Pitching Potential (raw) = same shape with potential grades / QPP, × ControlGateP × RoleValueMultiplier{"\n"}
          Pitching Potential = max(Pitching, Pitching Potential (raw) − 3)
        </code>
        <p style={bodyTextStyle}>
          <strong>QP/QPP</strong>: count of individual pitch types (fastball, curveball, slider, changeup, sinker,
          splitter, cutter, forkball, circle change, screwball, knuckle-curve, knuckleball) grading at or above the
          QP/QPP threshold (current/potential respectively).
        </p>
        <p style={bodyTextStyle}>
          <strong>The +5 Stuff bonus</strong> keys on the player&apos;s real listed position (SP), independent of the
          Stamina/QPP role gate above — the two can disagree for a swingman.
        </p>
        <p style={bodyTextStyle}>
          <strong>RoleValueMultiplier</strong> = relief_value_multiplier if <code>isRP</code>, else 1 — a reliever&apos;s
          per-inning quality still isn&apos;t worth a rotation piece&apos;s real roster value, which the SP bonus and
          QP term alone don&apos;t sufficiently capture (a rate-stat regression can&apos;t discover role scarcity on
          its own).
        </p>
        <p style={bodyTextStyle}>
          <strong>ControlGate</strong>: same floor-penalty mechanism as Hitting&apos;s Contact gate, keyed on Control.
        </p>
      </section>

      {/* ================= OVERALL, POTENTIAL, PH ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Overall, Potential &amp; Hitter/Pitcher (PH)</h2>
        <code style={formulaStyle}>
          Overall = max(Batting×batting + Fielding×fielding_weight + Baserunning×baserunning, Pitching){"\n"}
          Potential = max(Batting Potential×batting + Fielding×fielding_weight + Baserunning×baserunning, Pitching Potential){"\n"}
          PH = &quot;H&quot; if (Batting×batting + Fielding×fielding_weight + Baserunning×baserunning) &gt; Pitching, else &quot;P&quot;
        </code>
        <p style={noteStyle}>
          <code>fielding_weight</code> = <code>fielding</code> × a per-Role calibrated multiplier (currently 1.0 for
          every role — the role-calibration table is retired but wired in as a harmless no-op).
        </p>

        <h3 style={subTitleStyle}>Calibration (display scale)</h3>
        <p style={bodyTextStyle}>
          The raw formula above isn&apos;t on the same ruler for hitters vs. pitchers — pitchers&apos; raw Overall
          runs both higher and meaningfully wider. Before anything is ranked, Overall/Potential/Prospect Potential
          are each rescaled per player type (from <code>PH</code>), anchored on that type&apos;s own real MLB-roster
          Overall distribution:
        </p>
        <code style={formulaStyle}>
          CalibratedX = max(0, 50 + 10 × (RawX − typeMean) / typeSD)
        </code>
        <p style={bodyTextStyle}>
          <code>typeMean</code>/<code>typeSD</code> are recomputed every refresh from that run&apos;s real MLB roster
          (<code>league_id = 200</code>, <code>mlb_service_days &gt; 0</code>) — never hand-tuned, so 50 always means
          &quot;today&apos;s real average player of that type.&quot; Current anchor (refresh {calibration.refreshRunId}):
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "28rem" }}>
          <table>
            <thead><tr><th></th><th>Mean</th><th>SD</th></tr></thead>
            <tbody>
              <tr><td style={{ fontWeight: 700 }}>Hitters</td><td>{fmt3(calibration.hitterMean)}</td><td>{fmt3(calibration.hitterSd)}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Pitchers</td><td>{fmt3(calibration.pitcherMean)}</td><td>{fmt3(calibration.pitcherSd)}</td></tr>
            </tbody>
          </table>
        </div>
        <p style={noteStyle}>
          Floored at 0, not ceiling-clamped — a true elite outlier can read above 80. The floor is a known, accepted
          tradeoff: it still flattens a real share of far-below-average/low-level players to an identical value
          (Rees&apos;s call — non-negative numbers over full differentiation at the bottom). The formula&apos;s
          untransformed output is preserved in <code>overall_raw</code>/<code>potential_raw</code>/
          <code>prospect_potential_raw</code> for pages that judge the raw formula itself (e.g. Rating Validation),
          rather than the display scale.
        </p>
      </section>

      {/* ================= PROSPECT POTENTIAL ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Prospect Potential</h2>
        <p style={bodyTextStyle}>
          What every prospect ranking sorts by — a risk-discounted blend of Potential and current Overall, not pure
          ceiling. Blending in Overall separates a college senior already close to his ceiling from a
          high-schooler with the same grades but years of developmental risk ahead, with no age/level special-casing.
        </p>
        <code style={formulaStyle}>
          RiskAdjusted = Potential − 5 if Prone is &quot;Fragile&quot; or &quot;Wrecked&quot;, else Potential{"\n"}
          Prospect Potential = RiskAdjusted + Overall×0.25 − 12.5
        </code>
        <p style={noteStyle}>
          Uses the same calibrated Overall/Potential as above (calibration is applied to Prospect Potential too, via
          the same per-type constants). Known gap: the original bust-risk discount also checked an &quot;Extreme/Very
          High&quot; Risk field alongside Prone — StatsPlus&apos;s feed only exposes Prone, so the discount applies
          from Prone alone.
        </p>
      </section>

      {/* ================= ROLE & CLASSIFICATION ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Role &amp; Classification</h2>

        <h3 style={subTitleStyle}>Role (position players)</h3>
        <p style={bodyTextStyle}>
          Evaluated top-to-bottom in real defensive-spectrum priority order — first match wins. Mixes{" "}
          <em>potential</em> position-fit grades with <em>current</em> range grades (no potential-range field exists
          in this data). Role = &quot;C&quot;/&quot;SS&quot;/&quot;CF&quot; is also what gates the premium-position
          batting multipliers above.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "36rem" }}>
          <table>
            <thead><tr><th>Priority</th><th>Role</th><th>Threshold</th></tr></thead>
            <tbody>
              {ROLE_PRIORITY.map((r, i) => (
                <tr key={r.role}><td>{i + 1}</td><td style={{ fontWeight: 700 }}>{r.role}</td><td>{r.rule}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={noteStyle}>Pitchers (real position SP/RP/CL) skip this table and take their Role from SP/RP below.</p>

        <h3 style={subTitleStyle}>SP / RP</h3>
        <p style={bodyTextStyle}>
          An on-field classification from stamina and pitch-mix depth — the SAME gate the Pitching formula above
          uses to pick a weight set, distinct from a player&apos;s real assigned position (which only feeds the
          Pitching formula&apos;s +5 Stuff bonus).
        </p>
        <code style={formulaStyle}>
          If Batting Potential &gt; Pitching Potential: no SP/RP label{"\n"}
          Else if Stamina ≤ {weights?.sp_rp_stamina_threshold ?? "—"} OR QPP &lt; {weights?.sp_rp_min_pitches ?? "—"}: RP{"\n"}
          Else: SP
        </code>

        <h3 style={subTitleStyle}>TBL Pos</h3>
        <p style={bodyTextStyle}>
          Every position a player&apos;s <em>potential</em> clears a bar for — a full list, not a single bucket
          (e.g. &quot;2B SS&quot;). Catcher&apos;s bar is 50; every other position uses 55. Pitchers show their SP/RP
          label here instead.
        </p>

        <h3 style={subTitleStyle}>Platoon</h3>
        <p style={bodyTextStyle}>
          Same Batting/Pitching formula shape, fed by vs-left/vs-right split grades instead of blended grades.
          Flagged only when the better side leads by more than 3 points <em>and</em> the weaker side falls under a
          viability bar (50 for hitters; for pitchers, only when neither side clears 60).
        </p>
      </section>

      {/* ================= RANKINGS ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Rankings</h2>
        <p style={bodyTextStyle}>
          All sorted on <strong>calibrated</strong> values (above), so a leaderboard mixing hitters and pitchers is
          comparing them fairly, not on the raw formula&apos;s output.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "56rem" }}>
          <table>
            <thead><tr><th>Field</th><th>Sorted by</th><th>Population</th></tr></thead>
            <tbody>
              <tr><td>Rank</td><td>Overall, descending</td><td>Every player, league-wide</td></tr>
              <tr><td>Potential Rank</td><td>Potential, descending</td><td>Every player, league-wide</td></tr>
              <tr><td>Prospect Rank</td><td>Prospect Potential, descending</td><td>The prospect pool only (below)</td></tr>
              <tr><td>Org Rank</td><td>Overall, descending</td><td>Every player, scoped to their own org</td></tr>
              <tr><td>Prospect Org Rank</td><td>Prospect Potential, descending</td><td>The prospect pool, scoped to their own org</td></tr>
              <tr><td>Prospect Role Rank</td><td>Prospect Potential, descending</td><td>The prospect pool, scoped to their own Role</td></tr>
            </tbody>
          </table>
        </div>
        <h3 style={subTitleStyle}>The prospect pool</h3>
        <p style={bodyTextStyle}>
          A player counts as a &quot;prospect&quot; only if <strong>all</strong> hold:
        </p>
        <code style={formulaStyle}>
          mlb_service_days &lt; 45  AND  age ≤ 25{"\n"}
          AND (currently rostered to an org, OR a genuine free agent with real pro history — has a last_team_id)
        </code>
        <p style={noteStyle}>
          The free-agent condition excludes amateur draft-pool players who&apos;ve never been rostered — they belong
          on the Draft page, not here.
        </p>
      </section>

      {/* ================= ETA ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>ETA (Top Prospects)</h2>
        <p style={bodyTextStyle}>
          How many years out a prospect projects to reach the majors, from an internal Role × Level average-Overall
          ladder (raw Overall — calibration-invariant, since every Role is exclusively one player type). No ETA at
          all if the player isn&apos;t in the prospect pool, or if Potential never clears his own Role&apos;s MLB bar.
        </p>
        <p style={bodyTextStyle}>
          His current Overall is interpolated onto that ladder to find a <strong>Suggested Level</strong> — where his
          actual ability already sits, independent of roster level — uniformly for every player, with no roster-level
          shortcut (a below-bar MLB call-up gets a real forward-looking ETA, not an automatic &quot;now&quot;).
        </p>
        <p style={bodyTextStyle}>
          Distance from Suggested Level to the majors converts to years at a pace set by how far{" "}
          <strong>Potential</strong> clears the MLB bar — how aggressively a team is likely to push him once he&apos;s
          physically able:
        </p>
        <div className="table-wrap" style={{ marginTop: "0.75rem", maxWidth: "36rem" }}>
          <table>
            <thead><tr><th>Potential above the MLB bar</th><th>Pace</th></tr></thead>
            <tbody>
              <tr><td>15+ (fast-tracked)</td><td>0.8 years per level</td></tr>
              <tr><td>8 to 15 (normal)</td><td>1.0 years per level</td></tr>
              <tr><td>0 to 8 (fringe)</td><td>1.3 years per level</td></tr>
            </tbody>
          </table>
        </div>
        <p style={noteStyle}>Recomputed fresh every refresh, alongside the rest of the rating engine.</p>
      </section>

      {/* ================= MINOR LEAGUE SYSTEM / TEAM RANKINGS ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Minor League System &amp; Team Rankings</h2>
        <p style={bodyTextStyle}>
          Org-level metrics from <code>scripts/compute-team-ratings.ts</code>, shown on Farm Rankings next to Top
          Prospects. Rewards a strong top-end (&quot;blue-chip&quot; talent), real depth beyond the headliners, and
          having both a strong batting <em>and</em> pitching pipeline. Full write-up: <code>system-rank-methodology.md</code>.
        </p>
        <p style={noteStyle}>
          Building block: <strong>Blue-Chip + Depth</strong> — within one org&apos;s H/P split, the top 3 prospects
          (by Prospect Potential) count at full value; everyone below is summed too, decayed as 1/(rank−3) — the 4th
          counts in full, the 5th at half, the 10th at a seventh. Summing (not averaging) rewards genuine depth.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "64rem" }}>
          <table>
            <thead><tr><th>Metric</th><th>Formula</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700 }}>Batting / Pitching Prospect Rank</td>
                <td>Blue-Chip + Depth score, computed on the org&apos;s hitters / pitchers only, ranked vs. every other org</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Minors Rank</td>
                <td>(Batting score + Pitching score) − 25% of the gap between them — a lopsided system can&apos;t out-rank a well-rounded one with the same total value</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Balance Index</td>
                <td>weaker split ÷ stronger split, 0–1 (1 = perfectly balanced) — display-only context, not part of the ranking math itself</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Readiness Rank</td>
                <td>Same Blue-Chip + Depth shape, using current Overall instead of Potential — how much value is already realized, not projected</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Roster Rank (Team OVR)</td>
                <td>Avg Overall of the org&apos;s top 18 players league-wide — current MLB roster strength, computed but not currently shown on any page</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={noteStyle}>
          Known gap: the original Team OVR also excluded players carrying a &quot;Serious Inj&quot; flag — a
          text-parsing heuristic on an injury string StatsPlus doesn&apos;t expose in the same form. Not carried over.
        </p>
      </section>
    </>
  );
}
