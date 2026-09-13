import Link from "next/link";
import { getOptimalLineups, type LineupSlot, type LineupSlotPlayer } from "@/lib/lineup-optimizer-query";
import { gradeStyle } from "@/lib/display-helpers";
import { resolveLeagueId, resolveDefaultOrgId } from "@/lib/league";

export const dynamic = "force-dynamic";

const fmt1 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(1));
// 0-1 ratio -> ".XXX", the standard baseball convention (no leading zero) --
// same formatting rule ProspectTable.tsx's own `rate()` already uses.
const rate = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(3).replace(/^0/, ""));

// Real season performance (2026-09-13, Rees's ask: "track performance vs
// each pitching hand (avg/slg/ops/ops+), as well as ZR at the position
// they are listed at" -- trimmed to PA/OPS/OPS+/ZR once the original
// 5-stat version made the table scroll badly, then that trimmed version
// STILL combined all four into one wide text cell per player-slot, which
// turned out to be the real problem: a "145 PA · .806 OPS (112) · 12.7 ZR"
// string needs a much wider column than four narrow tabular-numeric
// columns do, even though it's "the same" four numbers -- repeating a unit
// label ("PA"/"OPS"/"ZR") in every single row wastes far more space than
// stating it once in the column header. Split into 4 real columns
// (2026-09-13, Rees: "make the stats their own columns... think more
// critically") -- each just a plain number now, "—" when null exactly
// like Def already does for DH's positionGrade, no special-casing needed.
// No more per-row fallback-year asterisk either: statsIsFallback is one
// flag for the WHOLE page (every player here shares it), so the page-level
// footnote already says it once, accurately, for every row -- repeating a
// marker that's true for 100% of rows on every single row is exactly the
// kind of redundant text this whole pass is about removing.

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

// Headers wrap instead of forcing the sitewide nowrap rule (globals.css's
// base `th` rule), same pattern PlayerTable.tsx already established
// (2026-09-04) for the same reason: a short, wrapped 2-line label beats a
// column stretched to fit one long unwrapped line. Real fix for "the grid
// doesn't fit"/horizontal scroll, per Rees's ask -- this table has three
// full player-slots side by side, so it needs this more than most.
const thWrap: React.CSSProperties = { whiteSpace: "normal", lineHeight: 1.2, maxWidth: "4.5rem" };

function PlayerCell({ player, sideLabel, league }: { player: LineupSlotPlayer | null; sideLabel: string; league: string }) {
  if (!player) {
    return (
      <>
        <td colSpan={7} style={{ color: "var(--color-text-muted, #888)", textAlign: "center" }}>
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
      <td title="Real plate appearances vs. this hand">{player.paVsHand === null ? "—" : player.paVsHand}</td>
      <td title="Real OPS vs. this hand">{rate(player.opsVsHand)}</td>
      <td title="Real OPS+ vs. this hand (100 = league average for this split)">{player.opsPlusVsHand === null ? "—" : player.opsPlusVsHand}</td>
      <td title="Real Zone Rating at this exact position">{player.zrAtPosition === null ? "—" : fmt1(player.zrAtPosition)}</td>
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

// One player-slot's sub-header row -- pulled into its own component since
// it's now 7 columns repeated identically 3 times (Starter/Backup 1/Backup
// 2), and typing that out by hand a third time is exactly the kind of
// thing that drifts out of sync (see the Def/PA/OPS wording staying
// consistent across all three by construction, not by careful copy-paste).
function PlayerSubHeaders({ sideLabel }: { sideLabel: string }) {
  return (
    <>
      <th style={thWrap}>Name</th>
      <th style={thWrap} title={`Batting rating vs. ${sideLabel}`}>Bat</th>
      <th style={thWrap} title="Current position grade (0-80) at this exact spot">Def</th>
      <th style={thWrap} title="Real plate appearances vs. this hand">PA</th>
      <th style={thWrap} title="Real OPS vs. this hand">OPS</th>
      <th style={thWrap} title="Real OPS+ vs. this hand (100 = league average for this split)">OPS+</th>
      <th style={thWrap} title="Real Zone Rating at this exact position">ZR</th>
    </>
  );
}

function LineupTable({ slots, sideLabel, league }: { slots: LineupSlot[]; sideLabel: string; league: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Pos</th>
            <th colSpan={7}>Starter</th>
            <th colSpan={7}>Backup 1</th>
            <th colSpan={7}>Backup 2</th>
          </tr>
          <tr>
            <PlayerSubHeaders sideLabel={sideLabel} />
            <PlayerSubHeaders sideLabel={sideLabel} />
            <PlayerSubHeaders sideLabel={sideLabel} />
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
  const { vsLHP, vsRHP, injuredOut, unused, statsYear, statsIsFallback } = await getOptimalLineups(leagueId, orgId);

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
          &quot;Bat&quot; is that player&apos;s Batting-shaped rating specifically against that pitcher handedness
          (not his flat, unblended Batting grade); &quot;Def&quot; is his current position grade (0–80) at that exact
          spot. Selection blends the two 70/30 in favor of the bat — both are scouted ratings, and are what actually
          build these lineups. &quot;PA&quot;/&quot;OPS&quot;/&quot;OPS+&quot;/&quot;ZR&quot; are real, observed
          MLB performance shown alongside for context only (not used to build the lineup): plate appearances and OPS
          against this exact pitcher handedness, OPS+ against a real league-wide baseline for that same split, and
          Zone Rating at this exact position. &quot;Backup 1&quot;/&quot;Backup 2&quot; are the two best remaining
          eligible players at that position who aren&apos;t already starting elsewhere in this same lineup — the
          same bench player can be listed as a backup at more than one spot.
          A sim in this league covers about two weeks, so any hitter currently projected to miss{" "}
          <strong>5 or more days</strong> is left out of both lineups entirely, not just scored lower — see the list
          below if one of your regulars is missing.
        </p>
        {statsIsFallback && statsYear !== null && (
          <p style={{ color: "var(--color-text-muted, #888)", fontSize: 11, marginTop: -6 }}>
            This season doesn&apos;t have enough at-bats on file yet — PA/OPS/OPS+/ZR below are all showing {statsYear} instead.
          </p>
        )}
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

      {unused.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2 style={{ margin: "0 0 0.5rem" }}>Not Finding Playing Time</h2>
          <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, marginTop: 0, marginBottom: 10 }}>
            Healthy, eligible hitters who aren&apos;t a starter or primary (Backup 1) anywhere in either lineup above
            — real candidates for a minors option to open a roster spot, since the best role this finds for them
            anywhere is third-string or deeper. Sorted by Overall, highest first.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={thWrap}>Name</th>
                  <th style={thWrap}>Overall</th>
                  <th style={thWrap}>Eligible Positions</th>
                </tr>
              </thead>
              <tbody>
                {unused.map((p) => (
                  <tr key={p.playerId}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link href={`/${league}/players/${p.playerId}`} style={{ color: "inherit" }}>{p.name}</Link>
                    </td>
                    <td style={gradeStyle(p.overall)}>{p.overall === null ? "—" : fmt1(p.overall)}</td>
                    <td>{p.eligiblePositions.length > 0 ? p.eligiblePositions.join("/") : "DH only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
