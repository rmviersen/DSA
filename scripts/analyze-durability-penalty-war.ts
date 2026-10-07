// Durability-penalty investigation (2026-10-07), part 1/3: how many WAR is one raw rating point worth for hitters / starters / relievers, and what raw
// score is replacement level? Regresses season WAR/100 PA|IP on RAW Overall (same data as /admin/rating-validation). Read-only.
// Output feeds part 3 (replacement levels P0) and the WAR-equivalent of the flat -5 Fragile penalty. Run: npx tsx scripts/analyze-durability-penalty-war.ts
import "dotenv/config";
import { getRatingValidationPoints } from "../lib/rating-validation-query";
import { fitLine } from "../lib/regression";

(async () => {
  const pts = await getRatingValidationPoints(1);
  const groups: Record<string, typeof pts> = {
    Hitters: pts.filter((p) => p.playerType === "hitter"),
    "SP": pts.filter((p) => p.role === "SP"),
    "RP": pts.filter((p) => p.role === "RP"),
  };
  const perSeason: Record<string, number> = { Hitters: 6.0, SP: 1.8, RP: 0.65 }; // typical full-season PA/100 or IP/100
  for (const [name, g] of Object.entries(groups)) {
    const fit = fitLine(g.map((p) => ({ x: p.overall, y: p.warRate })));
    const p0 = -fit.intercept / fit.slope;
    const warPerRawPerSeason = fit.slope * perSeason[name];
    console.log(
      `${name.padEnd(8)} n=${g.length}  warRate = ${fit.intercept.toFixed(3)} + ${fit.slope.toFixed(4)} * rawOverall  (R2 ${fit.rSquared.toFixed(3)})` +
      `  replacement(raw)=${p0.toFixed(1)}  WAR per raw point per full season=${warPerRawPerSeason.toFixed(3)}  mean raw=${(g.reduce((s, p) => s + p.overall, 0) / g.length).toFixed(1)}`
    );
  }
})();
