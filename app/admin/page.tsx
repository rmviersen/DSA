import { getRecentRefreshRuns, getFreshnessCheck, getRecentPlatformEvents } from "../../lib/admin-queries";

export const dynamic = "force-dynamic";

// Admin Dashboard (2026-08-28) -- Rees's intended home page as site owner,
// per the plan worked out with Cowork: platform status, his own team,
// reporting, and site performance. Automatically owner-only already --
// nothing under /admin is in middleware.ts's GUEST_ALLOWED_PATHS, so no new
// auth work needed here. This is §1 (Platform Status) only; §2 (My Team),
// §3 (Reporting log), and §4 (Site Performance) are deliberately separate,
// later additions -- see HANDOFF.md.

const sectionTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.1875rem",
  fontWeight: 700,
  margin: "0 0 0.75rem",
  color: "var(--color-heading)",
} as const;

const cardStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)",
  padding: "1rem 1.25rem",
} as const;

const SEVERITY_COLOR: Record<string, string> = {
  info: "var(--color-text-muted, #888)",
  warning: "var(--color-tan, #a8763a)",
  error: "#c0392b",
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.625rem",
        borderRadius: 999,
        fontSize: "0.8125rem",
        fontWeight: 600,
        color: "#fff",
        background: ok ? "var(--color-green, #3a7d44)" : "#c0392b",
      }}
    >
      {label}
    </span>
  );
}

export default async function AdminPage() {
  const [runs, freshness, events] = await Promise.all([
    getRecentRefreshRuns(5),
    getFreshnessCheck(),
    getRecentPlatformEvents(20),
  ]);
  const latestRun = runs[0] as (typeof runs)[number] | undefined;

  return (
    <>
      <header className="page-header">
        <h1>Admin</h1>
        <p>Platform status, at a glance.</p>
      </header>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionTitleStyle}>Platform Status</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
          <div style={cardStyle}>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-text-muted, #888)", marginBottom: "0.375rem" }}>Last refresh</div>
            {latestRun ? (
              <>
                <div style={{ fontSize: "1.0625rem", fontWeight: 700 }}>{latestRun.game_date ?? "(no game date)"}</div>
                <div style={{ fontSize: "0.8125rem", color: "var(--color-text-muted, #888)", marginTop: "0.25rem" }}>
                  {new Date(latestRun.started_at).toLocaleString()}
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <StatusPill ok={latestRun.status === "succeeded"} label={latestRun.status} />
                </div>
              </>
            ) : (
              <div>No refresh runs found.</div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-text-muted, #888)", marginBottom: "0.375rem" }}>Data freshness</div>
            <div style={{ fontSize: "1.0625rem", fontWeight: 700 }}>
              {freshness.statsPlusCurrentGameDate ?? "unknown"}
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-text-muted, #888)", marginTop: "0.25rem" }}>
              StatsPlus's real current game date{freshness.lastRefreshedGameDate ? ` (last refreshed: ${freshness.lastRefreshedGameDate})` : ""}
            </div>
            <div style={{ marginTop: "0.5rem" }}>
              <StatusPill ok={!freshness.isStale} label={freshness.isStale ? "New data waiting" : "Up to date"} />
            </div>
          </div>
        </div>

        <h3 style={{ ...sectionTitleStyle, fontSize: "1rem", marginTop: "1.5rem" }}>Recent refresh runs</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Game date</th>
                <th>Started</th>
                <th>Status</th>
                <th>Ratings included</th>
                <th>Players</th>
                <th>Teams</th>
              </tr>
            </thead>
            <tbody>
              {/* Players/Teams (2026-08-28, Rees's ask): row counts in
                  player_computed/team_computed for that run -- the same
                  "did everyone actually get captured" check this project has
                  been doing by hand via SQL all day, now visible at a glance.
                  32 is TheBigLeague's real, fixed team count (confirmed
                  repeatedly this session) -- a real, permanent number worth
                  flagging against directly, unlike the player count, which
                  drifts run to run (call-ups, retirements) and is better
                  judged by eye against the other rows than a fixed target. */}
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.game_date ?? "—"}</td>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td><StatusPill ok={r.status === "succeeded"} label={r.status} /></td>
                  <td>{r.ratings_included ? "Yes" : "No"}</td>
                  {/* A run still in progress legitimately has 0 rows so far --
                      only flag a zero/wrong count as a problem once the run
                      has actually finished (status !== "running"), or every
                      in-flight run would show a false alarm. */}
                  <td style={{ color: r.playerCount === 0 && r.status !== "running" ? "#c0392b" : undefined, fontWeight: r.playerCount === 0 && r.status !== "running" ? 700 : undefined }}>
                    {r.playerCount.toLocaleString()}
                  </td>
                  <td style={{ color: r.teamCount !== 32 && r.status !== "running" ? "#c0392b" : undefined, fontWeight: r.teamCount !== 32 && r.status !== "running" ? 700 : undefined }}>
                    {r.teamCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ ...sectionTitleStyle, fontSize: "1rem", marginTop: "1.5rem" }}>Event log</h3>
        {events.length === 0 ? (
          <p style={{ color: "var(--color-text-muted, #888)" }}>No events logged yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Severity</th>
                  <th>Source</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                    <td style={{ color: SEVERITY_COLOR[e.severity] ?? undefined, fontWeight: 600 }}>{e.severity}</td>
                    <td>{e.source}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
