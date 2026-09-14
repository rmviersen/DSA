import type { CSSProperties } from "react";
import type { RoleRankNeed, TradeBlockCandidate, BroaderCandidate, NeedWithTradeBlockCandidates, NeedWithBroaderCandidates } from "@/lib/trade-finder-query";
import { percentileStyle, gradeStyle, statsPlusPlayerUrl } from "@/lib/display-helpers";

// Trade Finder's presentational layer (2026-09-14) -- deliberately plain,
// same "lay out the overall vision" posture as My Roster's own first pass
// (RoleCards.tsx): one card per flagged need, reusing that file's established
// visual language (percentileStyle/gradeStyle, var(--color-border)/
// var(--color-surface) tokens) rather than inventing a new look. No sort/
// filter controls yet -- a follow-up if the need list ever gets long enough
// to want them.

function fmt1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function fmtUpgrade(n: number): string {
  return `+${n.toFixed(2)}`;
}

function rankLabel(rank: number | null, totalTeams: number | null): string {
  if (rank === null || totalTeams === null) return "—";
  return `${rank}/${totalTeams}`;
}

const AVAILABILITY_LABEL: Record<BroaderCandidate["availabilitySignal"], string> = {
  "short-control": "≤2 yrs control",
  "weak-team": "weak team",
  both: "≤2 yrs control + weak team",
};

const thStyle: CSSProperties = { padding: "3px 8px 3px 0", fontWeight: 600, fontSize: "0.6875rem", color: "var(--color-text-muted)", textAlign: "left", whiteSpace: "nowrap" };
const tdStyle: CSSProperties = { padding: "3px 8px 3px 0", fontSize: "0.8125rem", whiteSpace: "nowrap" };

function CandidateTable({ title, rows }: { title: string; rows: (TradeBlockCandidate | BroaderCandidate)[] }) {
  const isBlock = (r: TradeBlockCandidate | BroaderCandidate): r is TradeBlockCandidate => "note" in r;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)", marginBottom: 4 }}>
        {title} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <p style={{ margin: "2px 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>None clear the bar right now.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Team</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Score</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Upgrade</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Control</th>
                <th style={thStyle}>{isBlock(rows[0]) ? "Listing Note" : "Why Available"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.playerId}>
                  <td style={tdStyle}>
                    <a href={statsPlusPlayerUrl(c.playerId)} target="_blank" rel="noopener noreferrer">{c.name}</a>
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-muted)" }}>{c.teamName ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", ...gradeStyle(c.score) }}>{fmt1(c.score)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "rgb(34,197,94)", fontWeight: 700 }}>{fmtUpgrade(c.upgradeSize)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "var(--color-text-muted)" }}>{c.yearsOfControl ?? "—"}</td>
                  <td style={{ ...tdStyle, whiteSpace: "normal", color: "var(--color-text-muted)", maxWidth: "22rem" }}>
                    {isBlock(c) ? (c.note || "—") : AVAILABILITY_LABEL[c.availabilitySignal]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NeedCard({ need, block, broader }: { need: RoleRankNeed; block: TradeBlockCandidate[]; broader: BroaderCandidate[] }) {
  const isInjuryDriven = need.excludedInjuredPlayers.length > 0 && need.unadjustedRankPct !== null && need.unadjustedRankPct > need.rankPct;
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 14px", background: "var(--color-surface)" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>{need.role}</h3>
      <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <span style={{ fontSize: "1.375rem", fontWeight: 700, ...percentileStyle(need.rankPct) }}>{fmt1(need.rating)}</span>
          <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", marginLeft: 6 }}>
            {need.leagueAvg !== null ? `Lg ${fmt1(need.leagueAvg)}` : "Lg —"}
          </span>
        </div>
        <div>
          <span style={{ fontSize: "1.375rem", fontWeight: 700, ...percentileStyle(need.rankPct) }}>{rankLabel(need.rank, need.totalTeams)}</span>
          <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", marginLeft: 6 }}>rank ({need.rankPct.toFixed(0)}th pct)</span>
        </div>
        {isInjuryDriven && (
          <span style={{ fontSize: "0.75rem", color: "rgb(220,38,38)" }}>
            Injury-driven -- would rank {need.unadjustedRankPct?.toFixed(0)}th pct healthy: {need.excludedInjuredPlayers.map((p) => `${p.name} (${p.daysLeft}d)`).join(", ")}
          </span>
        )}
      </div>
      <CandidateTable title="On the Trade Block" rows={block} />
      <CandidateTable title="Other Plausible Targets" rows={broader} />
    </div>
  );
}

export default function NeedCards({
  needs, blockMatches, broaderMatches,
}: {
  needs: RoleRankNeed[];
  blockMatches: NeedWithTradeBlockCandidates[];
  broaderMatches: NeedWithBroaderCandidates[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {needs.map((need) => (
        <NeedCard
          key={need.role}
          need={need}
          block={blockMatches.find((m) => m.need.role === need.role)?.candidates ?? []}
          broader={broaderMatches.find((m) => m.need.role === need.role)?.candidates ?? []}
        />
      ))}
    </div>
  );
}
