import type { RoleCard, RoleSide, RosterDepthPlayer } from "@/lib/my-roster-query";
import { percentileStyle } from "@/lib/display-helpers";

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

function DepthList({ rows, showLevel }: { rows: RosterDepthPlayer[]; showLevel: boolean }) {
  if (rows.length === 0) return <p style={{ margin: "4px 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>No players</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
      <tbody>
        {rows.map((p) => (
          <tr key={p.playerId}>
            <td style={{ padding: "2px 4px 2px 0", whiteSpace: "nowrap" }}>{p.name}</td>
            {showLevel && <td style={{ padding: "2px 4px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{p.levelLabel}</td>}
            {!showLevel && <td style={{ padding: "2px 4px", color: "var(--color-text-muted)" }}>{p.age ?? "—"}</td>}
            {showLevel && <td style={{ padding: "2px 4px", color: "var(--color-text-muted)" }}>{p.eta !== null && p.eta !== undefined ? `ETA ${p.eta}` : ""}</td>}
            <td style={{ padding: "2px 0 2px 4px", textAlign: "right", fontWeight: 600 }}>{fmt1(p.metric)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SideColumn({ title, side, showLevel }: { title: string; side: RoleSide; showLevel: boolean }) {
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
      <DepthList rows={side.depthChart} showLevel={showLevel} />
    </div>
  );
}

export default function RoleCards({ cards }: { cards: RoleCard[] }) {
  return (
    <div
      className="my-roster-page"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 14px", background: "var(--color-surface)" }}
        >
          <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>{card.label}</h3>
          <div style={{ display: "flex", gap: 16 }}>
            <SideColumn title="Current (MLB)" side={card.current} showLevel={false} />
            <SideColumn title="Future (pipeline)" side={card.future} showLevel />
          </div>
        </div>
      ))}
    </div>
  );
}
