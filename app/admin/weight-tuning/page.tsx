import { getLatestWeightTuningSnapshots, getWeightTuningHistory } from "../../../lib/weight-tuning-query";
import WeightTuningExplorer from "./WeightTuningExplorer";

export const dynamic = "force-dynamic";

// Weight-tuning tracker (2026-09-02, Rees's ask: "I want to be able to
// visualize and track our regressions that are currently inputting into our
// current weights"). Displays what scripts/compute-{hitting,baserunning,
// pitching}-weights.ts already found, run every refresh (see refresh.ts) --
// this page computes nothing itself, it's a window onto that history.
// Owner-only automatically, same as the rest of /admin.

const pageTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.75rem",
  fontWeight: 700,
  margin: "0 0 0.25rem",
  color: "var(--color-heading)",
} as const;

export default async function WeightTuningPage() {
  const [snapshots, history] = await Promise.all([getLatestWeightTuningSnapshots(), getWeightTuningHistory()]);

  const hasAny = snapshots.hitting || snapshots.baserunning || snapshots.pitching_sp || snapshots.pitching_rp
    || snapshots.pitching_sp_war || snapshots.pitching_rp_war || snapshots.overall_blend;
  if (!hasAny) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={pageTitleStyle}>Weight Tuning</h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          No regressions on file yet. Run <code>npm run compute-hitting-weights</code>,{" "}
          <code>npm run compute-baserunning-weights</code>, <code>npm run compute-pitching-weights</code>, and{" "}
          <code>npm run compute-overall-blend-weights</code> to seed this page (they also run automatically on
          every future refresh).
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={pageTitleStyle}>Weight Tuning</h1>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 1.5rem", maxWidth: 760 }}>
        The regressions currently informing the rating engine&apos;s weights: hitting vs. park-adjusted OPS+,
        baserunning vs. real UBR, pitching vs. park-adjusted FIP- (split into separate SP and RP fits — starters
        and relievers lean on different tools, and each role has real, wide variance in every predictor, so
        splitting doesn&apos;t hit the restriction-of-range problem that killed the original role-bucketed
        fielding attempt), and — now that Batting/Fielding/Baserunning are each individually tuned — the blend
        that makes up a hitter&apos;s Overall, vs. real WAR/100 PA. Nothing here is written to{" "}
        <code>rating_weights</code> automatically — these are diagnostic, tracked over time so a real trend can
        be told apart from one season&apos;s noise.
      </p>
      <WeightTuningExplorer snapshots={snapshots} history={history} />
    </div>
  );
}
