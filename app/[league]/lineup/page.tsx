import Link from "next/link";
import { getOptimalLineups, type LineupSlot, type LineupSlotPlayer } from "@/lib/lineup-optimizer-query";
import { gradeStyle } from "@/lib/display-helpers";
import { resolveLeagueId, resolveDefaultOrgId } from "@/lib/league";

export const dynamic = "force-dynamic";

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

function PlayerCell({ player, sideLabel, league }: { player: LineupSlotPlayer | null; sideLabel: string; league: string }) {
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
        <Link href={`/${league}/players/${player.playerId}`} style={{ color: "inherit" }}>{player.name}</Link>
      </td>
      <td style={gradeStyle(player.battingVsHand)} title={`Batting rating vs. ${sideLabel}`}>
        {fmt1(player.battingVsHand)}
      </td>
      <td style={gradeStyle(player.positionGrade)}>{player.positionGrade === null ? "—" : Math.round(player.positionGrade)}</td>
    </>
  );
}

// Renders backup slot N (0-indexed) out of a slot's backups[] array -- a
// missing entry (roster doesn't have that many eligible bodies) renders the
// same "no eligible player" cell PlayerCell shows for a missing starter,
// rather than leaving a blank gap that could be mistaken for a table glitch.
function BackupCell({ backups, index, sideLabel, league }: { backups: LineupSlotPlayer[]; index: number; sideLabel: string; league: string }) {
  return <PlayerCell player={backups[index] ?? null} sideLabel={sideLabel} league={league} />;
}

function LineupTable({ slots, sideLabel, league }: { slots: LineupSlot[]; sideLabel: string; league: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Pos</th>
            <th colSpan={3}>Starter</th>
            <th colSpan={3}>Backup 1</th>
            <th colSpan={3}>Backup 2</th>
          </tr>
          <tr>
            <th>Name</th>
            <th title={`Batting rating vs. ${sideLabel}`}>Bat vs {sideLabel}</th>
            <th title="Current position grade (0-80) at this exact spot">Defense</th>
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
              <PlayerCell player={slot.starter} sideLabel={sideLabel} league={league} />
              <BackupCell backups={slot.backups} index={0} sideLabel={sideLabel} league={league} />
              <BackupCell backups={slot.backups} index={1} sideLabel={sideLabel} league={league} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function LineupPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { league } = await params;
  const search = await searchParams;
  const leagueId = await resolveLeagueId(league);
  const orgId = search.org ? Number(search.org) : await resolveDefaultOrgId(leagueId);
  const { vsLHP, vsRHP, injuredOut } = await getOptimalLineups(leagueId, orgId);

  return (
    <>
      <header className="page-header">
        <h1>Optimal Lineup</h1>
        <p>
          Two independent 9-man lineups (this league runs with a DH always in the lineup, so no pitcher spot) — one
          built for facing a left-handed starter, one for a right-handed starter. Eligible players at each position
          are those with a Potential position grade of at least 55 there (50 at catcher); among those, each lineup solves for the
          highest-value assignment of players to positions at once (not just the best bat at each spot in isolation —
          a player eligible at more than one position is placed wherever the whole lineup benefits most).
          &quot;Bat vs L/R&quot; is that player&apos;s Batting-shaped rating specifically against that pitcher
          handedness (not his flat, unblended Batting grade); &quot;Defense&quot; is his current position grade
          (0–80) at that exact spot. Selection blends the two 70/30 in favor of the bat. &quot;Backup 1&quot;/&quot;Backup
          2&quot; are the two best remaining eligible players at that position who aren&apos;t already starting
          elsewhere in this same lineup — the same bench player can be listed as a backup at more than one spot.
          A sim in this league covers about two weeks, so any hitter currently projected to miss{" "}
          <strong>5 or more days</strong> is left out of both lineups entirely, not just scored lower — see the list
          below if one of your regulars is missing.
        </p>
      </header>

      {injuredOut.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ margin: "0 0 0.5rem" }}>Out 5+ Days (excluded from both lineups)</h2>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {injuredOut.map((p) => (
              <li key={p.playerId}>
                <Link href={`/${league}/players/${p.playerId}`} style={{ color: "inherit" }}>{p.name}</Link>
                {" — "}
                {p.daysLeft === null ? "day count unknown" : `${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 style={{ margin: "0 0 0.5rem" }}>vs. Left-Handed Pitching</h2>
      <LineupTable slots={vsLHP} sideLabel="LHP" league={league} />

      <h2 style={{ margin: "2rem 0 0.5rem" }}>vs. Right-Handed Pitching</h2>
      <LineupTable slots={vsRHP} sideLabel="RHP" league={league} />
    </>
  );
}
