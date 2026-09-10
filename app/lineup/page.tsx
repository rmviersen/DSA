import Link from "next/link";
import { getOptimalLineups, type LineupSlot, type LineupSlotPlayer } from "@/lib/lineup-optimizer-query";
import { gradeStyle } from "@/lib/display-helpers";

export const dynamic = "force-dynamic";

// Oklahoma City Outlaws, org id 15 -- same convention as every other "my
// roster"-scoped page (/my-roster, /org-minors, /rule5-draft).
const DEFAULT_ORG_ID = 15;

const fmt1 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(1));

// Optimal Lineup (2026-09-10, Rees's ask) -- two independent 9-man lineups,
// one built for facing a left-handed starter and one for a right-handed
// starter, each a real assignment-problem solve (not just "best bat per
// position independently") so a hitter eligible at more than one spot gets
// placed where the WHOLE lineup benefits most. Full spec, the clarifying
// questions asked before building this, and the answers that shaped it
// (potential vs. current position grade for eligibility, position-specific
// vs. general fielding grade for the defense score, one-backup-per-position
// vs. one-overall) live in HANDOFF.md and lib/lineup-optimizer-query.ts's own
// header comment.

function PlayerCell({ player, sideLabel }: { player: LineupSlotPlayer | null; sideLabel: string }) {
  if (!player) {
    return (
      <>
        <td colSpan={3} style={{ color: "var(--color-text-muted, #888)", textAlign: "center" }}>
          No eligible player on the active roster
        </td>
      </>
    );
  }
  return (
    <>
      <td style={{ whiteSpace: "nowrap" }}>
        <Link href={`/players/${player.playerId}`} style={{ color: "inherit" }}>{player.name}</Link>
      </td>
      <td style={gradeStyle(player.battingVsHand)} title={`Batting rating vs. ${sideLabel}`}>
        {fmt1(player.battingVsHand)}
      </td>
      <td style={gradeStyle(player.positionGrade)}>{player.positionGrade === null ? "—" : Math.round(player.positionGrade)}</td>
    </>
  );
}

function LineupTable({ slots, sideLabel }: { slots: LineupSlot[]; sideLabel: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Pos</th>
            <th colSpan={3}>Starter</th>
            <th colSpan={3}>Backup</th>
          </tr>
          <tr>
            <th>Name</th>
            <th title={`Batting rating vs. ${sideLabel}`}>Bat vs {sideLabel}</th>
            <th title="Current position grade (0-80) at this exact spot">Defense</th>
            <th>Name</th>
            <th title={`Batting rating vs. ${sideLabel}`}>Bat vs {sideLabel}</th>
            <th title="Current position grade (0-80) at this exact spot">Defense</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.position}>
              <td style={{ fontWeight: 700, textAlign: "left" }}>{slot.position}</td>
              <PlayerCell player={slot.starter} sideLabel={sideLabel} />
              <PlayerCell player={slot.backup} sideLabel={sideLabel} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function LineupPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const params = await searchParams;
  const orgId = params.org ? Number(params.org) : DEFAULT_ORG_ID;
  const { vsLHP, vsRHP } = await getOptimalLineups(orgId);

  return (
    <>
      <header className="page-header">
        <h1>Optimal Lineup</h1>
        <p>
          Two independent 9-man lineups (this league runs with a DH always in the lineup, so no pitcher spot) — one
          built for facing a left-handed starter, one for a right-handed starter. Eligible players at each position
          are those with a Potential position grade of at least 55 there; among those, each lineup solves for the
          highest-value assignment of players to positions at once (not just the best bat at each spot in isolation —
          a player eligible at more than one position is placed wherever the whole lineup benefits most).
          &quot;Bat vs L/R&quot; is that player&apos;s Batting-shaped rating specifically against that pitcher
          handedness (not his flat, unblended Batting grade); &quot;Defense&quot; is his current position grade
          (0–80) at that exact spot. Selection blends the two 70/30 in favor of the bat. &quot;Backup&quot; is the
          best remaining eligible player at that position who isn&apos;t already starting elsewhere in this same
          lineup — the same bench player can be listed as the backup at more than one spot. Only healthy (or
          day-to-day / back within a week) active-roster players are considered.
        </p>
      </header>

      <h2 style={{ margin: "0 0 0.5rem" }}>vs. Left-Handed Pitching</h2>
      <LineupTable slots={vsLHP} sideLabel="LHP" />

      <h2 style={{ margin: "2rem 0 0.5rem" }}>vs. Right-Handed Pitching</h2>
      <LineupTable slots={vsRHP} sideLabel="RHP" />
    </>
  );
}
