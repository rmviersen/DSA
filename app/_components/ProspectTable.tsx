import type { ProspectRow } from "../../lib/queries";
import { levelLabel, teamLogoUrl } from "../../lib/queries";

function seasonStintText(r: ProspectRow) {
  if (r.seasonStints.length === 0) return "No stats this season";
  return r.seasonStints.map((s, i) => {
    const label = levelLabel(s.level);
    if (r.ph === "P") {
      if (s.ip === null) return null;
      return <span key={i}>{i > 0 && "; "}<strong>{label}:</strong> IP {s.ip} · {s.w}-{s.l} · ERA {era(s.er, s.ip)} · K {s.pk} · BB {s.pbb}</span>;
    }
    if (s.ab === null) return null;
    return <span key={i}>{i > 0 && "; "}<strong>{label}:</strong> AB {s.ab} · H {s.h} · HR {s.hr} · RBI {s.rbi} · AVG {avg(s.h, s.ab)}</span>;
  });
}

const fmt = (n: number | null) => (n === null || n === undefined ? "—" : Number(n).toFixed(1));
const fmtInt = (n: number | null) => (n === null || n === undefined ? "—" : Math.round(n));
const avg = (h: number | null, ab: number | null) => (h === null || ab === null || ab === 0 ? "—" : (h / ab).toFixed(3).replace(/^0/, ""));
const era = (er: number | null, ip: number | null) => (er === null || ip === null || ip === 0 ? "—" : ((er * 9) / ip).toFixed(2));

export function ProspectTable({ rows, showTeam }: { rows: ProspectRow[]; showTeam: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          {showTeam && <th>Team</th>}
          <th>Name</th>
          <th>Pos</th>
          <th>Level</th>
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
          <th>Prospect Pot.</th>
          <th>Prospect Rank</th>
          <th>This Season</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const logo = showTeam ? teamLogoUrl(r.team_name, r.team_nickname) : null;
          return (
            <tr key={r.player_id}>
              {showTeam && (
                <td>
                  {logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" width={20} height={20} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  )}
                  {r.team_name ? `${r.team_name} ${r.team_nickname}` : "—"}
                </td>
              )}
              <td>{r.first_name} {r.last_name}</td>
              <td>{r.pos ?? "—"}</td>
              <td>{levelLabel(r.level)}</td>
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
              <td>{fmt(r.prospect_potential)}</td>
              <td>{r.prospect_rank ?? "—"}</td>
              <td style={{ textAlign: "left" }}>{seasonStintText(r)}</td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={19} style={{ textAlign: "center", padding: "1rem" }}>No prospects match this filter.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
