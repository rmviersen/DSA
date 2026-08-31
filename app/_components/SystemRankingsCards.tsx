"use client";

import { useState } from "react";
import Link from "next/link";
import type { SystemRankingCardRow, SystemRankingProspect } from "../../lib/system-rankings-query";
import { percentileStyle, statsPlusPlayerUrl } from "../../lib/display-helpers";

const rankLabel = (n: number | null) => (n === null ? "—" : `#${n}`);

// Same owner/guest split as ProspectTable.tsx's player-name links (2026-08-31)
// -- a guest (or an owner previewing as one) only ever gets the external
// StatsPlus link, never the internal /players/[id] page, which is already
// owner-only at the middleware level regardless of what any page links to.
function ProspectLink({ p, showInternalLinks }: { p: SystemRankingProspect; showInternalLinks: boolean }) {
  if (showInternalLinks) {
    return (
      <>
        <Link href={`/players/${p.player_id}`} className="system-prospect-name">
          {p.name}
        </Link>
        <a href={statsPlusPlayerUrl(p.player_id)} target="_blank" rel="noopener noreferrer" title="View on StatsPlus" style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>
          ↗
        </a>
      </>
    );
  }
  return (
    <a href={statsPlusPlayerUrl(p.player_id)} target="_blank" rel="noopener noreferrer" className="system-prospect-name">
      {p.name}
    </a>
  );
}

function ProspectColumn({ title, prospects, showInternalLinks }: { title: string; prospects: SystemRankingProspect[]; showInternalLinks: boolean }) {
  return (
    <div className="system-card-column">
      <h3>{title}</h3>
      {prospects.length === 0 ? (
        <p className="system-prospect-empty">No ranked prospects</p>
      ) : (
        <ol className="system-prospect-list">
          {prospects.map((p) => (
            <li key={p.player_id}>
              <span className="system-prospect-rank">{rankLabel(p.rank)}</span>
              <span className="system-prospect-role">{p.role ?? "—"}</span>
              <ProspectLink p={p} showInternalLinks={showInternalLinks} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// mm/dd/yy, same convention as ProspectTable.tsx's fmtStaleDate -- UTC-based
// so it never drifts with the viewer's own timezone.
function fmtStaleDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

export function SystemRankingsCards({ rows, showInternalLinks }: { rows: SystemRankingCardRow[]; showInternalLinks: boolean }) {
  // Bios default folded, same as ProspectTable's prospect bios -- an org
  // analysis has to be explicitly expanded, per-card, to read it.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(teamId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  if (rows.length === 0) {
    return <p className="empty-state">No team rankings available.</p>;
  }

  return (
    <div className="system-cards">
      {rows.map((r) => {
        const isOpen = expanded.has(r.team_id);
        const hasBio = !!r.bio;

        // Same whole-card click-to-expand pattern as ProspectTable.tsx --
        // closest("a") excludes real links (player names, the StatsPlus
        // icon, a team logo link if one's ever added) automatically.
        function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
          if (!hasBio) return;
          if ((e.target as HTMLElement).closest("a")) return;
          toggle(r.team_id);
        }
        function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
          if (!hasBio) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(r.team_id);
          }
        }

        return (
          <div
            key={r.team_id}
            className={`system-card${hasBio ? " prospect-card--clickable" : ""}`}
            onClick={handleCardClick}
            onKeyDown={hasBio ? handleCardKeyDown : undefined}
            role={hasBio ? "button" : undefined}
            tabIndex={hasBio ? 0 : undefined}
            aria-expanded={hasBio ? isOpen : undefined}
          >
            <div className="system-card-header">
              <div className="system-card-team">
                {r.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.logoUrl} alt="" className="system-card-logo" />
                )}
                <span className="system-card-name">{r.name} {r.nickname}</span>
              </div>
              <div className="system-card-ranks">
                <span className="system-rank-item">
                  <span className="system-rank-label">System</span>
                  <span className="system-rank-value" style={percentileStyle(r.minorsRankPercentile)}>{rankLabel(r.minorsRank)}</span>
                </span>
                <span className="system-rank-item">
                  <span className="system-rank-label">Batting</span>
                  <span className="system-rank-value" style={percentileStyle(r.battingRankPercentile)}>{rankLabel(r.battingProspectRank)}</span>
                </span>
                <span className="system-rank-item">
                  <span className="system-rank-label">Pitching</span>
                  <span className="system-rank-value" style={percentileStyle(r.pitchingRankPercentile)}>{rankLabel(r.pitchingProspectRank)}</span>
                </span>
                <span className="system-rank-item">
                  <span className="system-rank-label">Readiness</span>
                  <span className="system-rank-value" style={percentileStyle(r.readinessRankPercentile)}>{rankLabel(r.readinessRank)}</span>
                </span>
              </div>
            </div>

            <div className="system-card-columns">
              <ProspectColumn title="Top Hitters" prospects={r.topHitters} showInternalLinks={showInternalLinks} />
              <ProspectColumn title="Top Pitchers" prospects={r.topPitchers} showInternalLinks={showInternalLinks} />
            </div>

            {/* Balance removed from display 2026-08-31 (Rees's ask -- "a
                bit misleading") -- the balance PENALTY is still very much
                part of minor_league_rating/minors_rank's actual math (see
                system-rank-methodology.md), this only drops the standalone
                word-grade badge for it. Blue-Chip/Depth stay. */}
            <div className="system-grade-breakdown">
              <span>Blue-Chip <b style={r.blueChip ? percentileStyle(r.blueChip.percentile) : undefined}>{r.blueChip?.word ?? "—"}</b></span>
              <span>Depth <b style={r.depth ? percentileStyle(r.depth.percentile) : undefined}>{r.depth?.word ?? "—"}</b></span>
              {hasBio && (
                <span className="prospect-bio-indicator" style={{ marginLeft: "auto" }}>
                  ANALYSIS {isOpen ? "▲" : "▼"}
                </span>
              )}
            </div>

            {isOpen && hasBio && (
              <div className="prospect-bio-expanded">
                {r.bio}
                {r.bioStale && (
                  <span style={{ marginLeft: 8, color: "var(--color-text-muted)", fontSize: "0.75rem" }} title="This analysis was written against an older data snapshot">
                    ⚠ stale since {r.bioDate ? fmtStaleDate(r.bioDate) : "unknown date"}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
