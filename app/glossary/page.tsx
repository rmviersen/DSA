import { getRoleLevelBenchmarks, getActiveWeightSet, getRoleRepresentation, getHandednessSplits, type RoleRepresentationRow, type RoleLevelBenchmarkRow } from "../../lib/queries";
import { levelLabel } from "../../lib/display-helpers";

export const dynamic = "force-dynamic";

// Includes the synthetic International tier (7) alongside the six real
// players.level values -- see effectiveLevel() in lib/queries.ts.
const LEVELS = [1, 2, 3, 4, 5, 6, 7];

// How many players deep the Role Representation tables look. Was 100,
// widened to 200 on 2026-08-24 for a steadier sample, reverted back to 100
// on 2026-08-27 (Rees's call: "top 100 players and prospects") -- applies
// to both tables below, By Overall (players) and By Prospect Potential
// (prospects), since they share this one constant.
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

// Real defensive-spectrum priority order used in rating-engine.ts's Role
// bucket logic -- documented here as data, not re-derived, to keep the
// worked example below always in sync with the actual code.
const ROLE_PRIORITY = [
  { role: "C", rule: "pot_c ≥ 50, OR pot_c ≥ 45 AND cblk ≥ 50 AND cfrm ≥ 50" },
  { role: "SS", rule: "pot_ss ≥ 55 AND ifr ≥ 65" },
  { role: "CF", rule: "pot_cf ≥ 55 AND ofr ≥ 65" },
  { role: "INF (2B/3B)", rule: "ifr ≥ 50" },
  { role: "COF (LF/RF)", rule: "max(pot_lf, pot_rf) ≥ 50 AND ofr ≥ 50" },
  { role: "1B", rule: "pot_1b ≥ 55" },
  { role: "DH", rule: "fallback -- didn't clear any bar above" },
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

export default async function GlossaryPage() {
  const [benchmarks, battingBenchmarks, fieldingBenchmarks, weights, roleRep, handSplits] = await Promise.all([
    getRoleLevelBenchmarks("overall"),
    getRoleLevelBenchmarks("batting"),
    getRoleLevelBenchmarks("fielding"),
    getActiveWeightSet(),
    getRoleRepresentation(ROLE_REP_LIMIT),
    getHandednessSplits(),
  ]);
  const { byOverall: roleRepByOverall, byProspectPotential: roleRepByProspectPotential } = roleRep;

  return (
    <>
      <header className="page-header">
        <h1>Glossary</h1>
        <p>Every calculation, categorization, and ranking system behind the ratings — full precision, for internal reference only.</p>
      </header>

      {/* ================= ROLE REPRESENTATION (WEIGHT-TESTING) ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Role Representation — Weight-Testing Diagnostic</h2>
        <p style={bodyTextStyle}>
          Is any role being over- or under-valued by the current Weights (further down this page)? Raw top-{ROLE_REP_LIMIT}{" "}
          counts alone can&apos;t answer that on their own — a role that&apos;s just naturally common in the league
          would dominate a top-{ROLE_REP_LIMIT} list even under perfectly fair weights. So each table below compares
          a role&apos;s share of the top {ROLE_REP_LIMIT} against that <em>same</em> role&apos;s share of the full
          population it&apos;s drawn from. The <strong>Index</strong> column is the real signal: 100 means the role
          shows up in the top {ROLE_REP_LIMIT} exactly as often as you&apos;d expect from how common it is —
          meaningfully above 100 means the weights are pulling it up, meaningfully below means they&apos;re pulling
          it down.
        </p>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          <strong>Read the Index next to the Role bucket definitions further down, not in isolation</strong> — a
          narrow bucket will always over-index almost by construction. Confirmed real example (Rees 2026-08-24): SS
          reads as massively overrepresented (index in the 900s-1,200s) — but that&apos;s intentional, not a sign the
          weights need fixing. Very few players are capable of competent shortstop defense at all, so the ones who
          clear that bar (<code>pot_ss ≥ 55 AND ifr ≥ 65</code>) are a genuinely small, genuinely elite population —
          SS <em>should</em> be overrepresented near the top. DH is the mirror case: it&apos;s the pure fallback
          bucket for anyone who cleared no position-fit bar at all, so it&apos;s structurally full of marginal
          profiles and will always under-index. Neither of those is evidence of a weighting problem by itself —
          they&apos;re a property of how narrow or wide each bucket&apos;s definition is. What&apos;s actually worth
          a closer look is a role whose bucket definition is <em>not</em> unusually narrow or wide but still shows a
          large Index.
        </p>
        <h3 style={subTitleStyle}>By Overall (top {ROLE_REP_LIMIT} of every ranked player, league-wide)</h3>
        <RoleRepresentationTable rows={roleRepByOverall} baselineLabel="of all ranked players" limit={ROLE_REP_LIMIT} />
        <h3 style={subTitleStyle}>By Prospect Potential (top {ROLE_REP_LIMIT} of the prospect pool)</h3>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Baseline here is each role&apos;s share of the prospect pool itself, not the full league — comparing
          against the whole league would conflate &quot;this role is uncommon&quot; with &quot;this role isn&apos;t
          prospect-eligible,&quot; which isn&apos;t the question being asked.
        </p>
        <RoleRepresentationTable rows={roleRepByProspectPotential} baselineLabel="of the prospect pool" limit={ROLE_REP_LIMIT} />
      </section>

      {/* ================= ROLE × LEVEL BENCHMARKS ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Role × Level Benchmarks</h2>
        <p style={bodyTextStyle}>
          The average computed Overall of every player currently at each level, broken out by Role — the pipeline
          the ETA calculation (further down this page) is built from. The MLB column is restricted to the real
          active roster (excludes DFA&apos;d players and international/complex signees mistagged at level 1).
          International/complex signees get their own column instead, one rung below Rookie — they&apos;re stored at
          level 1 with a negative league_id rather than a real level code of their own, so they&apos;d otherwise be
          invisible to this table entirely. Batting and Fielding versions below (added 2026-08-24) apply the exact
          same aggregation, just averaging <code>player_computed.batting</code> / <code>.fielding</code> instead of{" "}
          <code>.overall</code> — useful for seeing whether a role&apos;s Overall benchmark is being driven mostly by
          its bat or its glove. SP/RP rows in the Batting/Fielding tables reflect whatever those pitchers&apos;
          incidental batting/fielding grades happen to be — pitchers aren&apos;t excluded from either table, same as
          they aren&apos;t excluded from Overall.
        </p>
        <h3 style={subTitleStyle}>Overall</h3>
        <RoleLevelBenchmarkTable rows={benchmarks} />
        <h3 style={subTitleStyle}>Batting</h3>
        <RoleLevelBenchmarkTable rows={battingBenchmarks} />
        <h3 style={subTitleStyle}>Fielding</h3>
        <RoleLevelBenchmarkTable rows={fieldingBenchmarks} />
      </section>

      {/* ================= OVERALL & POTENTIAL ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Overall &amp; Potential</h2>
        <p style={bodyTextStyle}>
          Everything downstream (Prospect Potential, Role, every rank, ETA) is built on two numbers computed for
          every player: <strong>Overall</strong> (how good they are right now) and <strong>Potential</strong> (how
          good they could become). Both come from the same shape of formula, just fed current grades vs.{" "}
          <code>pot_*</code> grades. &quot;Overall&quot;/&quot;Potential&quot; anywhere in this app means <em>our</em>{" "}
          computed values below — never the raw <code>ovr</code>/<code>pot</code> fields StatsPlus reports (the
          game&apos;s own scout grades), which are kept only as a comparison baseline and never read as an input.
        </p>

        <h3 style={subTitleStyle}>Weights (currently active set)</h3>
        <p style={bodyTextStyle}>
          {weights ? (
            <>
              <strong>#{weights.id} — {weights.label}.</strong>{weights.notes ? ` ${weights.notes}` : ""} Stored in
              the <code>rating_weights</code> table, not hardcoded — swapping the active row changes every formula
              below without a code change, so different weightings can be tested against the same historical data.
            </>
          ) : (
            "No active weight set found."
          )}
        </p>
        {weights && (
          <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "44rem" }}>
            <table>
              <thead>
                <tr><th>Weight</th><th>Value</th><th>Weight</th><th>Value</th></tr>
              </thead>
              <tbody>
                <tr><td>Contact</td><td>{weights.contact}</td><td>Stuff</td><td>{weights.stuff}</td></tr>
                <tr><td>Power</td><td>{weights.power}</td><td>Movement</td><td>{weights.movement}</td></tr>
                <tr><td>Eye</td><td>{weights.eye}</td><td>Control</td><td>{weights.control}</td></tr>
                <tr><td>Gap</td><td>{weights.gap}</td><td>Stamina</td><td>{weights.stamina}</td></tr>
                <tr><td>Avoid Ks</td><td>{weights.avoid_ks}</td><td>PBABIP</td><td>{weights.pbabip}</td></tr>
                <tr><td>Speed</td><td>{weights.speed}</td><td>QP multiplier</td><td>{weights.qp_multiplier}</td></tr>
                <tr><td>Fielding</td><td>{weights.fielding}</td><td>QP / QPP threshold</td><td>{weights.qp_threshold} / {weights.qpp_threshold}</td></tr>
                <tr><td>SP/RP stamina threshold</td><td>{weights.sp_rp_stamina_threshold}</td><td>SP/RP min. quality pitches</td><td>{weights.sp_rp_min_pitches}</td></tr>
                <tr><td>Catcher batting multiplier</td><td>{weights.catcher_batting_multiplier}</td><td>Catcher fielding bonus</td><td>{weights.catcher_fielding_bonus}</td></tr>
                <tr><td>SS batting multiplier</td><td>{weights.ss_batting_multiplier}</td><td>Infield fielding bonus</td><td>{weights.infield_fielding_bonus}</td></tr>
                <tr><td>CF batting multiplier</td><td>{weights.cf_batting_multiplier}</td><td>Outfield fielding bonus</td><td>{weights.outfield_fielding_bonus}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        <h3 style={subTitleStyle}>League Handedness Splits (Rees 2026-08-24)</h3>
        <p style={bodyTextStyle}>
          Contact, Gap, Power, Eye, and K%avoid (hitters) and Stuff, Movement, PBABIP, and Control (pitchers) are each
          fed by a separate scout grade for facing a lefty vs. a righty. Rather than average those two grades evenly,
          each one is blended by how much of <em>real</em> MLB playing time over the last three seasons actually came
          against that handedness — a league-wide constant applied uniformly to every player, not each player&apos;s
          own personal split history. Hitters are weighted by real MLB at-bats; pitchers by real MLB innings pitched
          (per Rees&apos;s spec — AB for the batting side, IP for the pitching side). Recomputed fresh every refresh
          from <code>player_batting_stats_snapshots</code> / <code>player_pitching_stats_snapshots</code>, restricted
          to <code>level = 1</code> players and <code>split_id 2</code> (vs-LHP/vs-LHB) / <code>3</code>{" "}
          (vs-RHP/vs-RHB) — reverse-engineered from real AB/IP totals, not documented anywhere by StatsPlus.
          <strong> K%avoid was missed in the first pass of this change</strong> and briefly left unblended despite
          having full <code>ks_l</code>/<code>ks_r</code> data — caught by Rees 2026-08-24 comparing this page against
          the code, fixed the same day. Speed is the only Batting component genuinely excluded: it has no{" "}
          <code>_l</code>/<code>_r</code> split field in this data at all. Potential is deliberately left out of this
          for now: StatsPlus doesn&apos;t expose <code>pot_*</code> grades broken out by handedness, so Batting
          Potential / Pitching Potential still use the single unsplit potential grades. Platoon (further down this
          page) is unaffected — it exists specifically to measure the raw vs-L/vs-R gap, so it still reads the
          unblended split grades directly.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "36rem" }}>
          <table>
            <thead><tr><th></th><th>vs. Left</th><th>vs. Right</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700 }}>Batting (real MLB AB, {handSplits.years.join("/")})</td>
                <td>{(handSplits.battingPctVsL * 100).toFixed(2)}%</td>
                <td>{(handSplits.battingPctVsR * 100).toFixed(2)}%</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Pitching (real MLB IP, {handSplits.years.join("/")})</td>
                <td>{(handSplits.pitchingPctVsL * 100).toFixed(2)}%</td>
                <td>{(handSplits.pitchingPctVsR * 100).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 style={subTitleStyle}>Batting / Batting Potential</h3>
        <code style={formulaStyle}>
          CntctBlend = Cntct(vL)×vsL% + Cntct(vR)×vsR% — and the same blend shape for Gap, Pow, Eye, and K%avoid{"\n"}
          BattingRaw = CntctBlend×contact + K%avoidBlend×avoid_ks + PowBlend×power + GapBlend×gap + EyeBlend×eye + Speed×speed{"\n"}
          Batting = BattingRaw × (catcher_batting_multiplier if Role=&quot;C&quot;, ss_batting_multiplier if Role=&quot;SS&quot;, cf_batting_multiplier if Role=&quot;CF&quot;, else ×1){"\n"}
          Batting Potential = (same shape, using unsplit pot_cntct / pot_ks / pot_pow / pot_gap / pot_eye — Speed has no potential grade, current value used for both — same Role-based multiplier applied)
        </code>
        <p style={bodyTextStyle}>
          <strong>Premium-position batting multipliers (Rees 2026-08-24).</strong> Catcher, SS, and CF are baseball&apos;s
          three genuinely scarce defensive spots — very few players can competently field any of them, so a player
          who can <em>also</em> hit at a premium spot is rarer than the same bat at an easier position. Fielding&apos;s
          own bonuses don&apos;t fully capture that: the catcher bonus is diluted 4x by <code>fielding_weight</code>{" "}
          before it reaches Overall, and SS/CF have no bonus of their own at all — they share a Fielding composite
          with a non-premium role (SS with INF, CF with COF; see Fielding below), so any gap between e.g. SS and INF
          in the benchmark tables above comes only from real grade differences in the population, never a formula-level
          reward. These three multipliers scale a player&apos;s own Batting output directly instead. Each is gated on
          the computed <strong>Role</strong> bucket (below), <em>not</em> the raw StatsPlus position field — a player
          rostered at catcher/short/center whose glove doesn&apos;t clear that position&apos;s Role bar falls through
          to another bucket and gets none of this, so only players actually capable of playing the position at the
          MLB level are rewarded, never a bat-only player who happens to be listed there. Mutually exclusive by
          construction (same as Role itself — a player can only ever match one bucket).
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", marginBottom: "0.5rem", maxWidth: "40rem" }}>
          <table>
            <thead><tr><th>Role</th><th>Multiplier</th><th>Index (Overall)</th><th>Index (Prospect Potential)</th></tr></thead>
            <tbody>
              <tr><td style={{ fontWeight: 700 }}>C</td><td>{weights?.catcher_batting_multiplier ?? "—"}</td><td>131</td><td>202</td></tr>
              <tr><td style={{ fontWeight: 700 }}>SS</td><td>{weights?.ss_batting_multiplier ?? "—"}</td><td>860</td><td>733</td></tr>
              <tr><td style={{ fontWeight: 700 }}>CF</td><td>{weights?.cf_batting_multiplier ?? "—"}</td><td>358</td><td>688</td></tr>
            </tbody>
          </table>
        </div>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          <strong>History and current calibration (2026-08-24):</strong> Catcher started at 1.03 (paired with the
          fielding bonus still at +15), landing at 108/154. A same-day test of fully removing the fielding-side
          catcher/infield bonuses without any multiplier change showed the multiplier alone couldn&apos;t replace a
          fully-removed bonus — Catcher&apos;s Index crashed to 24/12 (see Fielding below) — so instead the fielding
          bonus was trimmed to +12 (not removed) and Infield&apos;s was removed entirely, landing Catcher at 108/131
          with the multiplier still at 1.03. Rees then set catcher_batting_multiplier = 1.05 and introduced{" "}
          ss_batting_multiplier / cf_batting_multiplier = 1.025 each, landing at the numbers in the table above.{" "}
          <strong>Worth noting</strong>: SS and CF&apos;s Indices are now substantially higher than Catcher&apos;s
          despite a smaller multiplier (1.025 vs. 1.05) — because SS and CF are much narrower buckets to begin with
          (0.9%/1.3% of the ranked population vs. Catcher&apos;s 4.2%), the same proportional lift moves their Index
          much further. SS/CF were already reading as heavily overrepresented before any multiplier existed (see the
          Role Representation section&apos;s note on narrow buckets) — this compounds on top of that, not instead of
          it.
        </p>

        <h3 style={subTitleStyle}>Fielding</h3>
        <p style={bodyTextStyle}>
          The best of three composite defensive scores — a player only &quot;counts&quot; their strongest defensive
          value, whichever position that is. Note there&apos;s no separate SS composite (SS shares Infield with
          2B/3B) or CF composite (CF shares Outfield with LF/RF) — the gap between e.g. SS and INF in the Role ×
          Level Fielding table above comes entirely from real underlying grade differences in the population, not
          from a formula-level positional bonus. Catcher and Infield <em>do</em> get an explicit flat bonus baked in
          (below) — tunable, not hardcoded.
        </p>
        <code style={formulaStyle}>
          Catcher = (Block + Framing + Arm) / 3 + catcher_fielding_bonus{"\n"}
          Infield = (Range×2 + Error + Arm + Turn2B) / 5 + infield_fielding_bonus{"\n"}
          Outfield = (Range×2 + Error + Arm) / 4 + outfield_fielding_bonus{"\n"}
          Fielding = max(Catcher, Infield, Outfield)
        </code>
        <p style={bodyTextStyle}>
          Current values: catcher_fielding_bonus = {weights?.catcher_fielding_bonus ?? "—"}, infield_fielding_bonus ={" "}
          {weights?.infield_fielding_bonus ?? "—"}, outfield_fielding_bonus = {weights?.outfield_fielding_bonus ?? "—"}.
          Were hardcoded (+15/+5/+0) until 2026-08-24, when Rees asked to test removing the catcher and infield
          bonuses entirely — parameterized instead of just deleted, so testing is a data change, not a code change.
        </p>
        <p style={bodyTextStyle}>
          <strong>First test (+15/+5 → 0/0, same day)</strong> confirmed the bonuses were doing real work but that{" "}
          <code>catcher_batting_multiplier</code> alone couldn&apos;t replace a fully-removed catcher bonus — 1.03
          was only ever sized to offset the old bonus&apos;s <em>diluted</em> Overall contribution (+15 ×{" "}
          fielding_weight ≈ +3.75 points), not its full raw value, so zeroing it out dropped Catcher&apos;s Role
          Representation Index to 24 by Overall / 12 by Prospect Potential — worse than before any of this
          session&apos;s catcher work.
        </p>
        <p style={bodyTextStyle}>
          <strong>Landed on catcher_fielding_bonus = 12, infield_fielding_bonus = 0 (Rees&apos;s call, same day)</strong> —
          a partial trim on Catcher rather than a full removal, paired with the existing 1.03 batting multiplier
          left unchanged, and a full removal on Infield/SS (which share one Infield composite — there&apos;s no
          separate SS formula). Result: Catcher&apos;s Index landed at 108 by Overall and 131 by Prospect Potential —
          both closer to proportional than the 108/154 the 1.03 multiplier alone produced with the bonus still at
          +15, without touching the multiplier at all. INF&apos;s Index (which had no principled reason to carry a
          defensive bonus in the first place) dropped from its earlier 171/254 to a less-inflated 141/213. SS moved
          to 631/611 purely as a side effect of losing the same shared Infield bonus, not from any direct SS reward —
          no SS or CF batting multiplier exists yet; that remains open if Rees wants to pursue it further.
        </p>

        <h3 style={subTitleStyle}>Quality Pitches (QP / QPP)</h3>
        <p style={bodyTextStyle}>
          A simple count: how many of a pitcher&apos;s individual pitches (fastball, curveball, slider, changeup,
          sinker, splitter, cutter, forkball, circle change, screwball, knuckle-curve, knuckleball) grade at or
          above the QP threshold ({weights?.qp_threshold ?? "—"} for current pitches, {weights?.qpp_threshold ?? "—"}{" "}
          for potential). This count feeds directly into the Pitching formula below as a bonus, not just a display
          stat.
        </p>

        <h3 style={subTitleStyle}>Pitching / Pitching Potential</h3>
        <code style={formulaStyle}>
          StuffBlend = Stuff(vL)×vsL% + Stuff(vR)×vsR% — and the same blend shape for Movement, PBABIP, and Control{"\n"}
          Pitching = (StuffBlend + 5 if a real Starter, else StuffBlend)×stuff + MovementBlend×movement + PBABIPBlend×pbabip + ControlBlend×control + Stamina×stamina + QP×qp_multiplier{"\n"}
          Pitching Potential (raw) = (same shape, using unsplit pot_stf / pot_mov / pot_pbabip / pot_ctrl, current Stamina used for both, QPP instead of QP)
        </code>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Stamina has no vs-L/vs-R split field in this data at all, so it stays a single unsplit grade on both the
          current and potential side (Rees confirmed 2026-08-24: leave as-is).
        </p>
        <p style={bodyTextStyle}>
          <strong>Potential is floored at current ability</strong> — Pitching Potential can never come in more than 3
          points below current Pitching, as a sanity guard against &quot;potential&quot; ever reading lower than
          what a player has already shown:
        </p>
        <code style={formulaStyle}>Pitching Potential = max(Pitching, Pitching Potential (raw) − 3)</code>

        <h3 style={subTitleStyle}>Overall, Potential, and Hitter/Pitcher (PH)</h3>
        <code style={formulaStyle}>
          Overall = max(Batting + Fielding×fielding_weight, Pitching){"\n"}
          Potential = max(Batting Potential + Fielding×fielding_weight, Pitching Potential){"\n"}
          PH = &quot;H&quot; if (Batting + Fielding×fielding_weight) &gt; Pitching, else &quot;P&quot;
        </code>
      </section>

      {/* ================= PROSPECT POTENTIAL ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Prospect Potential</h2>
        <p style={bodyTextStyle}>
          The metric every prospect ranking (Prospect Rank, Org Rank, Minors Rank, Batting/Pitching Prospect Rank)
          actually sorts by — a risk-discounted blend of Potential and current Overall, not pure ceiling. Blending in
          Overall is deliberate: it naturally separates a college senior already close to his ceiling from a
          high-schooler with the same grades but years of developmental risk ahead of him, with no special-casing
          needed for age or level.
        </p>
        <code style={formulaStyle}>
          Bust risk: if Prone is &quot;Fragile&quot; or &quot;Wrecked&quot;, Potential − 5, else unchanged{"\n"}
          Prospect Potential = risk-adjusted Potential + Overall×0.25 − 12.5
        </code>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Known gap: RLB&apos;s original bust-risk discount also checked a &quot;Risk&quot; field (Extreme/Very
          High) alongside Prone — StatsPlus&apos;s ratings feed only exposes Prone, so this engine applies the
          discount from Prone alone. Flagged, not blocking.
        </p>
      </section>

      {/* ================= ROLE & CLASSIFICATION ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Role &amp; Classification</h2>

        <h3 style={subTitleStyle}>Role (position players)</h3>
        <p style={bodyTextStyle}>
          Evaluated top-to-bottom in real defensive-spectrum priority order — first match wins, so every player gets
          exactly one bucket. Deliberately mixes <em>potential</em> position-fit grades with <em>current</em> range
          grades (no potential-range field exists in this data — a real gap in what OOTP tracks, not a design
          choice). <strong>Role = &quot;C&quot;/&quot;SS&quot;/&quot;CF&quot; is also what gates the three premium-position
          batting multipliers</strong> (Overall &amp; Potential section above) — a player rostered at one of these
          positions whose grades don&apos;t clear the Role bar below falls through to another bucket entirely and
          does not get that position&apos;s multiplier, on the theory that a bat-only player StatsPlus happens to
          list there isn&apos;t the scarce thing being rewarded.
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
        <p style={bodyTextStyle}>
          Pitchers (real position SP/RP/CL) skip this table entirely and take their Role directly from the SP/RP
          classification below instead.
        </p>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          <strong>Catcher&apos;s second path added 2026-08-24 (Rees&apos;s spec).</strong> Surfaced by a real case —
          Alex Nuno (MIL), <code>pot_c</code> 45, was falling through to COF/DH under the single <code>pot_c ≥ 50</code>{" "}
          rule despite already blocking and framing at a 50 grade today, a real rostered catcher by any practical
          measure. Catching readiness isn&apos;t purely a ceiling question — a 45-potential backstop who already
          blocks and frames like a 50 is a real catching prospect, not just a bat that happens to be listed there.
          Below <code>pot_c</code> 45, no path qualifies regardless of current blocking/framing. Real effect measured
          the same day: 152 players reclassified into Role=&quot;C&quot; from DH (140), COF (8), INF (3), and 1B (1) —
          all confirmed real rostered catchers (StatsPlus <code>pos = &quot;C&quot;</code>), not placeholder data.
          Catcher&apos;s Role Representation Index (Overall &amp; Potential section above) moved from 131 → 114 by
          Overall and 202 → 165 by Prospect Potential — closer to proportional in both cases, since the newly
          -included players are mostly second-tier backstops rather than elite prospects, diluting the population
          without meaningfully padding the top-200 count.
        </p>

        <h3 style={subTitleStyle}>SP / RP</h3>
        <p style={bodyTextStyle}>
          A separate, on-field classification from stamina and pitch-mix depth — distinct from a player&apos;s real
          assigned position, which only feeds the Pitching formula&apos;s starter bonus above.
        </p>
        <code style={formulaStyle}>
          If Batting Potential &gt; Pitching Potential: no SP/RP label (this player&apos;s future is really as a hitter){"\n"}
          Else if Stamina ≤ {weights?.sp_rp_stamina_threshold ?? "—"} OR quality-potential-pitch count &lt; {weights?.sp_rp_min_pitches ?? "—"}: RP{"\n"}
          Else: SP
        </code>

        <h3 style={subTitleStyle}>TBL Pos</h3>
        <p style={bodyTextStyle}>
          Every position a player&apos;s <em>potential</em> clears a bar for — not a single bucket like Role, a full
          list (e.g. a player might show &quot;2B SS&quot;). Catcher&apos;s bar is 50; every other position uses 55.
          Pitchers show their SP/RP label here instead.
        </p>

        <h3 style={subTitleStyle}>Platoon</h3>
        <p style={bodyTextStyle}>
          Compares the same Batting/Pitching formula shape fed by vs-left and vs-right split grades instead of
          overall grades. A real platoon split (RH/LH Platoon) is only flagged when the better side is more than 3
          points ahead of the worse one <em>and</em> the weaker side falls under a viability bar (50 for hitters, or
          for pitchers, only when neither side clears 60 — pitchers who are strong both ways never get platooned
          regardless of the gap).
        </p>
      </section>

      {/* ================= RANKINGS ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Rankings</h2>
        <p style={bodyTextStyle}>
          Five separate rank fields live on every computed player row, each sorting a different metric over a
          different population:
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
            </tbody>
          </table>
        </div>
        <h3 style={subTitleStyle}>The prospect pool</h3>
        <p style={bodyTextStyle}>
          A player counts as a &quot;prospect&quot; (eligible for Prospect Rank / Prospect Org Rank, and therefore
          ETA) only if <strong>both</strong> hold:
        </p>
        <code style={formulaStyle}>
          Still rookie-eligible: mlb_service_days &lt; 45{"\n"}
          AND (currently rostered to an org, OR a genuine free agent with real pro history — has a last_team_id)
        </code>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          That second condition matters: &quot;free agent&quot; alone would also sweep in thousands of amateur
          draft-pool players who&apos;ve never been rostered — those belong on the Draft page, not here.
        </p>
      </section>

      {/* ================= ETA ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>ETA (Top Prospects)</h2>
        <p style={bodyTextStyle}>
          A prospect&apos;s ETA is how many years out they project to reach the majors, using the Role × Level
          benchmark table above rather than one fixed bar for every player.
        </p>
        <p style={bodyTextStyle}><strong>No ETA is shown at all when:</strong></p>
        <ul style={{ ...bodyTextStyle, marginTop: 0 }}>
          <li>The player isn&apos;t in the prospect pool above, or</li>
          <li>
            Their Potential never clears their own role&apos;s MLB bar from the table above — a ceiling that was
            never realistically MLB-caliber for that role gets no projected arrival year.
          </li>
        </ul>
        <p style={bodyTextStyle}>
          <strong>Reworked twice on 2026-08-24.</strong> The first version measured distance to the majors purely by
          counting real levels between a player&apos;s <em>roster</em> level and MLB — so a player already
          performing at an MLB-caliber level for his role, but stuck at (say) A+ behind a logjam, still got a
          multi-year ETA just because of where he was rostered. The fix: instead of counting roster levels, a
          player&apos;s <strong>current Overall is interpolated onto his own role&apos;s benchmark ladder</strong>{" "}
          above to find his <strong>Suggested Level</strong> — where his actual current ability already sits,
          entirely independent of what level he&apos;s actually rostered at.
        </p>
        <p style={bodyTextStyle}>
          <strong>Generalized further the same day:</strong> the first pass still special-cased players literally on
          the active MLB roster, auto-giving them ETA = this year regardless of ability. That&apos;s the same kind
          of mismatch in the other direction — a below-bar emergency call-up isn&apos;t genuinely &quot;arrived&quot;
          just because of a roster snapshot. Removed entirely: Suggested Level (ability alone) is now the{" "}
          <em>only</em> basis for every player, uniformly, with no roster-level shortcut anywhere. A player whose
          current Overall already meets or beats his role&apos;s MLB bar gets ETA = this year, whether he&apos;s
          rostered in the minors <em>or</em> the majors — and a rostered major leaguer whose ability doesn&apos;t yet
          match still gets a real forward-looking ETA instead of an automatic &quot;now.&quot;
        </p>
        <p style={bodyTextStyle}>
          Suggested Level gives a fractional distance from the majors (0 if current ability already clears the bar).
          It&apos;s then converted to years using a pace set by how far the player&apos;s <strong>Potential</strong>{" "}
          clears the MLB bar for his role — this still answers a different question than current-ability distance
          does: how aggressively a team is likely to push him once he is physically able:
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
        <p style={{ ...bodyTextStyle, marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Recomputed fresh every refresh, alongside the rest of the rating engine (<code>scripts/compute-ratings.ts</code>).
        </p>
      </section>

      {/* ================= MINOR LEAGUE SYSTEM / TEAM RANKINGS ================= */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={sectionTitleStyle}>Minor League System &amp; Team Rankings</h2>
        <p style={bodyTextStyle}>
          Org-level metrics, computed by <code>scripts/compute-team-ratings.ts</code> and shown on the System Rankings
          table next to Top Prospects. <strong>Rewritten 2026-08-31</strong> (Rees&apos;s methodology, replacing the
          original Power BI &quot;RLB&quot; flat-average approach) to explicitly reward three things: a strong top-end
          (&quot;blue-chip&quot; talent), real organizational depth beyond the headliners, and having BOTH a strong
          batting and a strong pitching pipeline rather than being one-sided. Full write-up:{" "}
          <code>system-rank-methodology.md</code>.
        </p>
        <p style={{ ...bodyTextStyle, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          The building block for every score below is <strong>Blue-Chip + Depth</strong>: within one org&apos;s one
          H/P split, the top 3 prospects (by Prospect Potential) count at full value (&quot;Blue-Chip&quot;); everyone
          ranked lower is SUMMED too, but decayed as 1/(rank&minus;3) (&quot;Depth&quot;) — the 4th-best counts in
          full, the 5th at half, the 10th at a seventh, and so on. Summing (not averaging) is deliberate: an average
          can never reward an org for simply having more good prospects, which is exactly what Depth exists to credit.
        </p>
        <div className="table-wrap" style={{ marginTop: "0.5rem", maxWidth: "64rem" }}>
          <table>
            <thead><tr><th>Metric</th><th>Formula</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700 }}>Batting Prospect Rank</td>
                <td>Blue-Chip + Depth score, computed on the org&apos;s hitters only, ranked against every other org</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Pitching Prospect Rank</td>
                <td>Same, computed on the org&apos;s pitchers only</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Minors Rank</td>
                <td>
                  (Batting score + Pitching score) &minus; 25% of the GAP between them, ranked against every other
                  org — a lopsided system (strong bat, weak arm, or vice versa) can no longer out-rank a well-rounded
                  one with the same total value
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Balance Index</td>
                <td>
                  weaker split&apos;s score &divide; stronger split&apos;s score, 0&ndash;1 (1 = perfectly balanced) —
                  display-only context alongside Minors Rank, not itself part of the ranking math (the balance penalty
                  above already is)
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Readiness Rank (tbl_readiness_rank)</td>
                <td>
                  Same Blue-Chip + Depth shape, batting + pitching summed, but using <em>current</em> Overall instead
                  of Potential — how much of the system&apos;s value is already realized, not just projected. No
                  balance penalty here.
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 700 }}>Roster Rank (Team OVR)</td>
                <td>
                  avg Overall of the org&apos;s top 18 players league-wide (by Org Rank) — UNCHANGED by the 2026-08-31
                  rework (current MLB roster strength, a different concept from farm-system ranking); computed and
                  stored, not currently shown on any page
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ ...bodyTextStyle, marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Known gap: RLB&apos;s original Team OVR also excluded players carrying a &quot;Serious Inj&quot; flag — a
          text-parsing heuristic on an injury-description string RLB had that StatsPlus doesn&apos;t expose in the
          same form. Not carried over yet.
        </p>
      </section>
    </>
  );
}
