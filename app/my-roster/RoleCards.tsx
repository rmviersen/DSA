import type { CSSProperties } from "react";
import type { RoleCard, RoleSide, RosterDepthPlayer } from "@/lib/my-roster-query";
import { percentileStyle, gradeStyle } from "@/lib/display-helpers";

// My Roster (2026-09-04) -- structural first pass, deliberately plain: one
// card per role, Current vs. Future side by side, each with a rating, a
// leaguewide rank, and the actual players behind that number. No sort/filter
// controls yet (Server Component, no "use client") -- this is the "lay out
// the overall vision" skeleton Rees asked for; calculation refinement and any
// interactivity are expected follow-ups, not part of this pass.

function fmt1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function rankLabel(rank: number | null, totalTeams: number | null): string {
  if (rank === null || totalTeams === null) return "—";
  return `${rank}/${totalTeams}`;
}

// Same formatting convention as PlayerTable.tsx's fmtMoney -- kept as its
// own local copy rather than a shared import, matching that file's existing
// precedent of each component owning its own small display helpers.
function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type Variant = "current" | "future";

// table-layout: fixed + an explicit colgroup (2026-09-04 fix) -- without
// this, the name column's `nowrap` let a long player name push the table's
// natural width past its flex container, which a plain `1fr`/minWidth:0 flex
// item can't stop (that only bounds the *container*, not a table's own
// min-content width). Fixed layout respects the container no matter what;
// the name cell truncates with an ellipsis instead of overflowing.
//
// Current shows Contract (AAV) + Control (years remaining) instead of a
// bare age (Rees's ask) -- both come from the same yearsOfControl()/
// computeAAV() logic already used elsewhere (trade-value composite,
// contract classification), just displayed here rather than used as a
// filter. Future doesn't show these -- a pipeline player's real "control"
// is already the filter that got him into this pool at all (see
// my-roster-query.ts), not a fresh per-player number worth repeating here.
//
// Ovr/Pot (2026-09-04, Rees's ask) use `gradeStyle` -- the same raw 20-80
// grade-color gradient every other report on the site colors Overall/
// Potential with (PlayerTable, MinorsTable, etc.), not `percentileStyle`
// (the 0-100 relative scale the rating/rank numbers above use). These are
// always the player's real Overall/Potential, never the role-specific
// Batting-substituted or bust-risk-adjusted metric that actually drives the
// card's own rating number above -- matching every other report's
// convention takes priority over hand-verifying the rating by eye here.
function DepthList({ rows, variant }: { rows: RosterDepthPlayer[]; variant: Variant }) {
  if (rows.length === 0) return <p style={{ margin: "4px 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>No players</p>;
  const isCurrent = variant === "current";
  const thStyle: CSSProperties = { padding: "0 4px 2px 0", fontWeight: 600, fontSize: "0.6875rem", color: "var(--color-text-muted)", textAlign: "left" };
  return (
    <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
      <colgroup>
        {isCurrent ? (
          <>
            <col style={{ width: "24%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "17%" }} />
          </>
        ) : (
          <>
            <col style={{ width: "38%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
          </>
        )}
      </colgroup>
      <thead>
        <tr>
          <th style={thStyle}></th>
          {isCurrent ? (
            <>
              <th style={thStyle}>Age</th>
              <th style={thStyle}>Contract</th>
              <th style={thStyle}>Control</th>
            </>
          ) : (
            <>
              <th style={thStyle}>Level</th>
              <th style={thStyle}>ETA</th>
            </>
          )}
          <th style={{ ...thStyle, textAlign: "right" }}>Ovr</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Pot</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.playerId}>
            <td style={{ padding: "2px 4px 2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>{p.name}</td>
            {isCurrent ? (
              <>
                <td style={{ padding: "2px 4px", color: "var(--color-text-muted)" }}>{p.age ?? "—"}</td>
                <td style={{ padding: "2px 4px", color: "var(--color-text-muted)" }}>{fmtMoney(p.contractAav)}</td>
                <td style={{ padding: "2px 4px", color: "var(--color-text-muted)" }}>{p.controlYears ?? "—"}</td>
              </>
            ) : (
              <>
                <td style={{ padding: "2px 4px", color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.levelLabel}</td>
                <td style={{ padding: "2px 4px", color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.eta !== null && p.eta !== undefined ? p.eta : ""}</td>
              </>
            )}
            <td style={{ padding: "2px 0 2px 4px", textAlign: "right", fontWeight: 700, ...gradeStyle(p.overall) }}>{fmt1(p.overall)}</td>
            <td style={{ padding: "2px 0 2px 4px", textAlign: "right", fontWeight: 700, ...gradeStyle(p.potential) }}>{fmt1(p.potential)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SideColumn({ title, side, variant }: { title: string; side: RoleSide; variant: Variant }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)", marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: "1.375rem", fontWeight: 700, ...percentileStyle(side.avgPct) }}>{fmt1(side.rating)}</div>
          <div style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
            {side.leagueAvg !== null ? `Lg ${fmt1(side.leagueAvg)}` : "Lg —"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "1.375rem", fontWeight: 700, ...percentileStyle(side.rankPct) }}>{rankLabel(side.rank, side.totalTeams)}</div>
          <div style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>Rank</div>
        </div>
      </div>
      <DepthList rows={side.depthChart} variant={variant} />
    </div>
  );
}

export default function RoleCards({ cards }: { cards: RoleCard[] }) {
  return (
    <div className="my-roster-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {cards.map((card) => (
        <div
          key={card.label}
          style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 14px", background: "var(--color-surface)" }}
        >
          <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>{card.label}</h3>
          <div style={{ display: "flex", gap: 16 }}>
            <SideColumn title="Current (MLB)" side={card.current} variant="current" />
            <SideColumn title="Future (pipeline)" side={card.future} variant="future" />
          </div>
        </div>
      ))}
    </div>
  );
}
