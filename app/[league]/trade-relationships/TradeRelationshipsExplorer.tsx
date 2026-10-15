"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Matrix, PairStat, TradeRelationshipData, TradeRow, TradeTeam } from "../../../lib/trade-relationships-math";
import {
  arcPath, buildMatrix, chordLayout, pairStats, relationBetween, ribbonPath, rowTotals, teamStats, tradesPerYear,
} from "../../../lib/trade-relationships-math";

// Trade Relationships (2026-10-14, Rees's ask): who trades with whom. One shared window (season range + Play) drives a living
// chord diagram, a matrix heatmap, a timeline, a team spotlight and two sortable tables. Everything is computed in the browser
// from ~1,200 compact trade rows, so scrubbing the seasons is instant.

const DIVISION_COLORS = ["#d4634a", "#e0a030", "#3f9a8f", "#6a7fd1", "#a86bb8", "#7aa35a"];
// Mid-blue that reads on both the light and dark themes (the site navy disappears on the dark background).
const ACCENT = "#3b82b6";
const colorFor = (t: TradeTeam) => DIVISION_COLORS[t.divisionIndex % DIVISION_COLORS.length];

const cardStyle: React.CSSProperties = {
  background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-sm)", padding: "1.25rem 1.5rem",
};
const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: "1.1875rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--color-heading)",
};
const statLabelStyle: React.CSSProperties = { fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" };
const statValueStyle: React.CSSProperties = { fontSize: "1.375rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--color-heading)" };
const mutedStyle: React.CSSProperties = { color: "var(--color-text-muted)" };
const thStyle: React.CSSProperties = { padding: "0.5rem 0.6rem", fontWeight: 700, verticalAlign: "bottom", lineHeight: 1.25, whiteSpace: "normal", maxWidth: "7.5rem", cursor: "pointer", textAlign: "left" };
const tdStyle: React.CSSProperties = { padding: "0.4rem 0.6rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

const fmtDate = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Eases the displayed matrix toward the target so ribbons and arcs glide when the season window changes (or Play runs).
function useEasedMatrix(target: Matrix): Matrix {
  const [shown, setShown] = useState<Matrix>(target);
  const cur = useRef<Matrix>(target.map((r) => [...r]));
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || cur.current.length !== target.length) {
      cur.current = target.map((r) => [...r]);
      setShown(cur.current.map((r) => [...r]));
      return;
    }
    let raf = 0;
    const step = () => {
      let moving = false;
      const c = cur.current;
      for (let i = 0; i < target.length; i++) {
        for (let j = 0; j < target.length; j++) {
          const d = target[i][j] - c[i][j];
          if (Math.abs(d) > 0.02) { c[i][j] += d * 0.2; moving = true; } else c[i][j] = target[i][j];
        }
      }
      setShown(c.map((r) => [...r]));
      if (moving) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

type SortDir = "asc" | "desc";

export default function TradeRelationshipsExplorer({ data }: { data: TradeRelationshipData }) {
  const { teams, trades, minYear, maxYear } = data;
  const n = teams.length;

  const indexById = useMemo(() => new Map(teams.map((t, i) => [t.id, i])), [teams]);
  const [yearFrom, setYearFrom] = useState(minYear);
  const [yearTo, setYearTo] = useState(maxYear);
  const [playing, setPlaying] = useState(false);
  const [hoverTeam, setHoverTeam] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
  const [hoverPair, setHoverPair] = useState<[number, number] | null>(null);
  const [selectedPair, setSelectedPair] = useState<[number, number] | null>(null);

  // Play: grow the window's right edge one season at a time (restarts from the left edge if it was already at the end).
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setYearTo((y) => {
        if (y >= maxYear) { setPlaying(false); return y; }
        return y + 1;
      });
    }, 520);
    return () => window.clearInterval(id);
  }, [playing, maxYear]);

  const matrix = useMemo(() => buildMatrix(trades, indexById, yearFrom, yearTo), [trades, indexById, yearFrom, yearTo]);
  const eased = useEasedMatrix(matrix);
  const chord = useMemo(() => chordLayout(eased), [eased]);
  const totals = useMemo(() => rowTotals(matrix), [matrix]);
  const tradeCount = useMemo(() => totals.reduce((a, b) => a + b, 0) / 2, [totals]);
  const pairs = useMemo(() => pairStats(trades, yearFrom, yearTo), [trades, yearFrom, yearTo]);
  const tStats = useMemo(() => teamStats(matrix, teams, trades, indexById, yearFrom, yearTo), [matrix, teams, trades, indexById, yearFrom, yearTo]);
  const perYear = useMemo(() => tradesPerYear(trades, minYear, maxYear), [trades, minYear, maxYear]);
  const windowTrades = useMemo(() => trades.filter((t) => t.year >= yearFrom && t.year <= yearTo), [trades, yearFrom, yearTo]);
  const maxCell = useMemo(() => Math.max(1, ...matrix.flat()), [matrix]);

  const focusTeam = hoverTeam ?? selectedTeam;
  const abbr = (i: number) => teams[i].abbr;
  const fullName = (i: number) => `${teams[i].name} ${teams[i].nickname}`.trim();

  // --- headline numbers -----------------------------------------------------------------------------------------------
  const allPairs = (n * (n - 1)) / 2;
  const topPair = useMemo(() => [...pairs].sort((a, b) => b.trades - a.trades)[0] ?? null, [pairs]);
  const busiest = useMemo(() => [...tStats].sort((a, b) => b.total - a.total)[0] ?? null, [tStats]);
  const insular = useMemo(() => [...tStats].filter((s) => s.total >= 8).sort((a, b) => b.topShare - a.topShare)[0] ?? null, [tStats]);
  const relationShares = useMemo(() => {
    let sameDiv = 0;
    for (const p of pairs) if (relationBetween(teams[indexById.get(p.a)!], teams[indexById.get(p.b)!]) === "Same division") sameDiv += p.trades;
    let sameDivPairs = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (relationBetween(teams[i], teams[j]) === "Same division") sameDivPairs += 1;
    return { actual: tradeCount > 0 ? (sameDiv / tradeCount) * 100 : 0, expected: (sameDivPairs / allPairs) * 100 };
  }, [pairs, teams, indexById, n, tradeCount, allPairs]);

  // --- chord diagram --------------------------------------------------------------------------------------------------
  const R_OUT = 262, R_IN = 248, R_RIBBON = 244;
  const partnerOfFocus = (i: number) => focusTeam !== null && matrix[focusTeam][i] > 0;

  function ribbonFill(i: number, j: number): string {
    if (focusTeam !== null && (i === focusTeam || j === focusTeam)) return colorFor(teams[i === focusTeam ? j : i]);
    return colorFor(teams[i]);
  }
  function ribbonOpacity(i: number, j: number): number {
    if (hoverPair && ((hoverPair[0] === i && hoverPair[1] === j) || (hoverPair[0] === j && hoverPair[1] === i))) return 0.95;
    if (selectedPair && ((selectedPair[0] === i && selectedPair[1] === j) || (selectedPair[0] === j && selectedPair[1] === i))) return 0.95;
    if (focusTeam !== null) return i === focusTeam || j === focusTeam ? 0.8 : 0.05;
    return 0.5;
  }

  const infoLine = (() => {
    if (hoverPair) {
      const [i, j] = hoverPair;
      return `${fullName(i)} ⇄ ${fullName(j)} — ${plural(matrix[i][j], "trade")} in ${yearFrom === yearTo ? yearFrom : `${yearFrom}–${yearTo}`}`;
    }
    if (hoverTeam !== null) {
      const s = tStats[hoverTeam];
      return `${fullName(hoverTeam)} — ${plural(s.total, "trade")} with ${plural(s.partners, "partner")}${s.topPartner >= 0 ? `, most with ${abbr(s.topPartner)} (${s.topPartnerTrades})` : ""}`;
    }
    return "Hover a team or a ribbon · click a team to lock it · click a heatmap square for the trade list";
  })();

  // --- heatmap geometry -----------------------------------------------------------------------------------------------
  const CELL = 17, MARGIN = 44;
  const hmSize = MARGIN + n * CELL + 6;

  // --- sortable tables ------------------------------------------------------------------------------------------------
  const [teamSort, setTeamSort] = useState<{ key: string; dir: SortDir }>({ key: "total", dir: "desc" });
  const [pairSort, setPairSort] = useState<{ key: string; dir: SortDir }>({ key: "trades", dir: "desc" });
  const [showAllPairs, setShowAllPairs] = useState(false);

  const teamRows = useMemo(() => {
    const val = (i: number): Record<string, number | string> => {
      const s = tStats[i];
      return {
        team: teams[i].name, division: `${teams[i].conference} ${teams[i].division}`, total: s.total, partners: s.partners, strangers: s.strangers,
        top: s.topPartnerTrades, share: s.topShare, inDiv: s.total > 0 ? s.inDivision / s.total : 0, last: s.lastTrade ?? "",
      };
    };
    const rows = teams.map((_, i) => i);
    rows.sort((a, b) => {
      const x = val(a)[teamSort.key], y = val(b)[teamSort.key];
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return teamSort.dir === "asc" ? c : -c;
    });
    return rows;
  }, [teams, tStats, teamSort]);

  const pairRows = useMemo(() => {
    const val = (p: PairStat): Record<string, number | string> => ({
      pair: `${teams[indexById.get(p.a)!].name} ${teams[indexById.get(p.b)!].name}`, trades: p.trades,
      relation: relationBetween(teams[indexById.get(p.a)!], teams[indexById.get(p.b)!]), first: p.first, last: p.last,
      aSent: p.aSentPlayers * 1000 + p.aSentPicks, bSent: p.bSentPlayers * 1000 + p.bSentPicks,
    });
    return [...pairs].sort((a, b) => {
      const x = val(a)[pairSort.key], y = val(b)[pairSort.key];
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return pairSort.dir === "asc" ? c : -c;
    });
  }, [pairs, pairSort, teams, indexById]);

  function sortHeader(sort: { key: string; dir: SortDir }, setSort: (s: { key: string; dir: SortDir }) => void, key: string, label: string) {
    const active = sort.key === key;
    return (
      <th key={key} style={thStyle} onClick={() => setSort({ key, dir: active && sort.dir === "desc" ? "asc" : "desc" })}>
        {label}{active ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}
      </th>
    );
  }

  // --- detail panel (team spotlight / pair trade list) ----------------------------------------------------------------
  const spotlight = selectedTeam ?? hoverTeam;
  const pairTrades: TradeRow[] = useMemo(() => {
    if (!selectedPair) return [];
    const a = teams[selectedPair[0]].id, b = teams[selectedPair[1]].id;
    return windowTrades.filter((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a)).sort((x, y) => (x.date < y.date ? 1 : -1));
  }, [selectedPair, teams, windowTrades]);

  function assetText(players: number, picks: number): string {
    const bits = [players ? plural(players, "player") : "", picks ? plural(picks, "pick") : ""].filter(Boolean);
    return bits.length ? bits.join(" + ") : "cash / nothing listed";
  }

  const windowLabel = yearFrom === yearTo ? `${yearFrom}` : `${yearFrom}–${yearTo}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Controls + timeline */}
      <div style={cardStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", marginBottom: "0.5rem" }}>
          <button
            onClick={() => {
              if (playing) { setPlaying(false); return; }
              if (yearTo >= maxYear) setYearTo(yearFrom);
              setPlaying(true);
            }}
            style={{ padding: "0.45rem 1.1rem", borderRadius: 999, border: "1px solid var(--color-border-strong)", background: "var(--color-table-hover)", fontWeight: 700, cursor: "pointer", color: "var(--color-text)" }}
          >
            {playing ? "❚❚ Pause" : "▶ Play history"}
          </button>
          <button
            onClick={() => { setPlaying(false); setYearFrom(minYear); setYearTo(maxYear); }}
            style={{ padding: "0.45rem 0.9rem", borderRadius: 999, border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", color: "var(--color-text)" }}
          >
            All seasons
          </button>
          <div style={{ ...statValueStyle, marginLeft: "auto" }}>
            {windowLabel} <span style={{ ...mutedStyle, fontSize: "0.9rem", fontWeight: 400 }}>· {plural(tradeCount, "trade")}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 0.75rem", alignItems: "center", fontSize: "0.8125rem" }}>
          <span style={mutedStyle}>From {yearFrom}</span>
          <input type="range" min={minYear} max={maxYear} value={yearFrom} onChange={(e) => { setPlaying(false); setYearFrom(Math.min(Number(e.target.value), yearTo)); }} />
          <span style={mutedStyle}>To {yearTo}</span>
          <input type="range" min={minYear} max={maxYear} value={yearTo} onChange={(e) => { setPlaying(false); setYearTo(Math.max(Number(e.target.value), yearFrom)); }} />
        </div>
        <div style={{ height: 120, marginTop: "0.5rem" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={perYear} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={3} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [`${v} trades`, ""]} labelFormatter={(l) => `${l}`} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {perYear.map((p) => (
                  <Cell key={p.year} fill={p.year >= yearFrom && p.year <= yearTo ? ACCENT : "var(--color-border-strong)"} fillOpacity={p.year >= yearFrom && p.year <= yearTo ? 0.9 : 0.5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: "0.75rem", ...mutedStyle }}>Trades per season (highlighted = the window below). Completed trades only; each franchise keeps one node through relocations and renames, labelled with its current name.</div>
      </div>

      {/* Headline numbers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1rem" }}>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Most frequent partners</div>
          <div style={statValueStyle}>{topPair ? `${abbr(indexById.get(topPair.a)!)} ⇄ ${abbr(indexById.get(topPair.b)!)}` : "—"}</div>
          <div style={{ ...mutedStyle, fontSize: "0.8125rem" }}>{topPair ? `${plural(topPair.trades, "trade")}, last ${fmtDate(topPair.last)}` : "No trades in this window"}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Busiest team</div>
          <div style={statValueStyle}>{busiest && busiest.total > 0 ? abbr(busiest.index) : "—"}</div>
          <div style={{ ...mutedStyle, fontSize: "0.8125rem" }}>{busiest && busiest.total > 0 ? `${plural(busiest.total, "trade")} with ${plural(busiest.partners, "partner")}` : ""}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Most loyal to one partner</div>
          <div style={statValueStyle}>{insular && insular.topPartner >= 0 ? `${abbr(insular.index)} → ${abbr(insular.topPartner)}` : "—"}</div>
          <div style={{ ...mutedStyle, fontSize: "0.8125rem" }}>{insular && insular.topPartner >= 0 ? `${(insular.topShare * 100).toFixed(0)}% of ${abbr(insular.index)}'s ${insular.total} trades (teams with 8+ trades)` : ""}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Never traded</div>
          <div style={statValueStyle}>{allPairs - pairs.length} <span style={{ ...mutedStyle, fontSize: "0.9rem", fontWeight: 400 }}>of {allPairs} pairs</span></div>
          <div style={{ ...mutedStyle, fontSize: "0.8125rem" }}>team pairs with no trade in this window</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabelStyle}>Same-division trades</div>
          <div style={statValueStyle}>{relationShares.actual.toFixed(0)}%</div>
          <div style={{ ...mutedStyle, fontSize: "0.8125rem" }}>if partners were random it would be {relationShares.expected.toFixed(0)}%</div>
        </div>
      </div>

      {/* Chord diagram + spotlight */}
      <style>{`.tr-split{display:grid;grid-template-columns:minmax(0,1fr);gap:1.5rem;align-items:start}@media (min-width:900px){.tr-split{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}}`}</style>
      <div className="tr-split">
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>The trade web</h2>
          <div style={{ minHeight: 44, fontSize: "0.875rem", marginBottom: "0.4rem", fontWeight: 600 }}>{infoLine}</div>
          <svg viewBox="-330 -330 660 660" style={{ width: "100%", maxWidth: 680, display: "block", margin: "0 auto" }} role="img" aria-label="Chord diagram of trades between teams">
            <g onMouseLeave={() => setHoverPair(null)}>
              {chord.ribbons.map((r) => (
                <path
                  key={`${r.i}-${r.j}`}
                  d={ribbonPath(R_RIBBON, r.s0, r.s1, r.t0, r.t1)}
                  fill={ribbonFill(r.i, r.j)}
                  fillOpacity={ribbonOpacity(r.i, r.j)}
                  stroke="var(--color-surface)"
                  strokeOpacity={0.35}
                  strokeWidth={0.4}
                  style={{ cursor: "pointer", transition: "fill-opacity 120ms" }}
                  onMouseEnter={() => setHoverPair([r.i, r.j])}
                  onClick={() => setSelectedPair([r.i, r.j])}
                />
              ))}
            </g>
            {chord.arcs.map((a) => {
              const t = teams[a.index];
              const mid = (a.start + a.end) / 2;
              const dim = focusTeam !== null && a.index !== focusTeam && !partnerOfFocus(a.index);
              const deg = (mid * 180) / Math.PI - 90;
              const flip = mid > Math.PI;
              const isFocus = a.index === focusTeam;
              return (
                <g
                  key={t.id}
                  style={{ cursor: "pointer", opacity: dim ? 0.3 : 1, transition: "opacity 120ms" }}
                  onMouseEnter={() => setHoverTeam(a.index)}
                  onMouseLeave={() => setHoverTeam(null)}
                  onClick={() => setSelectedTeam(selectedTeam === a.index ? null : a.index)}
                >
                  <path d={arcPath(R_IN, R_OUT, a.start, a.end)} fill={colorFor(t)} stroke={isFocus ? "var(--color-text)" : "none"} strokeWidth={1.5} />
                  <text
                    transform={`rotate(${deg.toFixed(2)}) translate(${R_OUT + 8}) ${flip ? "rotate(180)" : ""}`}
                    textAnchor={flip ? "end" : "start"}
                    dominantBaseline="middle"
                    fontSize={isFocus ? 12 : 10.5}
                    fontWeight={isFocus ? 800 : 600}
                    fill="var(--color-text)"
                  >
                    {t.abbr}
                  </text>
                </g>
              );
            })}
          </svg>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", justifyContent: "center", marginTop: "0.5rem", fontSize: "0.75rem" }}>
            {[...new Map(teams.map((t) => [t.divisionIndex, t])).values()].map((t) => (
              <span key={t.divisionIndex}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: colorFor(t), marginRight: 5 }} />{t.conference} {t.division}</span>
            ))}
          </div>
          <div style={{ fontSize: "0.75rem", ...mutedStyle, marginTop: "0.5rem", textAlign: "center" }}>
            A team&apos;s arc is as long as its number of trades; a ribbon&apos;s width is the trades between those two teams.
          </div>
        </div>

        {/* Spotlight / pair detail */}
        <div style={cardStyle}>
          {selectedPair ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                <h2 style={{ ...sectionTitleStyle, marginBottom: "0.25rem" }}>{abbr(selectedPair[0])} ⇄ {abbr(selectedPair[1])}</h2>
                <button onClick={() => setSelectedPair(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>close ✕</button>
              </div>
              <div style={{ ...mutedStyle, fontSize: "0.8125rem", marginBottom: "0.6rem" }}>
                {fullName(selectedPair[0])} and {fullName(selectedPair[1])} · {plural(pairTrades.length, "trade")} in {windowLabel}
              </div>
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {pairTrades.length === 0 && <div style={mutedStyle}>No trades between these two teams in this window.</div>}
                {pairTrades.map((t) => {
                  const aIsFirst = teams[selectedPair[0]].id === t.a;
                  const first = aIsFirst ? { p: t.aPlayers, k: t.aPicks } : { p: t.bPlayers, k: t.bPicks };
                  const second = aIsFirst ? { p: t.bPlayers, k: t.bPicks } : { p: t.aPlayers, k: t.aPicks };
                  return (
                    <div key={t.id} style={{ borderTop: "1px solid var(--color-border)", padding: "0.45rem 0", fontSize: "0.8125rem" }}>
                      <div style={{ fontWeight: 700 }}>{fmtDate(t.date)}</div>
                      <div>{abbr(selectedPair[0])} sent {assetText(first.p, first.k)}</div>
                      <div>{abbr(selectedPair[1])} sent {assetText(second.p, second.k)}</div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : spotlight !== null ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                <h2 style={{ ...sectionTitleStyle, marginBottom: "0.25rem" }}>
                  <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: colorFor(teams[spotlight]), marginRight: 8 }} />
                  {fullName(spotlight)}
                </h2>
                {selectedTeam !== null && <button onClick={() => setSelectedTeam(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>unlock ✕</button>}
              </div>
              <div style={{ ...mutedStyle, fontSize: "0.8125rem", marginBottom: "0.6rem" }}>
                {teams[spotlight].conference} {teams[spotlight].division}
                {teams[spotlight].formerNames.length > 0 && ` · formerly ${teams[spotlight].formerNames.join(", ")}`}
                {` · ${plural(tStats[spotlight].total, "trade")}, ${plural(tStats[spotlight].partners, "partner")}`}
              </div>
              <div style={{ maxHeight: 560, overflowY: "auto" }}>
                {teams.map((_, j) => j).filter((j) => j !== spotlight).sort((a, b) => matrix[spotlight][b] - matrix[spotlight][a] || a - b).map((j) => {
                  const c = matrix[spotlight][j];
                  const top = Math.max(1, ...matrix[spotlight]);
                  return (
                    <div
                      key={j}
                      onClick={() => setSelectedPair([spotlight, j])}
                      style={{ display: "grid", gridTemplateColumns: "3.2rem 1fr 2.2rem", alignItems: "center", gap: "0.5rem", padding: "0.12rem 0", cursor: "pointer", opacity: c === 0 ? 0.45 : 1 }}
                      title={`${fullName(spotlight)} and ${fullName(j)}: ${plural(c, "trade")}`}
                    >
                      <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{abbr(j)}</span>
                      <div style={{ background: "var(--color-border)", borderRadius: 3, height: 10 }}>
                        <div style={{ width: `${(c / top) * 100}%`, height: "100%", borderRadius: 3, background: colorFor(teams[j]), transition: "width 200ms" }} />
                      </div>
                      <span style={{ fontSize: "0.8125rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c === 0 ? "—" : c}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: "0.75rem", ...mutedStyle, marginTop: "0.5rem" }}>Click a partner for the trade list. Faded rows = never traded in this window.</div>
            </>
          ) : (
            <>
              <h2 style={sectionTitleStyle}>Team spotlight</h2>
              <div style={mutedStyle}>
                Hover any team on the web to see its trading partners, or click one to lock it here with a ranked list of every team it has dealt with — and the ones it never has.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Matrix heatmap */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>Trade matrix</h2>
        <div style={{ fontSize: "0.8125rem", ...mutedStyle, marginBottom: "0.5rem" }}>
          Every team against every team, grouped by division. Stronger color = more trades in {windowLabel}. Click a square for the actual trades.
        </div>
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${hmSize} ${hmSize}`} style={{ width: "100%", maxWidth: 760, display: "block", margin: "0 auto" }} role="img" aria-label="Trade count matrix">
            {teams.map((t, i) => (
              <g key={`lab-${t.id}`}>
                <rect x={MARGIN - 6} y={MARGIN + i * CELL + 1} width={3} height={CELL - 2} fill={colorFor(t)} />
                <text x={MARGIN - 9} y={MARGIN + i * CELL + CELL / 2} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="var(--color-text)" fontWeight={i === focusTeam ? 800 : 500}>{t.abbr}</text>
                <rect x={MARGIN + i * CELL + 1} y={MARGIN - 6} width={CELL - 2} height={3} fill={colorFor(t)} />
                <text transform={`translate(${MARGIN + i * CELL + CELL / 2} ${MARGIN - 9}) rotate(-90)`} textAnchor="start" dominantBaseline="middle" fontSize={9} fill="var(--color-text)" fontWeight={i === focusTeam ? 800 : 500}>{t.abbr}</text>
              </g>
            ))}
            {matrix.map((row, i) => row.map((v, j) => {
              const active = (hoverPair && ((hoverPair[0] === i && hoverPair[1] === j) || (hoverPair[0] === j && hoverPair[1] === i)));
              const selected = selectedPair && ((selectedPair[0] === i && selectedPair[1] === j) || (selectedPair[0] === j && selectedPair[1] === i));
              const intensity = v > 0 ? 0.14 + 0.86 * Math.sqrt(v / maxCell) : 0;
              return (
                <rect
                  key={`${i}-${j}`}
                  x={MARGIN + j * CELL + 0.5}
                  y={MARGIN + i * CELL + 0.5}
                  width={CELL - 1}
                  height={CELL - 1}
                  rx={2}
                  fill={i === j ? "var(--color-border)" : v > 0 ? ACCENT : "var(--color-table-header)"}
                  fillOpacity={i === j ? 0.5 : v > 0 ? intensity : 0.45}
                  stroke={active || selected ? "var(--color-text)" : "none"}
                  strokeWidth={1.5}
                  style={{ cursor: i === j ? "default" : "pointer" }}
                  onMouseEnter={() => { if (i !== j) setHoverPair([i, j]); }}
                  onMouseLeave={() => setHoverPair(null)}
                  onClick={() => { if (i !== j) setSelectedPair([i, j]); }}
                >
                  <title>{i === j ? teams[i].name : `${fullName(i)} ⇄ ${fullName(j)}: ${plural(v, "trade")}`}</title>
                </rect>
              );
            }))}
          </svg>
        </div>
      </div>

      {/* Team table */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>Teams</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "auto", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--color-table-header)" }}>
                {sortHeader(teamSort, setTeamSort, "team", "Team")}
                {sortHeader(teamSort, setTeamSort, "division", "Division")}
                {sortHeader(teamSort, setTeamSort, "total", "Trades")}
                {sortHeader(teamSort, setTeamSort, "partners", "Distinct partners")}
                {sortHeader(teamSort, setTeamSort, "strangers", "Never traded with")}
                {sortHeader(teamSort, setTeamSort, "top", "Top partner (trades)")}
                {sortHeader(teamSort, setTeamSort, "share", "Share with top partner")}
                {sortHeader(teamSort, setTeamSort, "inDiv", "Same-division share")}
                {sortHeader(teamSort, setTeamSort, "last", "Latest trade")}
              </tr>
            </thead>
            <tbody>
              {teamRows.map((i) => {
                const s = tStats[i];
                return (
                  <tr key={teams[i].id} onClick={() => setSelectedTeam(selectedTeam === i ? null : i)}
                    style={{ borderTop: "1px solid var(--color-border)", cursor: "pointer", background: selectedTeam === i ? "var(--color-table-hover)" : "transparent" }}>
                    <td style={{ ...tdStyle, fontFamily: "inherit", fontWeight: 700 }}>
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: colorFor(teams[i]), marginRight: 7 }} />
                      {teams[i].name} <span style={{ ...mutedStyle, fontWeight: 400 }}>{teams[i].nickname}</span>
                    </td>
                    <td style={tdStyle}>{teams[i].conference} {teams[i].division.replace(" Division", "")}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{s.total}</td>
                    <td style={tdStyle}>{s.partners}</td>
                    <td style={tdStyle}>{s.strangers}</td>
                    <td style={tdStyle}>{s.topPartner >= 0 ? `${abbr(s.topPartner)} (${s.topPartnerTrades})` : "—"}</td>
                    <td style={tdStyle}>{s.total > 0 ? `${(s.topShare * 100).toFixed(0)}%` : "—"}</td>
                    <td style={tdStyle}>{s.total > 0 ? `${((s.inDivision / s.total) * 100).toFixed(0)}%` : "—"}</td>
                    <td style={tdStyle}>{fmtDate(s.lastTrade)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pair table */}
      <div style={cardStyle}>
        <h2 style={sectionTitleStyle}>Team pairs</h2>
        <div style={{ fontSize: "0.8125rem", ...mutedStyle, marginBottom: "0.5rem" }}>
          Every pair of teams that traded in {windowLabel} ({pairs.length} of {allPairs} possible pairs). Click a row for its trades.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "auto", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--color-table-header)" }}>
                {sortHeader(pairSort, setPairSort, "pair", "Teams")}
                {sortHeader(pairSort, setPairSort, "trades", "Trades")}
                {sortHeader(pairSort, setPairSort, "relation", "Relationship")}
                {sortHeader(pairSort, setPairSort, "first", "First trade")}
                {sortHeader(pairSort, setPairSort, "last", "Latest trade")}
                {sortHeader(pairSort, setPairSort, "aSent", "First team sent")}
                {sortHeader(pairSort, setPairSort, "bSent", "Second team sent")}
              </tr>
            </thead>
            <tbody>
              {(showAllPairs ? pairRows : pairRows.slice(0, 25)).map((p) => {
                const i = indexById.get(p.a)!, j = indexById.get(p.b)!;
                return (
                  <tr key={`${p.a}-${p.b}`} onClick={() => setSelectedPair([i, j])} style={{ borderTop: "1px solid var(--color-border)", cursor: "pointer" }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      <span style={{ color: colorFor(teams[i]) }}>●</span> {abbr(i)} ⇄ <span style={{ color: colorFor(teams[j]) }}>●</span> {abbr(j)}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{p.trades}</td>
                    <td style={tdStyle}>{relationBetween(teams[i], teams[j])}</td>
                    <td style={tdStyle}>{fmtDate(p.first)}</td>
                    <td style={tdStyle}>{fmtDate(p.last)}</td>
                    <td style={tdStyle}>{abbr(i)}: {p.aSentPlayers} pl · {p.aSentPicks} pk</td>
                    <td style={tdStyle}>{abbr(j)}: {p.bSentPlayers} pl · {p.bSentPicks} pk</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pairRows.length > 25 && (
          <button onClick={() => setShowAllPairs(!showAllPairs)} style={{ marginTop: "0.6rem", padding: "0.35rem 0.9rem", borderRadius: 999, border: "1px solid var(--color-border-strong)", background: "transparent", cursor: "pointer", color: "var(--color-text)" }}>
            {showAllPairs ? "Show top 25" : `Show all ${pairRows.length} pairs`}
          </button>
        )}
      </div>
    </div>
  );
}
