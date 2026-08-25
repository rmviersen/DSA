import { Fragment, type CSSProperties } from "react";
import type { TeamRankingRow } from "../../lib/queries";

// Rank, Logo, Team, Pitch, Bat, Readiness, Top 100 (2026-08-20 restructure --
// Pitch/Bat/Readiness/Top 100 used to be folded into the detail row's text;
// now they're real columns on the main row, and the detail row instead
// highlights the org's own top 3 prospects).
const COLUMN_COUNT = 7;

const CARD_BG = "var(--color-table-stripe, #f5f5f5)";
const mainCell: CSSProperties = { borderBottom: "none", whiteSpace: "nowrap" };
const detailCell: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted, #888)",
  borderTop: "none",
  borderBottom: "1px solid var(--color-border, #333)",
  background: CARD_BG,
  paddingTop: 2,
  paddingBottom: 4,
  // Table is `width: auto` (see .prospect-table in globals.css), so without
  // this the browser shrinks the text to fit whatever space the flex row
  // squeezes it into instead of growing the table -- forcing nowrap here
  // makes the table widen to fit the full line instead (2026-08-20).
  whiteSpace: "nowrap",
};
// Logo sits right after Rank now (2026-08-20 restructure, matches
// ProspectTable's Rank-then-Logo order) -- was on the far right before.
// Bordered top/bottom only -- no left (butts up against Rank instead of
// boxing it off) and no right (2026-08-24, Rees's spec -- was reading as an
// unwanted line between Logo and Team).
const logoCell: CSSProperties = {
  ...mainCell,
  borderTop: "1px solid var(--color-border, #333)",
  borderBottom: "1px solid var(--color-border, #333)",
  background: CARD_BG,
  padding: "0 4px",
};
// Rank matches ProspectTable's anchor-cell treatment: rowSpan across both of
// a team's rows, bold, large, bordered top/bottom, same background as Logo.
const rankCell: CSSProperties = {
  ...mainCell,
  borderTop: "1px solid var(--color-border, #333)",
  borderBottom: "1px solid var(--color-border, #333)",
  background: CARD_BG,
  fontWeight: 700,
  fontSize: "1.125rem",
  verticalAlign: "middle",
};

const rank = (n: number | null) => (n === null ? "—" : `#${n}`);

export function TeamRankingsTable({
  rows,
  baselineRefreshRunId,
  basePath,
}: {
  rows: TeamRankingRow[];
  // Carried through so clicking a team name preserves any active "Change
  // from" comparison instead of silently dropping it -- matches what
  // picking a team from ProspectFilters' Organization dropdown already does
  // (it resubmits the whole form, "since" included).
  baselineRefreshRunId?: number;
  // Was hardcoded to "/prospects" (2026-08-20 bug, caught before the /report
  // route shipped): on /report, a team-name click would silently land on
  // /prospects -- the internal, nav-visible page -- instead of staying on
  // /report. Now passed in by the caller (same fix as ProspectFilters).
  basePath: string;
}) {
  return (
    <div className="table-wrap">
    <table className="prospect-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th></th>
          <th>Team</th>
          <th>Pitch</th>
          <th>Bat</th>
          <th>Readiness</th>
          <th>Top 100</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <Fragment key={t.team_id}>
            <tr>
              <td rowSpan={2} style={rankCell}>{rank(t.minorsRank)}</td>
              <td rowSpan={2} style={logoCell}>
                {t.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.logoUrl} alt="" width={36} height={36} style={{ display: "block" }} />
                )}
              </td>
              <td style={{ ...mainCell, fontWeight: 700 }}>
                {/* Clicking a team name filters the Top Prospects table next
                    to it, since it's the same page/query param that drives
                    the Organization dropdown (2026-08-20). Plain <a> (full
                    page nav), not next/link -- besides Link's own Server
                    Component prop restriction, a client-side transition
                    leaves ProspectFilters' Organization <select> un-remounted,
                    and its defaultValue only applies on mount, so it'd keep
                    showing "All teams" even after the table itself filtered
                    correctly. A full reload avoids that state-sync bug and
                    matches how every other filter interaction here already
                    works (ProspectFilters submits a real GET form). */}
                <a
                  href={
                    baselineRefreshRunId
                      ? `${basePath}?team=${t.team_id}&since=${baselineRefreshRunId}`
                      : `${basePath}?team=${t.team_id}`
                  }
                  className="team-name-link"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {t.name} {t.nickname}
                </a>
              </td>
              <td style={mainCell}>{rank(t.pitchingProspectRank)}</td>
              <td style={mainCell}>{rank(t.battingProspectRank)}</td>
              <td style={mainCell}>{rank(t.readinessRank)}</td>
              <td style={mainCell}>{t.top100Count}</td>
            </tr>
            <tr>
              <td colSpan={COLUMN_COUNT - 2} style={detailCell}>
                {/* Org's own top 3 prospects, each "#Rank ROLE Name"
                    (2026-08-20, replaces the old Pitch/Bat/Readiness/Top 100
                    text now that those live in their own columns above). Only
                    rank is bolded (2026-08-20 follow-up: role was too, Rees
                    asked for just rank) -- role and name both plain. */}
                {t.topProspects.length === 0 ? (
                  "No ranked prospects"
                ) : (
                  t.topProspects.map((p, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      <strong>{rank(p.rank)}</strong> {p.role ?? "—"} {p.name}
                    </span>
                  ))
                )}
              </td>
            </tr>
          </Fragment>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={COLUMN_COUNT} className="empty-state">No team rankings available.</td>
          </tr>
        )}
      </tbody>
    </table>
    </div>
  );
}
