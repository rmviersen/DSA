import { getRatingValidationPoints } from "../../../lib/rating-validation-query";
import RatingValidationExplorer from "./RatingValidationExplorer";

export const dynamic = "force-dynamic";

// Rating-engine validity check (2026-08-31, Rees's ask) -- frames a
// potential future redesign of the grading/weighting system by testing how
// well Overall (and each individual weighted grade input) actually predicts
// real 2031 production. Owner-only automatically, same as the rest of
// /admin. Only one season of real data exists right now -- explicitly a
// directional first look, not a final verdict; gets more reliable every
// season as more real outcomes accumulate, same trajectory as
// /admin/market-rates.

const pageTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.75rem",
  fontWeight: 700,
  margin: "0 0 0.25rem",
  color: "var(--color-heading)",
} as const;

export default async function RatingValidationPage() {
  const points = await getRatingValidationPoints();

  if (points.length === 0) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={pageTitleStyle}>Rating Validation</h1>
        <p style={{ color: "var(--color-text-muted)" }}>No 2031 MLB stats + ratings data found to compare yet.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={pageTitleStyle}>Rating Validation</h1>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 1.5rem", maxWidth: 760 }}>
        Does the rating engine&apos;s Overall actually predict real production? Compares Overall — and
        every individual grade that feeds into it — against real 2031 MLB WAR for {points.length} players
        with meaningful playing time. Only one season of real outcomes exists so far, so treat this as a
        directional first look, not a final verdict — it gets more reliable every season as more real
        results accumulate.
      </p>
      <RatingValidationExplorer points={points} />
    </div>
  );
}
