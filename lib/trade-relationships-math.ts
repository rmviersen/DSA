// Pure data shapes + math for the /trade-relationships page (2026-10-14, Rees's ask). No imports on purpose: this file is
// bundled into the browser by the page's client component, and everything in it is deterministic, so it is unit-testable.

export interface TradeTeam {
  id: number;            // franchise id -- stable across relocations/renames (id 2 was Boston, Carolina, then Chicago)
  name: string;          // current city, e.g. "Denver"
  nickname: string;      // current nickname, e.g. "Dynamite"
  abbr: string;          // short label for the chord ring, e.g. "DEN"
  division: string;      // e.g. "Ruby Division"
  conference: string;    // e.g. "Fire"
  divisionIndex: number; // 0..n-1, drives the color + ring order
  formerNames: string[]; // earlier cities this franchise has traded under
}

export interface TradeRow {
  id: number;
  date: string;          // YYYY-MM-DD
  year: number;
  a: number;             // team ids
  b: number;
  aPlayers: number;      // assets team a SENT in the deal
  aPicks: number;
  bPlayers: number;
  bPicks: number;
}

export interface TradeRelationshipData {
  teams: TradeTeam[];    // already in ring order (division, then all-time trade volume)
  trades: TradeRow[];
  minYear: number;
  maxYear: number;
}

export type Matrix = number[][];

export function emptyMatrix(n: number): Matrix {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

/** Symmetric trade-count matrix (m[i][j] = number of trades between teams i and j) for trades in [yearFrom, yearTo]. */
export function buildMatrix(trades: TradeRow[], indexById: Map<number, number>, yearFrom: number, yearTo: number): Matrix {
  const m = emptyMatrix(indexById.size);
  for (const t of trades) {
    if (t.year < yearFrom || t.year > yearTo) continue;
    const i = indexById.get(t.a);
    const j = indexById.get(t.b);
    if (i === undefined || j === undefined || i === j) continue;
    m[i][j] += 1;
    m[j][i] += 1;
  }
  return m;
}

export function rowTotals(m: Matrix): number[] {
  return m.map((row) => row.reduce((a, b) => a + b, 0));
}

// --- chord geometry --------------------------------------------------------------------------------------------------------
// Angles are measured clockwise from 12 o'clock. A team's arc is as long as its trade count (so a busy team gets a big arc);
// a team with no trades in the window keeps a hairline arc so it never vanishes from the ring.
export interface ChordArc { index: number; start: number; end: number; total: number }
export interface ChordRibbon { i: number; j: number; value: number; s0: number; s1: number; t0: number; t1: number }

export function chordLayout(m: Matrix, gap = 0.03): { arcs: ChordArc[]; ribbons: ChordRibbon[] } {
  const n = m.length;
  const totals = rowTotals(m);
  const grand = totals.reduce((a, b) => a + b, 0);
  const floor = Math.max(grand * 0.004, 0.35);
  const weights = totals.map((t) => Math.max(t, floor));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const k = (2 * Math.PI - gap * n) / wsum;

  const arcs: ChordArc[] = [];
  let angle = 0;
  for (let i = 0; i < n; i++) {
    const end = angle + weights[i] * k;
    arcs.push({ index: i, start: angle, end, total: totals[i] });
    angle = end + gap;
  }

  // Sub-arc each partner occupies inside a team's arc, in ring order (keeps ribbons from tangling).
  const seg: { s: number; e: number }[][] = Array.from({ length: n }, () => new Array(n));
  for (let i = 0; i < n; i++) {
    let cursor = arcs[i].start;
    for (let j = 0; j < n; j++) {
      if (j === i || m[i][j] <= 0) continue;
      seg[i][j] = { s: cursor, e: cursor + m[i][j] * k };
      cursor += m[i][j] * k;
    }
  }
  const ribbons: ChordRibbon[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (m[i][j] <= 0 || !seg[i][j] || !seg[j][i]) continue;
      ribbons.push({ i, j, value: m[i][j], s0: seg[i][j].s, s1: seg[i][j].e, t0: seg[j][i].s, t1: seg[j][i].e });
    }
  }
  return { arcs, ribbons };
}

const f = (n: number) => n.toFixed(2);
function pt(r: number, a: number): string {
  return `${f(r * Math.sin(a))} ${f(-r * Math.cos(a))}`;
}

/** Ring segment (annular sector) path for a team's arc. */
export function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${pt(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)} L ${pt(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)} Z`;
}

/** Ribbon between two sub-arcs, pulled through the centre (the classic chord-diagram shape). */
export function ribbonPath(r: number, s0: number, s1: number, t0: number, t1: number): string {
  const ls = s1 - s0 > Math.PI ? 1 : 0;
  const lt = t1 - t0 > Math.PI ? 1 : 0;
  return `M ${pt(r, s0)} A ${r} ${r} 0 ${ls} 1 ${pt(r, s1)} Q 0 0 ${pt(r, t0)} A ${r} ${r} 0 ${lt} 1 ${pt(r, t1)} Q 0 0 ${pt(r, s0)} Z`;
}

// --- table statistics ------------------------------------------------------------------------------------------------------
export interface PairStat {
  a: number; b: number;           // team ids, a < b
  trades: number;
  first: string; last: string;
  aSentPlayers: number; aSentPicks: number;
  bSentPlayers: number; bSentPicks: number;
}

export function pairStats(trades: TradeRow[], yearFrom: number, yearTo: number): PairStat[] {
  const byKey = new Map<string, PairStat>();
  for (const t of trades) {
    if (t.year < yearFrom || t.year > yearTo) continue;
    const lo = Math.min(t.a, t.b), hi = Math.max(t.a, t.b);
    const key = `${lo}-${hi}`;
    let p = byKey.get(key);
    if (!p) {
      p = { a: lo, b: hi, trades: 0, first: t.date, last: t.date, aSentPlayers: 0, aSentPicks: 0, bSentPlayers: 0, bSentPicks: 0 };
      byKey.set(key, p);
    }
    p.trades += 1;
    if (t.date < p.first) p.first = t.date;
    if (t.date > p.last) p.last = t.date;
    const loIsA = t.a === lo;
    p.aSentPlayers += loIsA ? t.aPlayers : t.bPlayers;
    p.aSentPicks += loIsA ? t.aPicks : t.bPicks;
    p.bSentPlayers += loIsA ? t.bPlayers : t.aPlayers;
    p.bSentPicks += loIsA ? t.bPicks : t.aPicks;
  }
  return [...byKey.values()];
}

export interface TeamStat {
  index: number;
  total: number;          // trades in the window
  partners: number;       // distinct teams traded with
  strangers: number;      // teams never traded with (in the window)
  topPartner: number;     // index of the most frequent partner, -1 if none
  topPartnerTrades: number;
  topShare: number;       // topPartnerTrades / total (0..1) -- how much of his trading is with one team
  lastTrade: string | null;
  inDivision: number;     // trades with teams in his own division
}

export function teamStats(m: Matrix, teams: TradeTeam[], trades: TradeRow[], indexById: Map<number, number>, yearFrom: number, yearTo: number): TeamStat[] {
  const n = m.length;
  const last: (string | null)[] = new Array(n).fill(null);
  for (const t of trades) {
    if (t.year < yearFrom || t.year > yearTo) continue;
    for (const id of [t.a, t.b]) {
      const i = indexById.get(id);
      if (i !== undefined && (last[i] === null || t.date > (last[i] as string))) last[i] = t.date;
    }
  }
  return m.map((row, i) => {
    let total = 0, partners = 0, top = -1, topN = 0, inDiv = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const c = row[j];
      total += c;
      if (c > 0) partners += 1;
      if (c > topN) { topN = c; top = j; }
      if (teams[j].division === teams[i].division && teams[j].conference === teams[i].conference) inDiv += c;
    }
    return { index: i, total, partners, strangers: n - 1 - partners, topPartner: top, topPartnerTrades: topN, topShare: total > 0 ? topN / total : 0, lastTrade: last[i], inDivision: inDiv };
  });
}

export type Relation = "Same division" | "Same conference" | "Cross-conference";
export function relationBetween(x: TradeTeam, y: TradeTeam): Relation {
  if (x.conference === y.conference) return x.division === y.division ? "Same division" : "Same conference";
  return "Cross-conference";
}

/** Trades per calendar year (for the timeline). */
export function tradesPerYear(trades: TradeRow[], minYear: number, maxYear: number): { year: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const t of trades) counts.set(t.year, (counts.get(t.year) ?? 0) + 1);
  const out: { year: number; count: number }[] = [];
  for (let y = minYear; y <= maxYear; y++) out.push({ year: y, count: counts.get(y) ?? 0 });
  return out;
}
