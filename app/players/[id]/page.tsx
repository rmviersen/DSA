import { notFound } from "next/navigation";
import { getPlayerDetail, type PlayerDetailRatings, type SeasonStatLine } from "@/lib/player-detail-query";
import { gradeStyle } from "@/lib/display-helpers";

// Pure server component -- no "use client" anywhere on this page, so gotcha
// 16 (a client component importing a value from a Supabase-backed module)
// doesn't apply here. No sort/filter interactivity needed for a single-
// player deep-dive the way the big roster tables need -- if that changes
// later, split out a client sub-component the way MinorsTable.tsx does,
// don't make this whole page "use client" for one interactive widget.

function fmt1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}
function fmt0(n: number | null): string {
  return n === null ? "—" : Math.round(n).toLocaleString();
}
function fmtStr(s: string | null): string {
  return s === null || s === "" ? "—" : s;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, marginBottom: subtitle ? 2 : 6 }}>{title}</h2>
      {subtitle && <p style={{ color: "var(--color-text-muted, #888)", fontSize: 11, marginTop: 0, marginBottom: 8 }}>{subtitle}</p>}
      {children}
    </section>
  );
}

// One row in a raw-grade table: label, current (colored), potential
// (colored), and optional vL/vR (colored, "—" when the field has no split).
function GradeRow({ label, current, potential, l, r }: { label: string; current: number | null; potential?: number | null; l?: number | null; r?: number | null }) {
  const hasSplit = l !== undefined || r !== undefined;
  return (
    <tr>
      <td style={{ padding: "2px 8px", whiteSpace: "nowrap" }}>{label}</td>
      <td style={{ padding: "2px 8px", textAlign: "right", ...gradeStyle(current) }}>{fmt0(current)}</td>
      {potential !== undefined && <td style={{ padding: "2px 8px", textAlign: "right", ...gradeStyle(potential ?? null) }}>{fmt0(potential ?? null)}</td>}
      {hasSplit && <td style={{ padding: "2px 8px", textAlign: "right", ...gradeStyle(l ?? null) }}>{fmt0(l ?? null)}</td>}
      {hasSplit && <td style={{ padding: "2px 8px", textAlign: "right", ...gradeStyle(r ?? null) }}>{fmt0(r ?? null)}</td>}
    </tr>
  );
}

function GradeTable({ title, hasSplit, hasPot, rows }: { title: string; hasSplit: boolean; hasPot: boolean; rows: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
      <div style={{ padding: "6px 8px", fontWeight: 600, fontSize: 12, background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>{title}</div>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ padding: "2px 8px", textAlign: "left", color: "var(--color-text-muted, #888)", fontWeight: 500 }}></th>
            <th style={{ padding: "2px 8px", textAlign: "right", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>Cur</th>
            {hasPot && <th style={{ padding: "2px 8px", textAlign: "right", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>Pot</th>}
            {hasSplit && <th style={{ padding: "2px 8px", textAlign: "right", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>vL</th>}
            {hasSplit && <th style={{ padding: "2px 8px", textAlign: "right", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>vR</th>}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function StatTable({ title, rows, columns }: { title: string; rows: SeasonStatLine[]; columns: { key: keyof SeasonStatLine; label: string; fmt?: (v: number | null) => string }[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ overflowX: "auto", marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, marginBottom: 6 }}>{title}</h3>
      <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
        <thead>
          <tr>
            <th style={{ padding: "3px 8px", textAlign: "left", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>Year</th>
            <th style={{ padding: "3px 8px", textAlign: "left", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>Lvl</th>
            <th style={{ padding: "3px 8px", textAlign: "left", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>Team</th>
            {columns.map((c) => (
              <th key={c.key} style={{ padding: "3px 8px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", background: "var(--color-navy)", color: "var(--color-text-on-navy)" }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.year}-${row.levelLabel}`}>
              <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border)" }}>{row.year}</td>
              <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border)" }}>{row.levelLabel}</td>
              <td style={{ padding: "3px 8px", borderBottom: "1px solid var(--color-border)" }}>{row.teamName ?? "—"}</td>
              {columns.map((c) => {
                const v = row[c.key];
                return (
                  <td key={c.key} style={{ padding: "3px 8px", textAlign: "right", borderBottom: "1px solid var(--color-border)" }}>
                    {c.fmt ? c.fmt(v as number | null) : fmt0(v as number | null)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PlayerDetailPage({ params }: { params: { id: string } }) {
  const playerId = Number(params.id);
  if (!Number.isFinite(playerId)) notFound();
  const detail = await getPlayerDetail(playerId);
  if (!detail) notFound();

  const { bio, computed, ratings, projectedSplits, battingHistory, pitchingHistory } = detail;
  const r = ratings as PlayerDetailRatings | null;

  return (
    <div style={{ fontFamily: "var(--font-body), system-ui, sans-serif", padding: "16px 24px", fontSize: 13, maxWidth: 1100 }}>
      {/* ── Bio header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
        <div>
          <h1 style={{ marginBottom: 2, fontSize: 22 }}>
            {bio.firstName} {bio.lastName}
            {bio.isHallOfFame && <span title="Hall of Fame" style={{ marginLeft: 8, fontSize: 14 }}>🏆</span>}
          </h1>
          <p style={{ color: "var(--color-text-muted, #888)", margin: 0, fontSize: 12 }}>
            {bio.pos ?? "—"} · {bio.teamNickname ?? (bio.isFreeAgent ? "Free Agent" : bio.isRetired ? "Retired" : "—")} ({bio.levelLabel}) · Age {bio.age ?? "—"}
          </p>
        </div>
        <a href={detail.statsPlusUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          View on StatsPlus ↗
        </a>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12, color: "var(--color-text-muted, #888)", marginBottom: 14 }}>
        <span>Bats/Throws: <b style={{ color: "inherit" }}>{bio.bats ?? "—"}/{bio.throws ?? "—"}</b></span>
        <span>Ht/Wt: <b>{bio.height ?? "—"}, {bio.weight ?? "—"} lb</b></span>
        <span>DOB: <b>{bio.dateOfBirth ?? "—"}</b></span>
        <span>Draft: <b>{bio.draftYear ? `${bio.draftYear} Rd ${bio.draftRound ?? "—"}, Pk ${bio.draftOverallPick ?? "—"} (${bio.draftTeamName ?? "—"})` : "Undrafted / International"}</b></span>
        <span>Health: <b>{bio.injuryStatus}</b></span>
        {bio.isFreeAgent && <span><b>Free Agent</b></span>}
        {bio.isRetired && <span><b>Retired</b></span>}
      </div>

      {bio.bioText && (
        <p style={{ fontSize: 13, fontStyle: "italic", marginBottom: 16, color: bio.bioStale ? "var(--color-text-muted, #888)" : "inherit" }}>
          {bio.bioText}
          {bio.bioStale && <span style={{ fontSize: 11 }}> (stale -- written against an older data refresh)</span>}
        </p>
      )}

      {/* ── Calculated ratings ── */}
      {computed && (
        <Section title="Calculated ratings" subtitle="Our computed values (lib/rating-engine.ts) -- the composites that feed Overall/Potential, not StatsPlus's own scout grades.">
          <div style={{ display: "flex", gap: 24, marginBottom: 10, flexWrap: "wrap" }}>
            <div><div style={{ fontSize: 11, color: "var(--color-text-muted, #888)" }}>Overall</div><div style={{ fontSize: 24, fontWeight: 700, ...gradeStyle(computed.overall) }}>{fmt1(computed.overall)}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--color-text-muted, #888)" }}>Potential</div><div style={{ fontSize: 24, fontWeight: 700, ...gradeStyle(computed.potential) }}>{fmt1(computed.potential)}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--color-text-muted, #888)" }}>Prospect Potential</div><div style={{ fontSize: 24, fontWeight: 700, ...gradeStyle(computed.prospect_potential) }}>{fmt1(computed.prospect_potential)}</div></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Batting", "Batting_p", "Fielding", "Pitching", "Pitching_p", "QP", "QPP", "C Rtg", "INF Rtg", "OF Rtg", "Role", "SP/RP", "TBL Pos", "Platoon"].map((h) => (
                    <th key={h} style={{ padding: "3px 8px", textAlign: "right", borderBottom: "2px solid var(--color-tan)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.batting) }}>{fmt1(computed.batting)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.batting_p) }}>{fmt1(computed.batting_p)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.fielding) }}>{fmt1(computed.fielding)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.pitching) }}>{fmt1(computed.pitching)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.pitching_p) }}>{fmt1(computed.pitching_p)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{fmt1(computed.qp)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{fmt1(computed.qpp)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.c_rating) }}>{fmt1(computed.c_rating)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.inf_rating) }}>{fmt1(computed.inf_rating)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(computed.of_rating) }}>{fmt1(computed.of_rating)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{fmtStr(computed.role)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{fmtStr(computed.sp_rp)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{fmtStr(computed.tbl_pos)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{fmtStr(computed.platoon)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── Raw ratings ── */}
      {r && (
        <Section title="Raw scouting grades" subtitle="Straight from StatsPlus's ratings feed, current and potential, 20-80 scale. StatsPlus's own Ovr/Pot (bottom) are their scout grades -- never used as an input anywhere in our rating engine, shown here only as a comparison.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            <GradeTable title="Hitting" hasSplit hasPot rows={<>
              <GradeRow label="Contact" current={r.cntct} potential={r.pot_cntct} l={r.cntct_l} r={r.cntct_r} />
              <GradeRow label="Gap" current={r.gap} potential={r.pot_gap} l={r.gap_l} r={r.gap_r} />
              <GradeRow label="Power" current={r.pow} potential={r.pot_pow} l={r.pow_l} r={r.pow_r} />
              <GradeRow label="Eye" current={r.eye} potential={r.pot_eye} l={r.eye_l} r={r.eye_r} />
              <GradeRow label="Avoid K's" current={r.ks} potential={r.pot_ks} l={r.ks_l} r={r.ks_r} />
              <GradeRow label="BABIP" current={r.babip} potential={r.pot_babip} l={r.babip_l} r={r.babip_r} />
            </>} />

            <GradeTable title="Speed / Baserunning" hasSplit={false} hasPot={false} rows={<>
              <GradeRow label="Speed" current={r.speed} />
              <GradeRow label="Baserunning" current={r.run} />
              <GradeRow label="Steal" current={r.steal} />
              <GradeRow label="Steal Rate" current={r.stlrt} />
              <GradeRow label="Sac Bunt" current={r.sacbunt} />
              <GradeRow label="Bunt for Hit" current={r.bunthit} />
            </>} />

            <GradeTable title="Fielding" hasSplit={false} hasPot={false} rows={<>
              <GradeRow label="C Blocking" current={r.cblk} />
              <GradeRow label="C Framing" current={r.cfrm} />
              <GradeRow label="C Arm" current={r.carm} />
              <GradeRow label="IF Range" current={r.ifr} />
              <GradeRow label="IF Error" current={r.ife} />
              <GradeRow label="IF Arm" current={r.ifa} />
              <GradeRow label="Turn DP" current={r.tdp} />
              <GradeRow label="OF Range" current={r.ofr} />
              <GradeRow label="OF Error" current={r.ofe} />
              <GradeRow label="OF Arm" current={r.ofa} />
            </>} />

            <GradeTable title="Position Eligibility" hasSplit={false} hasPot rows={<>
              <GradeRow label="P" current={r.pos_p} potential={r.pot_p} />
              <GradeRow label="C" current={r.pos_c} potential={r.pot_c} />
              <GradeRow label="1B" current={r.pos_1b} potential={r.pot_1b} />
              <GradeRow label="2B" current={r.pos_2b} potential={r.pot_2b} />
              <GradeRow label="3B" current={r.pos_3b} potential={r.pot_3b} />
              <GradeRow label="SS" current={r.pos_ss} potential={r.pot_ss} />
              <GradeRow label="LF" current={r.pos_lf} potential={r.pot_lf} />
              <GradeRow label="CF" current={r.pos_cf} potential={r.pot_cf} />
              <GradeRow label="RF" current={r.pos_rf} potential={r.pot_rf} />
            </>} />

            <GradeTable title="Pitching" hasSplit hasPot rows={<>
              <GradeRow label="Stuff" current={r.stf} potential={r.pot_stf} l={r.stf_l} r={r.stf_r} />
              <GradeRow label="Movement" current={r.mov} potential={r.pot_mov} l={r.mov_l} r={r.mov_r} />
              <GradeRow label="HR/9 (HRA)" current={r.hra} potential={r.pot_hra} l={r.hra_l} r={r.hra_r} />
              <GradeRow label="PBABIP" current={r.pbabip} potential={r.pot_pbabip} l={r.pbabip_l} r={r.pbabip_r} />
              <GradeRow label="Control" current={r.ctrl} potential={r.pot_ctrl} l={r.ctrl_l} r={r.ctrl_r} />
              <GradeRow label="Stamina" current={r.stm} />
              <GradeRow label="Hold Runners" current={r.hold} />
              <GradeRow label="Ground Ball %" current={r.gb} />
            </>} />

            <GradeTable title="Pitches" hasSplit={false} hasPot rows={<>
              <GradeRow label="Fastball" current={r.fst} potential={r.pot_fst} />
              <GradeRow label="Sinker" current={r.snk} potential={r.pot_snk} />
              <GradeRow label="Cutter" current={r.cutt} potential={r.pot_cutt} />
              <GradeRow label="Curveball" current={r.crv} potential={r.pot_crv} />
              <GradeRow label="Slider" current={r.sld} potential={r.pot_sld} />
              <GradeRow label="Changeup" current={r.chg} potential={r.pot_chg} />
              <GradeRow label="Splitter" current={r.splt} potential={r.pot_splt} />
              <GradeRow label="Screwball" current={r.scr} potential={r.pot_scr} />
              <GradeRow label="Forkball" current={r.frk} potential={r.pot_frk} />
              <GradeRow label="Circle Change" current={r.circhg} potential={r.pot_circhg} />
              <GradeRow label="Knuckleball" current={r.knbl} potential={r.pot_knbl} />
              <GradeRow label="Knuckle-curve" current={r.kncrv} potential={r.pot_kncrv} />
            </>} />
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, marginTop: 12, color: "var(--color-text-muted, #888)" }}>
            <span>Velocity: <b>{fmtStr(r.vel)}</b> (Pot <b>{fmtStr(r.pot_vel)}</b>)</span>
            <span>Arm Slot: <b>{fmtStr(r.armslot)}</b></span>
            <span>Injury Proneness: <b>{fmtStr(r.prone)}</b></span>
            <span>Greed: <b>{fmtStr(r.greed)}</b></span>
            <span>Leadership: <b>{fmtStr(r.lead)}</b></span>
            <span>Loyalty: <b>{fmtStr(r.loy)}</b></span>
            <span>Work Ethic: <b>{fmtStr(r.wrkethic)}</b></span>
            <span>Adaptability: <b>{fmtStr(r.acc)}</b></span>
            <span>Intelligence: <b>{fmtStr(r.int_)}</b></span>
            <span style={{ borderLeft: "1px solid var(--color-border)", paddingLeft: 16 }}>StatsPlus Ovr: <b>{fmt0(r.statsPlusOvr)}</b> / Pot: <b>{fmt0(r.statsPlusPot)}</b></span>
          </div>
        </Section>
      )}

      {/* ── Projected Potential L/R splits ── */}
      {projectedSplits && (
        <Section title="Projected Potential splits" subtitle="StatsPlus never publishes Potential L/R splits -- these are extrapolated from the player's own real current L/R relationship (see projectPotentialSplit in lib/rating-engine.ts).">
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ padding: "3px 8px", textAlign: "left" }}></th>
                  {(["cntct", "pow", "eye", "gap", "ks", "stf", "mov", "ctrl", "hra", "pbabip"] as const).map((k) => (
                    <th key={k} style={{ padding: "3px 8px", textAlign: "right", color: "var(--color-text-muted, #888)", fontWeight: 500 }}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "3px 8px" }}>vL</td>
                  {(["cntct", "pow", "eye", "gap", "ks", "stf", "mov", "ctrl", "hra", "pbabip"] as const).map((k) => (
                    <td key={k} style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(projectedSplits[k].l) }}>{fmt0(projectedSplits[k].l)}</td>
                  ))}
                </tr>
                <tr>
                  <td style={{ padding: "3px 8px" }}>vR</td>
                  {(["cntct", "pow", "eye", "gap", "ks", "stf", "mov", "ctrl", "hra", "pbabip"] as const).map((k) => (
                    <td key={k} style={{ padding: "3px 8px", textAlign: "right", ...gradeStyle(projectedSplits[k].r) }}>{fmt0(projectedSplits[k].r)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── Stats history ── */}
      {(battingHistory.length > 0 || pitchingHistory.length > 0) && (
        <Section title="Stats history" subtitle="Full career, most recent data refresh -- summed across stints at the same year/level.">
          <StatTable
            title="Batting"
            rows={battingHistory}
            columns={[
              { key: "g", label: "G" }, { key: "ab", label: "AB" }, { key: "h", label: "H" },
              { key: "d", label: "2B" }, { key: "t", label: "3B" }, { key: "hr", label: "HR" },
              { key: "r", label: "R" }, { key: "rbi", label: "RBI" }, { key: "bb", label: "BB" }, { key: "k", label: "K" },
              { key: "sb", label: "SB" }, { key: "cs", label: "CS" }, { key: "war", label: "WAR", fmt: fmt1 },
            ]}
          />
          <StatTable
            title="Pitching"
            rows={pitchingHistory}
            columns={[
              { key: "g", label: "G" }, { key: "gs", label: "GS" }, { key: "ip", label: "IP", fmt: fmt1 },
              { key: "w", label: "W" }, { key: "l", label: "L" }, { key: "sv", label: "SV" },
              { key: "er", label: "ER" }, { key: "h", label: "H" }, { key: "bb", label: "BB" }, { key: "k", label: "K" },
              { key: "hr", label: "HR" }, { key: "war", label: "WAR", fmt: fmt1 },
            ]}
          />
        </Section>
      )}
    </div>
  );
}
