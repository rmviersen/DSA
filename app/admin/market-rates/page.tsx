import { getLatestMarketRateCurves, getLatestRoleMultipliers, getTrainingContracts } from "../../../lib/market-rate-query";
import MarketRateExplorer from "./MarketRateExplorer";

export const dynamic = "force-dynamic";

// Market-rate tuning view (2026-08-31, Rees's ask) -- the first piece of the
// trade-value engine's contract-surplus component, made visible and
// inspectable rather than just console output from scripts/compute-market-
// rates.ts. Owner-only automatically (nothing under /admin is in
// middleware.ts's GUEST_ALLOWED_PATHS), same as the rest of /admin.

const pageTitleStyle = {
  fontFamily: "var(--font-display), system-ui, sans-serif",
  fontSize: "1.75rem",
  fontWeight: 700,
  margin: "0 0 0.25rem",
  color: "var(--color-heading)",
} as const;

export default async function MarketRatesPage() {
  const [curves, roleMultipliers, contracts] = await Promise.all([
    getLatestMarketRateCurves(),
    getLatestRoleMultipliers(),
    getTrainingContracts(),
  ]);

  if (contracts.length === 0) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={pageTitleStyle}>Market Rate Tuning</h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          No training contracts on file yet. Run <code>npm run scan-market-contracts</code> then{" "}
          <code>npm run compute-market-rates</code> to seed this page.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={pageTitleStyle}>Market Rate Tuning</h1>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 1.5rem", maxWidth: 720 }}>
        The reference curve every player's contract surplus is measured against, fit from{" "}
        {contracts.length} accumulated clean free-agent-market contracts. Grows every time a new
        clean contract is signed — see HANDOFF.md&apos;s transaction-analysis section for the full
        methodology and every filter&apos;s reasoning.
      </p>
      <MarketRateExplorer curves={curves} roleMultipliers={roleMultipliers} contracts={contracts} />
    </div>
  );
}
