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

// Same formatting convention as PlayerTable.tsx's fmtMoney -- kept as its
// own local copy rather than a shared import, matching that file's existing
// precedent of each component owning its own small display helpers.
function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtUpgrade(n: number): string {
  return `+${n.toFixed(2)}`;
}

function rankLabel(rank: number | null, totalTeams: number | null): string {
  if (rank === null || totalTeams === null) return "—";
  return `${rank}/${totalTeams}`;
}

const AVAILABILITY_LABEL: Record<BroaderCandidate["availabilitySignal"], string> = {
  "short-control": "last year of contract",
  "weak-team": "weak team",
  both: "last year of contract + weak team",
};

const thStyle: CSSProperties = { padding: "2px 6px 2px 0", fontWeight: 600, fontSize: "0.6875rem", color: "var(--color-text-muted)", textAlign: "left", whiteSpace: "nowrap" };
const tdStyle: CSSProperties = { padding: "2px 6px 2px 0", fontSize: "0.75rem", whiteSpace: "nowrap" };

function CandidateTable({ title, rows }: { title: string; rows: (TradeBlockCandidate | BroaderCandidate)[] }) {
  const isBlock = (r: TradeBlockCandidate | BroaderCandidate): r is TradeBlockCandidate => "note" in r;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)", marginBottom: 2 }}>
        {title} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <p style={{ margin: "0 0 2px", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>None clear the bar right now.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Team</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Score</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Upgrade</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Contract</th>
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
                  <td style={{ ...tdStyle, textAlign: "right", color: "var(--color-text-muted)" }}>{fmtMoney(c.contractAav)}</td>
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
  const isInjuryDriven = need.excludedInjuredPlayers.length > 0 && need.unadjustedRankPct !== null && need.rankPct !== null && need.unadjustedRankPct > need.rankPct;
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 12px", background: "var(--color-surface)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "0.9375rem" }}>{need.role}</h3>
        {need.isNeed && (
          <span style={{
            fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
            color: "rgb(220,38,38)", background: "rgba(220,38,38,0.12)", borderRadius: 4, padding: "1px 6px",
          }}>
            Need
          </span>
        )}
        <span style={{ fontSize: "0.8125rem", ...percentileStyle(need.rankPct) }}>
          {fmt1(need.rating)} <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>(Lg {fmt1(need.leagueAvg)})</span>
        </span>
        <span style={{ fontSize: "0.8125rem", ...percentileStyle(need.rankPct) }}>
          {rankLabel(need.rank, need.totalTeams)} <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>({need.rankPct !== null ? need.rankPct.toFixed(0) : "—"}th pct)</span>
        </span>
        {isInjuryDriven && (
          <span style={{ fontSize: "0.75rem", color: "rgb(220,38,38)" }}>
            ⚠ injury-driven -- {need.unadjustedRankPct?.toFixed(0)}th pct healthy ({need.excludedInjuredPlayers.map((p) => `${p.name}, ${p.daysLeft}d`).join("; ")})
          </span>
        )}
      </div>
      <CandidateTable title="On the Trade Block" rows={block} />
      <CandidateTable title="Other Plausible Targets" rows={broader} />
    </div>
  );
}

// Every position with at least one real upgrade candidate gets a card now
// (2026-09-27, Rees: "display the best available upgrades at each
// position" -- no longer gated to just the bottom-third "needs"). Trade-
// block hits are emphasized two ways: within a card the block table already
// renders above the broader-scan table, and cards themselves are sorted so
// every position WITH a trade-block upgrade comes first (ranked by that
// upgrade's size), ahead of positions where only the broader scan found
// something.
export default function NeedCards({
  needs, blockMatches, broaderMatches,
}: {
  needs: RoleRankNeed[];
  blockMatches: NeedWithTradeBlockCandidates[];
  broaderMatches: NeedWithBroaderCandidates[];
}) {
  const cards = needs
    .map((need) => ({
      need,
      block: blockMatches.find((m) => m.need.role === need.role)?.candidates ?? [],
      broader: broaderMatches.find((m) => m.need.role === need.role)?.candidates ?? [],
    }))
    .filter((c) => c.block.length > 0 || c.broader.length > 0)
    .sort((a, b) => {
      const aHasBlock = a.block.length > 0, bHasBlock = b.block.length > 0;
      if (aHasBlock !== bHasBlock) return aHasBlock ? -1 : 1;
      const aBest = aHasBlock ? a.block[0].upgradeSize : a.broader[0].upgradeSize;
      const bBest = bHasBlock ? b.block[0].upgradeSize : b.broader[0].upgradeSize;
      return bBest - aBest;
    });

  if (cards.length === 0) {
    return <p>No real upgrades found at any position right now -- nothing on the trade block or in the broader scan clears what we can already field.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {cards.map((c) => (
        <NeedCard key={c.need.role} need={c.need} block={c.block} broader={c.broader} />
      ))}
    </div>
  );
}
