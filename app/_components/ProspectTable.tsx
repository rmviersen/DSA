import type { ProspectRow } from "../../lib/queries";
import { levelLabel, teamLogoUrl, roundGrade } from "../../lib/queries";

function stintDetail(r: ProspectRow) {
  if (r.seasonStints.length === 0) return "No stats this season";
  return r.seasonStints.map((s, i) => {
    const label = levelLabel(s.level);
    if (r.ph === "P") {
      if (s.ip === null) return null;
      return <span key={i}>{i > 0 && "; "}{label}: {s.ip} IP, {s.w}-{s.l}</span>;
    }
    if (s.ab === null) return null;
    return <span key={i}>{i > 0 && "; "}{label}: {s.ab} AB, {avg(s.h, s.ab)} AVG</span>;
  });
}

// Overall/Potential rounded to nearest 5 for display — see roundGrade in
// lib/queries.ts. This page in particular is the one headed for Slack
// reports other GMs will see.
const fmt = (n: number | null) => (n === null || n === undefined ? "—" : roundGrade(n));
const fmtInt = (n: number | null) => (n === null || n === undefined ? "—" : Math.round(n));
const fmt1 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(1));
const pct = (n: number | null) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
const avg = (h: number | null, ab: number | null) => (h === null || ab === null || ab === 0 ? "—" : (h / ab).toFixed(3).replace(/^0/, ""));

export function ProspectTable({ rows }: { rows: ProspectRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Org</th>
          <th>Name</th>
          <th>Pos</th>
          <th>Level (Team)</th>
          <th>Age</th>
          <th>ETA</th>
          <th>Cntct</th>
          <th>Pow</th>
          <th>Eye</th>
          <th>Spd</th>
          <th>Stf</th>
          <th>Mov</th>
          <th>Ctrl</th>
          <th>Stm</th>
          <th>Overall</th>
          <th>Potential</th>
          <th>Prospect Rank</th>
          <th>WAR</th>
          <th>K%</th>
          <th>HR / ERA</th>
          <th>By Level</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const logo = teamLogoUrl(r.orgName, r.orgNickname);
          return (
            <tr key={r.player_id}>
              <td>
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" width={20} height={20} style={{ verticalAlign: "middle", marginRight: 4 }} />
                )}
                {r.orgName ? `${r.orgName} ${r.orgNickname}` : "—"}
              </td>
              <td>{r.first_name} {r.last_name}</td>
              <td>{r.pos ?? "—"}</td>
              <td>{levelLabel(r.level)}{r.teamAbbr ? ` (${r.teamAbbr})` : ""}</td>
              <td>{r.age ?? "—"}</td>
              <td>{r.eta ?? "—"}</td>
              <td>{fmtInt(r.cntct)}</td>
              <td>{fmtInt(r.pow)}</td>
              <td>{fmtInt(r.eye)}</td>
              <td>{fmtInt(r.speed)}</td>
              <td>{fmtInt(r.stf)}</td>
              <td>{fmtInt(r.mov)}</td>
              <td>{fmtInt(r.ctrl)}</td>
              <td>{fmtInt(r.stm)}</td>
              <td>{fmt(r.overall)}</td>
              <td>{fmt(r.potential)}</td>
              <td>{r.prospect_rank ?? "—"}</td>
              <td>{fmt1(r.seasonTotals.war)}</td>
              <td>{pct(r.seasonTotals.k_pct)}</td>
              <td>{r.ph === "P" ? fmt1(r.seasonTotals.era) : fmtInt(r.seasonTotals.hr)}</td>
              <td style={{ textAlign: "left" }}>{stintDetail(r)}</td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={21} style={{ textAlign: "center", padding: "1rem" }}>No prospects match this filter.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
