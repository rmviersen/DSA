import Link from "next/link";
import { resolveLeagueId } from "../../../lib/league";
import { getLopsidedTrades, type LopsidedFilter } from "../../../lib/lopsided-trades-query";
import TradeCard from "./TradeCard";

export const dynamic = "force-dynamic";

// Most Lopsided Trades (2026-10-14, Rees's ask): the 20 trades in TBL history where one side got the most WAR more than the other,
// by what each side's assets produced for the team that received them -- draft picks traced to the players they became. Numbers come
// from trade_war_results (scripts/compute-lopsided-trades.ts); method and caveats are in HANDOFF.md and summarised below the cards.
// Owner-only by directory convention, like the other analysis pages.

const FILTERS: { key: LopsidedFilter; label: string }[] = [
  { key: "all", label: "All trades" },
  { key: "picks", label: "Involving draft picks" },
  { key: "players", label: "Players only" },
];

const CSS = `
.lt-wrap{display:flex;flex-direction:column;gap:1.25rem}
.lt-pills{display:flex;gap:.5rem;flex-wrap:wrap}
.lt-pill{padding:.4rem 1rem;border-radius:999px;border:1px solid var(--color-border);font-size:.8125rem;font-weight:600;color:var(--color-text);text-decoration:none;background:transparent}
.lt-pill-on{background:var(--color-table-hover);border-color:var(--color-border-strong)}
.lt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
.lt-stat{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);box-shadow:var(--shadow-sm);padding:1rem 1.25rem}
.lt-stat-label{font-size:.75rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.03em}
.lt-stat-value{font-size:1.35rem;font-weight:800;color:var(--color-heading);font-variant-numeric:tabular-nums}
.lt-stat-sub{font-size:.8125rem;color:var(--color-text-muted)}
.lt-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);box-shadow:var(--shadow-sm);overflow:hidden}
.lt-head{display:flex;align-items:center;gap:1rem;padding:1rem 1.25rem;flex-wrap:wrap;background:linear-gradient(90deg,rgba(59,130,182,.16),transparent 70%)}
.lt-rank{flex:none;width:2.9rem;height:2.9rem;border-radius:50%;display:grid;place-items:center;font-family:var(--font-display),system-ui,sans-serif;font-size:1.35rem;font-weight:800;color:#fff;background:linear-gradient(135deg,#3b82b6,#27597f);box-shadow:0 2px 6px rgba(0,0,0,.25)}
.lt-headtext{flex:1 1 220px;min-width:0}
.lt-date{font-size:.8125rem;font-weight:700;color:var(--color-text)}
.lt-ago{font-weight:400;color:var(--color-text-muted)}
.lt-headline{font-family:var(--font-display),system-ui,sans-serif;font-size:1.2rem;font-weight:700;color:var(--color-heading)}
.lt-chip{font-size:.7rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:.25rem .6rem;border-radius:999px;background:rgba(168,107,184,.18);color:#a86bb8;border:1px solid rgba(168,107,184,.45)}
.lt-chip-warn{background:rgba(224,160,48,.16);color:#c68a1e;border-color:rgba(224,160,48,.5)}
.lt-margin{text-align:right}
.lt-margin-num{font-size:2.1rem;line-height:1;font-weight:800;color:#2f9e63;font-variant-numeric:tabular-nums}
.lt-margin-label{font-size:.7rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.04em}
.lt-bar{display:flex;height:6px;background:var(--color-border)}
.lt-bar-win{background:linear-gradient(90deg,#2f9e63,#4cc28a)}
.lt-bar-lose{background:linear-gradient(90deg,#c9625f,#a8403e)}
.lt-panels{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
@media (min-width:900px){.lt-panels{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.lt-panel-win{border-right:1px solid var(--color-border)}}
.lt-panel{padding:1rem 1.25rem 1.1rem;border-top:1px solid var(--color-border)}
.lt-panel-win{box-shadow:inset 4px 0 0 #2f9e63}
.lt-panel-lose{box-shadow:inset 4px 0 0 #c9625f}
.lt-panel-head{display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem}
.lt-logo{flex:none;width:48px;height:48px;object-fit:contain;display:block}
.lt-team{flex:1;min-width:0}
.lt-team-name{font-weight:800;font-size:1.02rem;color:var(--color-heading)}
.lt-team-sub{font-size:.75rem;color:var(--color-text-muted);text-transform:capitalize}
.lt-total{text-align:right}
.lt-total-num{font-size:1.5rem;font-weight:800;font-variant-numeric:tabular-nums;color:var(--color-text)}
.lt-total-label{font-size:.68rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.04em}
.lt-pos{color:#2f9e63}
.lt-neg{color:#d0605d}
.lt-zero{color:var(--color-text-muted)}
.lt-list{display:flex;flex-direction:column}
.lt-row{display:grid;grid-template-columns:2.7rem minmax(0,1fr) auto;gap:.7rem;align-items:start;padding:.5rem 0;border-top:1px solid var(--color-border)}
.lt-row:first-child{border-top:none}
.lt-row-muted{opacity:.6}
.lt-badge{font-size:.68rem;font-weight:800;text-align:center;padding:.22rem 0;border-radius:6px;letter-spacing:.02em;margin-top:.1rem}
.lt-badge-p{background:rgba(59,130,182,.2);color:#3b82b6}
.lt-badge-h{background:rgba(224,160,48,.22);color:#c68a1e}
.lt-badge-pick{background:rgba(168,107,184,.2);color:#a86bb8}
.lt-badge-cash{background:rgba(120,140,120,.22);color:var(--color-text-muted)}
.lt-main{min-width:0}
.lt-name{font-weight:700;font-size:.9rem;color:var(--color-text)}
.lt-from{font-weight:400;font-size:.78rem;color:var(--color-text-muted)}
.lt-sub{font-size:.78rem;color:var(--color-text-muted);line-height:1.35}
.lt-sub b{color:var(--color-text)}
.lt-war{font-weight:800;font-size:1rem;font-variant-numeric:tabular-nums;text-align:right;min-width:3.2rem}
.lt-approx{font-style:italic}
.lt-notes{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:1rem 1.25rem;font-size:.85rem;line-height:1.5;color:var(--color-text)}
.lt-notes summary{cursor:pointer;font-weight:700;color:var(--color-heading)}
.lt-notes li{margin:.3rem 0}
`;

export default async function LopsidedTradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { league } = await params;
  const { show } = await searchParams;
  const filter: LopsidedFilter = show === "picks" || show === "players" ? show : "all";
  const leagueId = await resolveLeagueId(league);
  const { trades, franchises, computedAt, totalTrades } = await getLopsidedTrades(leagueId, filter, 20);

  // Header tiles
  const wins = new Map<number, number>();
  for (const t of trades) if (t.winnerTeamId != null) wins.set(t.winnerTeamId, (wins.get(t.winnerTeamId) ?? 0) + 1);
  const topWinner = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
  const picksCount = trades.filter((t) => t.hasPick).length;
  const fname = (id: number | undefined) => (id != null && franchises[id] ? `${franchises[id].name} ${franchises[id].nickname}` : "—");
  const biggest = trades[0];

  return (
    <>
      <style>{CSS}</style>
      <header className="page-header">
        <h1>Most Lopsided Trades</h1>
        <p>
          The 20 trades in TBL history where one side got the most WAR more than the other. Each side is credited with the WAR its
          assets produced <strong>for the team that received them</strong> — and every traded draft pick is traced to the player it
          became. Longer-ago trades have had more time to pay off, so the list leans toward the early years.
        </p>
      </header>
      <div className="lt-wrap">
        <nav className="lt-pills" aria-label="Filter">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key === "all" ? "?" : `?show=${f.key}`} className={`lt-pill ${filter === f.key ? "lt-pill-on" : ""}`}>{f.label}</Link>
          ))}
        </nav>

        {trades.length === 0 ? (
          <p>No computed results yet — run <code>npx tsx scripts/compute-lopsided-trades.ts</code>.</p>
        ) : (
          <>
            <div className="lt-stats">
              <div className="lt-stat">
                <div className="lt-stat-label">Biggest swing</div>
                <div className="lt-stat-value">+{biggest.margin.toFixed(1)} WAR</div>
                <div className="lt-stat-sub">{fname(biggest.winnerTeamId ?? undefined)} · {new Date(biggest.tradeDate + "T00:00:00Z").getUTCFullYear()}</div>
              </div>
              <div className="lt-stat">
                <div className="lt-stat-label">Most wins in this top {trades.length}</div>
                <div className="lt-stat-value">{topWinner ? fname(topWinner[0]) : "—"}</div>
                <div className="lt-stat-sub">{topWinner ? `${topWinner[1]} of ${trades.length} lopsided trades` : ""}</div>
              </div>
              <div className="lt-stat">
                <div className="lt-stat-label">Involving draft picks</div>
                <div className="lt-stat-value">{picksCount} of {trades.length}</div>
                <div className="lt-stat-sub">out of {totalTrades.toLocaleString()} trades in this view</div>
              </div>
            </div>

            {trades.map((t, i) => <TradeCard key={t.tradeEventId} trade={t} rank={i + 1} franchises={franchises} />)}

            <details className="lt-notes">
              <summary>How these numbers are built</summary>
              <ul>
                <li><b>WAR is credited to the receiving team only.</b> A player&apos;s WAR counts from the trade year on, with the team that got him — it stops when he leaves that team (split seasons are handled by team).</li>
                <li><b>Draft picks become the player they turned into.</b> Rounds 2–28 are traced exactly (the draft order repeats every round). Round 1 is a lottery, so the pick is followed through its trades to the team that used it; when that team made several first-round picks, each candidate gets a probability (based on how first-round slots usually line up with a team&apos;s later-round slot — checked against known picks) and the expected WAR is shown, marked <i>~</i>.</li>
                <li><b>A pick is counted once.</b> If a team received a pick and flipped it before the draft, that trade shows it as re-traded with no value; the later trade carries the player.</li>
                <li><b>Not counted:</b> cash, picks for drafts not held yet, and picks that couldn&apos;t be traced (a few early draft classes are incomplete in our data) — those trades are understated.</li>
                <li><b>Horizon is the present</b> (through the latest season on file), so a 2012 trade has had far longer to accumulate WAR than a 2030 one.</li>
              </ul>
              {computedAt && <div className="lt-stat-sub">Results last computed {new Date(computedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}.</div>}
            </details>
          </>
        )}
      </div>
    </>
  );
}
