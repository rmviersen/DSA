import { getDraftPickValueCurve, getDraftPickValuePlayers } from "../../../lib/draft-pick-value-query";
import DraftPickValueExplorer from "./DraftPickValueExplorer";

export const dynamic = "force-dynamic";

// Draft-pick value curve (2026-09-04, Rees's ask) -- Phase A step 2 of the
// trade-value engine (see HANDOFF.md's transaction-analysis section). Same
// visual/interactive pattern as /admin/market-rates and /admin/rating-
// validation. Owner-only automatically (nothing under /admin is in
// middleware.ts's GUEST_ALLOWED_PATHS).

const pageTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.75rem",
  fontWeight: 700,
  margin: "0 0 0.25rem",
  color: "var(--color-heading)",
} as const;

export default async function DraftPickValuePage() {
  const [rounds, players] = await Promise.all([getDraftPickValueCurve(), getDraftPickValuePlayers()]);

  if (rounds.length === 0) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={pageTitleStyle}>Draft Pick Value</h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          No draft-pick value data on file yet. Run <code>npm run compute-draft-pick-value</code> to seed this page.
        </p>
      </div>
    );
  }

  const oldestDraftYear = Math.min(...players.map((p) => p.draftYear));
  const newestDraftYear = Math.max(...players.map((p) => p.draftYear));

  return (
    <div style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={pageTitleStyle}>Draft Pick Value</h1>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 1.5rem", maxWidth: 780 }}>
        Real career value by draft round, built from our own league&apos;s draft history ({oldestDraftYear}–{newestDraftYear} draft
        classes, {players.length.toLocaleString()} players) — not a borrowed external chart. Outcome is real MLB career WAR
        accumulated since being drafted, divided by years since draft, so a recent pick still early in his career isn&apos;t
        penalized against one who&apos;s had decades to accumulate value. This is the piece that will feed the trade-value
        composite&apos;s draft-pick component — see HANDOFF.md for the full methodology and its known caveats.
      </p>
      <DraftPickValueExplorer rounds={rounds} players={players} />
    </div>
  );
}
