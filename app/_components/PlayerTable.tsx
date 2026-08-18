import type { PlayerRow } from "../../lib/queries";
import { roundGrade } from "../../lib/queries";

// Overall/Potential/Prospect Potential are rounded to the nearest 5 for
// display (see roundGrade in lib/queries.ts) — anything shown here can end
// up in a Slack report other GMs see, and full precision is effectively the
// scout ratings underneath.
const fmt = (n: number | null) => (n === null || n === undefined ? "—" : roundGrade(n));
const fmtInt = (n: number | null) => (n === null || n === undefined ? "—" : Math.round(n));

export function PlayerTable({ rows, showTeam, showProspectCols }: { rows: PlayerRow[]; showTeam: boolean; showProspectCols: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Pos</th>
          {showTeam && <th>Team</th>}
          <th>Age</th>
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
          {showProspectCols && (
            <>
              <th>Prospect Pot.</th>
              <th>Prospect Rank</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.player_id}>
            <td>{r.first_name} {r.last_name}</td>
            <td>{r.pos ?? "—"}</td>
            {showTeam && <td>{r.team_name ? `${r.team_name} ${r.team_nickname}` : "—"}</td>}
            <td>{r.age ?? "—"}</td>
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
            {showProspectCols && (
              <>
                <td>{fmt(r.prospect_potential)}</td>
                <td>{r.prospect_rank ?? "—"}</td>
              </>
            )}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={20} style={{ textAlign: "center", padding: "1rem" }}>No players match this filter.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
