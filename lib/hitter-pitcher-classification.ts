// Hitter-or-pitcher label (the engine's `ph`), decided against PEERS rather than by comparing raw composites (2026-10-26, Rees: pitchers in the
// lower levels were showing up as hitters on the minors page; "be mindful of true two-way players, or pitchers who would be better as hitters
// and vice versa").
//
// THE BUG THIS REPLACES: ph used to be "H" whenever (batting x w.batting + fielding x w.fielding + baserunning x w.baserunning) > pitching. The
// hitting composite carries a floor from fielding (weight ~0.28, a pitcher's fielding grade averages ~44) and baserunning, about 14 points
// before batting counts at all, so ANY pitcher whose pitching composite sat below ~26 became a "hitter": 2,930 players, 85% of 17-year-old
// pitchers (HANDOFF 2026-10-26). A hitter composite and a pitching composite are also simply not on a common scale.
//
// THE RULE: measure each player's hitting against LISTED HITTERS at his level and his pitching against LISTED PITCHERS at his level (median and
// robust SD, per canonical level), take the difference zH - zP, and let the player's LISTED position be the default side with a MARGIN:
//   listed pitcher -> "P" unless zH - zP >  MARGIN      (he is clearly a better hitter than pitcher, relative to peers)
//   listed hitter  -> "H" unless zH - zP < -MARGIN      (he is clearly a better pitcher than hitter, relative to peers)
// Measured on the 2033-06 data: of 4,679 listed pitchers (levels 1-6) 99% have zH - zP < 0 and only 45 lean the other way (almost exactly the few
// who really play as hitters); of 4,713 listed position players none is below -1, and the 58 between -1 and 0 mostly do hit -- so WITHOUT a margin
// those 58 would be wrongly relabelled pitchers. A margin of 1 SD keeps them hitters and still frees genuine converts (a pitcher who is a better
// hitter by more than a standard deviation is labelled H; the engine then values him as a hitter and gives him a hitter role).

export const PH_MARGIN_SD = 1.0;
export const PH_MIN_GROUP = 30;  // peers needed at a level for its own reference; smaller groups fall back to the pooled all-level reference
export const PH_MIN_SD = 0.5;    // floor on the robust SD (composite points) so a near-constant group can't create huge z-scores

export interface PhInput { id: number; listedPitcher: boolean; level: number | null; batting: number; pitching: number }

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
interface Ref { med: number; sd: number }
function ref(values: number[]): Ref {
  const s = [...values].sort((a, b) => a - b);
  return { med: quantile(s, 0.5), sd: Math.max((quantile(s, 0.75) - quantile(s, 0.25)) / 1.35, PH_MIN_SD) };
}

export function classifyHitterPitcher(rows: PhInput[]): Map<number, "H" | "P"> {
  const hit = new Map<string, number[]>(), pit = new Map<string, number[]>();
  const key = (lv: number | null) => (lv == null ? "?" : String(lv));
  const push = (m: Map<string, number[]>, k: string, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  const allHit: number[] = [], allPit: number[] = [];
  for (const r of rows) {
    if (r.listedPitcher) { push(pit, key(r.level), r.pitching); allPit.push(r.pitching); }
    else { push(hit, key(r.level), r.batting); allHit.push(r.batting); }
  }
  const pooledHit = ref(allHit), pooledPit = ref(allPit);
  const hitRef = new Map<string, Ref>(), pitRef = new Map<string, Ref>();
  for (const [k, v] of hit) hitRef.set(k, v.length >= PH_MIN_GROUP ? ref(v) : pooledHit);
  for (const [k, v] of pit) pitRef.set(k, v.length >= PH_MIN_GROUP ? ref(v) : pooledPit);

  const out = new Map<number, "H" | "P">();
  for (const r of rows) {
    const k = key(r.level);
    const h = hitRef.get(k) ?? pooledHit, p = pitRef.get(k) ?? pooledPit;
    const zdiff = (r.batting - h.med) / h.sd - (r.pitching - p.med) / p.sd;
    out.set(r.id, r.listedPitcher ? (zdiff > PH_MARGIN_SD ? "H" : "P") : (zdiff < -PH_MARGIN_SD ? "P" : "H"));
  }
  return out;
}
