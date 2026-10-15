import { teamLogoUrl } from "../../../lib/display-helpers";
import type { FranchiseInfo, LopsidedTrade, TradeAsset, TradeSide } from "../../../lib/lopsided-trades-query";

// One trade as a card: winner and loser panels with logos, a WAR comparison bar, and every asset received (players with position
// and WAR, draft picks traced to the player they became). Server component -- no client JS. Styles live in page.tsx (.lt-*).

const fmtWar = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;
const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const cityOf = (label: string | null) => (label ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
const warClass = (n: number) => (n < -0.05 ? "lt-war lt-neg" : n > 0.05 ? "lt-war lt-pos" : "lt-war lt-zero");

function franchiseName(f: FranchiseInfo | undefined, fallback: string | null): string {
  return f ? f.name : fallback ?? "a team";
}

function AssetRow({ asset, franchises, receiver }: { asset: TradeAsset; franchises: Record<number, FranchiseInfo>; receiver: TradeSide }) {
  if (asset.kind === "cash") {
    return (
      <div className="lt-row">
        <span className="lt-badge lt-badge-cash">CASH</span>
        <div className="lt-main"><div className="lt-name">${asset.amount.toLocaleString()}</div><div className="lt-sub">cash considerations</div></div>
        <span className="lt-war lt-zero">—</span>
      </div>
    );
  }
  if (asset.kind === "player") {
    const span = asset.firstYear != null ? (asset.firstYear === asset.lastYear ? `${asset.firstYear}` : `${asset.firstYear}–${asset.lastYear}`) : null;
    return (
      <div className="lt-row">
        <span className={`lt-badge ${["SP", "RP", "CL"].includes(asset.pos) ? "lt-badge-p" : "lt-badge-h"}`}>{asset.pos}</span>
        <div className="lt-main">
          <div className="lt-name">{asset.name}</div>
          <div className="lt-sub">{span ? `${span} with ${franchiseName(franchises[receiver.teamId], receiver.teamLabel)}` : "never played MLB for this team"}</div>
        </div>
        <span className={warClass(asset.war)}>{fmtWar(asset.war)}</span>
      </div>
    );
  }
  // draft pick
  const origin = asset.originalTeamId != null ? franchiseName(franchises[asset.originalTeamId], asset.originalTeamLabel) : asset.originalTeamLabel ?? "unknown team";
  const title = `${asset.year} round ${asset.round} pick`;
  const one = asset.players[0];
  let sub: React.ReactNode;
  let war: React.ReactNode = <span className="lt-war lt-zero">—</span>;
  if (asset.resolution === "undrafted") {
    sub = "that draft hasn't been held yet";
  } else if (asset.resolution === "unresolved") {
    sub = `couldn't be traced to a player (${asset.reason ?? "no match"})`;
  } else if (!asset.credited) {
    const holder = asset.finalHolderId != null ? franchiseName(franchises[asset.finalHolderId], null) : "another team";
    sub = (
      <>
        re-traded before the draft — {holder} used it{one ? <> and took <b>{one.name}</b> ({one.pos})</> : null}. Its value counts in that later trade.
      </>
    );
  } else if (asset.resolution === "candidates") {
    sub = (
      <>
        round 1 is a lottery, so this is one of {asset.players.length} first-rounders the team made — average shown:{" "}
        {asset.players.map((p) => `${p.name} (${fmtWar(p.war)})`).join(", ")}
      </>
    );
    war = <span className={`${warClass(asset.war)} lt-approx`} title="Average over the candidate players">~{fmtWar(asset.war)}</span>;
  } else if (one) {
    sub = (
      <>
        became <b>{one.name}</b> ({one.pos}){one.overallPick ? ` · pick #${one.overallPick} overall` : ""}
      </>
    );
    war = <span className={warClass(asset.war)}>{fmtWar(asset.war)}</span>;
  } else {
    sub = "no player found";
  }
  return (
    <div className={`lt-row ${asset.credited ? "" : "lt-row-muted"}`}>
      <span className="lt-badge lt-badge-pick">PICK</span>
      <div className="lt-main">
        <div className="lt-name">{title} <span className="lt-from">from {origin}</span></div>
        <div className="lt-sub">{sub}</div>
      </div>
      {war}
    </div>
  );
}

function Panel({ side, winner, franchises, tag }: { side: TradeSide; winner: boolean; franchises: Record<number, FranchiseInfo>; tag: string }) {
  const f = franchises[side.teamId];
  const then = cityOf(side.teamLabel);
  const showThen = f && then && then !== f.name;
  const sorted = [...side.receives].sort((x, y) => {
    const wx = x.kind === "cash" ? -1e9 : x.war, wy = y.kind === "cash" ? -1e9 : y.war;
    return wy - wx;
  });
  // Players who never appeared for this team (0 WAR, no seasons) are folded into one line when there are several of them, so a
  // bundle trade does not bury the assets that mattered under a column of zeros.
  const isBust = (a: TradeAsset) => a.kind === "player" && a.firstYear === null;
  const busts = sorted.filter(isBust);
  const foldBusts = busts.length >= 3;
  const shown = foldBusts ? sorted.filter((a) => !isBust(a)) : sorted;
  return (
    <section className={`lt-panel ${winner ? "lt-panel-win" : "lt-panel-lose"}`}>
      <header className="lt-panel-head">
        {f ? <img className="lt-logo" src={teamLogoUrl(f.name, f.nickname) ?? ""} alt="" width={48} height={48} loading="lazy" /> : <span className="lt-logo" />}
        <div className="lt-team">
          <div className="lt-team-name">{f ? `${f.name} ${f.nickname}` : side.teamLabel}</div>
          <div className="lt-team-sub">{showThen ? `traded as ${then} · ` : ""}{tag}</div>
        </div>
        <div className="lt-total">
          <div className={`lt-total-num ${winner ? "lt-pos" : ""}`}>{fmtWar(side.war)}</div>
          <div className="lt-total-label">WAR received</div>
        </div>
      </header>
      <div className="lt-list">
        {sorted.length === 0 ? <div className="lt-sub">nothing</div> : shown.map((a, i) => <AssetRow key={i} asset={a} franchises={franchises} receiver={side} />)}
        {foldBusts && (
          <div className="lt-row lt-row-muted">
            <span className="lt-badge lt-badge-cash">+{busts.length}</span>
            <div className="lt-main">
              <div className="lt-name">{busts.length} other players</div>
              <div className="lt-sub">never played MLB for this team: {busts.map((b) => (b.kind === "player" ? `${b.name} (${b.pos})` : "")).join(", ")}</div>
            </div>
            <span className="lt-war lt-zero">0.0</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function TradeCard({ trade, rank, franchises }: { trade: LopsidedTrade; rank: number; franchises: Record<number, FranchiseInfo> }) {
  const aWins = trade.a.war >= trade.b.war;
  const win = aWins ? trade.a : trade.b;
  const lose = aWins ? trade.b : trade.a;
  const wf = franchises[win.teamId];
  const winPos = Math.max(0, win.war), losePos = Math.max(0, lose.war);
  const share = winPos + losePos > 0 ? (winPos / (winPos + losePos)) * 100 : 50;
  const allAssets = [...trade.a.receives, ...trade.b.receives];
  const estimated = allAssets.some((x) => x.kind === "pick" && x.resolution === "candidates" && x.credited);
  const understated = allAssets.some((x) => x.kind === "pick" && x.resolution === "unresolved");
  return (
    <article className="lt-card">
      <div className="lt-head">
        <div className="lt-rank">{rank}</div>
        <div className="lt-headtext">
          <div className="lt-date">{fmtDate(trade.tradeDate)} <span className="lt-ago">· {trade.yearsSince === 0 ? "this year" : `${trade.yearsSince} year${trade.yearsSince === 1 ? "" : "s"} ago`}</span></div>
          <div className="lt-headline">{wf ? `${wf.name} ${wf.nickname}` : win.teamLabel} came out ahead</div>
        </div>
        {trade.hasPick && <span className="lt-chip">includes draft picks</span>}
        {estimated && <span className="lt-chip lt-chip-warn" title="A first-round pick that could be one of several players; the average is used.">estimated pick value</span>}
        {understated && <span className="lt-chip lt-chip-warn" title="At least one pick could not be traced to a player, so this trade is understated.">some picks untraceable</span>}
        <div className="lt-margin">
          <div className="lt-margin-num">+{trade.margin.toFixed(1)}</div>
          <div className="lt-margin-label">WAR margin</div>
        </div>
      </div>
      <div className="lt-bar" aria-hidden="true">
        <div className="lt-bar-win" style={{ width: `${share}%` }} />
        <div className="lt-bar-lose" style={{ width: `${100 - share}%` }} />
      </div>
      <div className="lt-panels">
        <Panel side={win} winner franchises={franchises} tag="winner" />
        <Panel side={lose} winner={false} franchises={franchises} tag="gave up" />
      </div>
    </article>
  );
}
