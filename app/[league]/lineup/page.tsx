import Link from "next/link";
import { getOptimalLineups, type LineupSlot, type LineupSlotPlayer } from "@/lib/lineup-optimizer-query";
import { gradeStyle } from "@/lib/display-helpers";
import { resolveLeagueId, resolveDefaultOrgId } from "@/lib/league";

export const dynamic = "force-dynamic";

const fmt1 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(1));
// 0-1 ratio -> ".XXX", the standard baseball convention (no leading zero) --
// same formatting rule ProspectTable.tsx's own `rate()` already uses.
const rate = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(3).replace(/^0/, ""));

// Real season performance, one combined string per player (2026-09-13,
// Rees's ask: "track performance vs each pitching hand (avg/slg/ops/ops+),
// as well as ZR at the position they are listed at" -- then trimmed the
// same day to just PA/OPS/OPS+/ZR once the original 5-stat version made an
// already-wide table scroll horizontally badly enough to be unusable).
// Additive to Bat vs Hand/Defense (the scouted numbers that actually build
// the lineup) -- this is real, observed performance, shown for context
// only. `isFallback` gets a trailing, deliberately subtle "*" (not a
// leading "YYYY:" prefix, per Rees's ask for something quieter) --
// LineupPage renders one shared footnote naming the actual year once,
// rather than repeating it on every row. ZR is omitted entirely for DH (no
// fielding position to report) rather than shown as a dash, to avoid
// implying a real "no defensive value" ZR of zero was actually on file.
function realStatLine(p: LineupSlotPlayer, isFallback: boolean): string {
  if (p.paVsHand === null) return "No Stats";
  const opsPlusPart = p.opsPlusVsHand !== null ? ` (${p.opsPlusVsHand})` : "";
  const zrPart = p.zrAtPosition !== null ? ` · ${fmt1(p.zrAtPosition)} ZR` : "";
  const star = isFallback ? "*" : "";
  return `${p.paVsHand} PA · ${rate(p.opsVsHand)} OPS${opsPlusPart}${zrPart}${star}`;
}

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

function PlayerCell({ player, sideLabel, league, statsIsFallback }: { player: LineupSlotPlayer | null; sideLabel: string; league: string; statsIsFallback: boolean }) {
  if (!player) {
    return (
      <>
        <td colSpan={4} style={{ color: "var(--color-text-muted, #888)", textAlign: "center" }}>
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
      <td style={{ whiteSpace: "nowrap", fontSize: "0.85em" }} title="Real PA/OPS/OPS+ vs. this hand, and ZR at this exact position -- observed performance, shown for context, not used to build the lineup">
        {realStatLine(player, statsIsFallback)}
      </td>
    </>
  );
}

// Renders backup slot N (0-indexed) out of a slot's backups[] array -- a
// missing entry (roster doesn't have that many eligible bodies) renders the
// same "no eligible player" cell PlayerCell shows for a missing starter,
// rather than leaving a blank gap that could be mistaken for a table glitch.
function BackupCell({ backups, index, sideLabel, league, statsIsFallback }: { backups: LineupSlotPlayer[]; index: number; sideLabel: string; league: string; statsIsFallback: boolean }) {
  return <PlayerCell player={backups[index] ?? null} sideLabel={sideLabel} league={league} statsIsFallback={statsIsFallback} />;
}

function LineupTable({ slots, sideLabel, league, statsIsFallback }: { slots: LineupSlot[]; sideLabel: string; league: string; statsIsFallback: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: "bottom" }}>Pos</th>
            <th colSpan={4}>Starter</th>
            <th colSpan={4}>Backup 1</th>
            <th colSpan={4}>Backup 2</th>
          </tr>
          <tr>
            <th style={thWrap}>Name</th>
            <th style={thWrap} title={`Batting rating vs. ${sideLabel}`}>Bat</th>
            <th style={thWrap} title="Current position grade (0-80) at this exact spot">Def</th>
            <th style={thWrap} title="Real PA/OPS/OPS+ vs. this hand, and ZR at this exact position -- for context, not used to build the lineup">Stats</th>
            <th style={thWrap}>Name</th>
            <th style={thWrap} title={`Batting rating vs. ${sideLabel}`}>Bat</th>
            <th style={thWrap} title="Current position grade (0-80) at this exact spot">Def</th>
            <th style={thWrap} title="Real PA/OPS/OPS+ vs. this hand, and ZR at this exact position -- for context, not used to build the lineup">Stats</th>
            <th style={thWrap}>Name</th>
            <th style={thWrap} title={`Batting rating vs. ${sideLabel}`}>Bat</th>
            <th style={thWrap} title="Current position grade (0-80) at this exact spot">Def</th>
            <th style={thWrap} title="Real PA/OPS/OPS+ vs. this hand, and ZR at this exact position -- for context, not used to build the lineup">Stats</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.position}>
              <td style={{ fontWeight: 700, textAlign: "left" }}>{slot.position}</td>
              <PlayerCell player={slot.starter} sideLabel={sideLabel} league={league} statsIsFallback={statsIsFallback} />
              <BackupCell backups={slot.backups} index={0} sideLabel={sideLabel} league={league} statsIsFallback={statsIsFallback} />
              <BackupCell backups={slot.backups} index={1} sideLabel={sideLabel} league={league} statsIsFallback={statsIsFallback} />
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
          build these lineups. &quot;Stats&quot; is real, observed MLB performance shown alongside for context only:
          plate appearances and OPS (with OPS+ in parens) against this exact pitcher handedness, plus ZR at this
          exact position. &quot;Backup 1&quot;/&quot;Backup 2&quot; are the two best remaining eligible players at
          that position who aren&apos;t already starting elsewhere in this same lineup — the same bench player can be
          listed as a backup at more than one spot.
          A sim in this league covers about two weeks, so any hitter currently projected to miss{" "}
          <strong>5 or more days</strong> is left out of both lineups entirely, not just scored lower — see the list
          below if one of your regulars is missing.
        </p>
        {statsIsFallback && statsYear !== null && (
          <p style={{ color: "var(--color-text-muted, #888)", fontSize: 11, marginTop: -6 }}>
            * this season doesn&apos;t have enough at-bats on file yet — &quot;Stats&quot; is showing {statsYear} instead.
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
      <LineupTable slots={vsLHP} sideLabel="LHP" league={league} statsIsFallback={statsIsFallback} />

      <h2 style={{ margin: "2rem 0 0.5rem" }}>vs. Right-Handed Pitching</h2>
      <LineupTable slots={vsRHP} sideLabel="RHP" league={league} statsIsFallback={statsIsFallback} />

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
