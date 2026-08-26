"use client";

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import type { ProspectRow } from "../../lib/queries";
// Import from display-helpers directly, NOT queries.ts -- queries.ts also
// creates a Supabase client at module scope using server-only secrets, which
// would get bundled into the browser (and crash) if a "use client" component
// pulls in even one unrelated value export from that file. See
// display-helpers.ts's top comment.
import { levelLabel, teamLogoUrl } from "../../lib/display-helpers";

const COLUMN_COUNT = 12; // Rank, Org logo, Org abbr, Role, Name, Age, Level, ETA, Org Rank, Draft Yr, Rd, Pick
// Rank/Logo/Org all rowSpan across a player's two rows (2026-08-20) -- the
// detail row's colSpan has to skip all three, not just the logo like before.
const DETAIL_COLSPAN = COLUMN_COUNT - 3;

// Bio length cap (2026-08-20) -- a long unbroken write-up was inflating the
// table's auto column widths (see detailCell's wordBreak comment below for
// the CSS half of this fix). 140 chars is the enforcement backstop; the real
// target is writing to this limit in the first place, per
// prospect-bio-style-guide.md. Applied defensively here too in case a future
// stored bio slips past the limit some other way.
const BIO_MAX_CHARS = 140;
function capBio(text: string): string {
  if (text.length <= BIO_MAX_CHARS) return text;
  return text.slice(0, BIO_MAX_CHARS - 1).trimEnd() + "…";
}

const fmtInt = (n: number | null) => (n === null || n === undefined ? "—" : Math.round(n));
const fmt1 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(1));
// FIP/ERA always show two decimals (2026-08-20), unlike the other rate stats.
const fmt2 = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(2));
// 0-1 ratio -> ".XXX", the standard baseball convention (no leading zero).
const rate = (n: number | null) => (n === null || n === undefined ? "—" : n.toFixed(3).replace(/^0/, ""));
// mm/dd/yy, per Rees's spec (2026-08-24, corrected from an earlier dd/mm/yy
// pass) -- used only for the "stale since" label, so this is deliberately
// UTC-based (no local-timezone drift) and zero-padded.
function fmtStaleDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

// Stats at the player's CURRENT level only (2026-08-19 decision) -- no more
// by-level breakdown. Pitchers: IP/FIP/ERA/K-9/WAR. Batters: AB, the
// standard AVG/OBP/SLG slash line, HR, SB, ZR (Zone Rating, a real raw
// fielding stat), WAR.
// "value LABEL" throughout (2026-08-20 decision), e.g. "26 AB" not "AB 26" --
// matches how the slash line already reads (no leading label at all).
function statLine(r: ProspectRow): string {
  const t = r.seasonTotals;
  if (r.ph === "P") {
    if (t.ip === null) return "No Stats";
    return `${fmt1(t.ip)} IP · ${fmt2(t.fip)} FIP · ${fmt2(t.era)} ERA · ${fmt1(t.k9)} K/9 · ${fmt1(t.war)} WAR`;
  }
  if (r.ph === "H") {
    if (t.ab === null) return "No Stats";
    return `${fmtInt(t.ab)} AB · ${rate(t.avg)}/${rate(t.obp)}/${rate(t.slg)} · ${fmtInt(t.hr)} HR · ${fmtInt(t.sb)} SB · ${fmt1(t.zr)} ZR · ${fmt1(t.war)} WAR`;
  }
  return "No Stats";
}

// Inline delta badge shown next to a value when a "change from" baseline is
// selected. `lowerIsBetter` flips the color (and the implied direction) for
// rank columns, where a smaller number is the improvement.
function Delta({ value, lowerIsBetter = false }: { value: number | null | undefined; lowerIsBetter?: boolean }) {
  if (value === null || value === undefined || value === 0) return null;
  const improved = lowerIsBetter ? value < 0 : value > 0;
  const arrow = improved ? "▲" : "▼";
  const color = improved ? "#22c55e" : "#dc2626";
  const magnitude = Math.abs(value);
  return (
    <span style={{ color, fontSize: 11, marginLeft: 4, whiteSpace: "nowrap" }}>
      {arrow}{magnitude}
    </span>
  );
}

function NewBadge() {
  return <span style={{ color: "#38bdf8", fontSize: 10, marginLeft: 4, fontWeight: 700 }}>NEW</span>;
}

// No border between a player's own two rows -- they read as one cohesive
// box. The border instead goes under the detail row, separating one
// player's box from the next player's.
const CARD_BG = "var(--color-table-stripe, #f5f5f5)";
const mainCell: CSSProperties = { borderBottom: "none", whiteSpace: "nowrap" };
const detailCell: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted, #888)",
  borderTop: "none",
  borderBottom: "1px solid var(--color-border, #333)",
  background: CARD_BG,
  paddingTop: 2,
  paddingBottom: 4,
  // A long unbroken bio was inflating the auto table-layout algorithm's
  // preferred-width calculation for whichever columns this colspan-ed cell
  // sits above, stretching them wider than their own content needed --
  // confirmed 2026-08-20. wordBreak forces wrapping regardless of content
  // length, structurally preventing this regardless of how long a future
  // bio gets (the character cap below is the other half of the fix).
  wordBreak: "break-word",
};
// Inline text-flow trigger (not a boxed button, to match the surrounding
// stat-line/bio text rather than reading as a toolbar control) -- sits right
// after the stat line, same line, bio text only rendered once expanded (see
// expandedBios state) so it wraps naturally onto new lines when it appears.
const bioToggle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  marginLeft: 14, // more breathing room from the stat line (2026-08-24, Rees's spec -- was 6)
  color: "var(--color-link, #406020)",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.03em",
  cursor: "pointer",
  fontFamily: "inherit",
};
// The logo spans both of a player's rows via rowSpan. Bordered top/bottom +
// the same background as the detail row underneath ties it visually to the
// player's card. No left border (2026-08-24, Rees's spec -- was reading as
// an unwanted right border on the Rank column next to it) or right border
// (butts straight up against the Org column instead of boxing the logo off
// from it). Small left/right padding (2026-08-20) so the logo isn't flush
// against the cell edge; top/bottom stay at 0, the logo should still fill
// vertically.
const logoCell: CSSProperties = {
  ...mainCell,
  borderTop: "1px solid var(--color-border, #333)",
  borderBottom: "1px solid var(--color-border, #333)",
  background: CARD_BG,
  padding: "0 4px",
};
// Role/Name are the "headline" identity columns for a row -- bold and very
// slightly larger than the rest of the table's condensed 0.75rem base.
const headlineCell: CSSProperties = { ...mainCell, fontWeight: 700, fontSize: "0.8125rem" };
// Role specifically should be as narrow as possible without wrapping
// (2026-08-20) -- tighter horizontal padding than the shared table default,
// since its content (SP/INF/COF/etc, 1-3 chars) is much shorter than most
// other columns.
const roleCell: CSSProperties = { ...headlineCell, padding: "0.125rem 0.2rem" };
// Rank and Org (2026-08-20) act like the logo column: rowSpan across both of
// a player's rows, bold, and bordered top/bottom + the same background as
// the logo cell -- these three (Rank, Logo, Org) are now the fixed "anchor"
// columns every card starts with. Rank stays noticeably large; Org is
// smaller (2026-08-20 follow-up) since it doesn't need to compete with Rank
// for attention.
const anchorBorderBg: CSSProperties = {
  borderTop: "1px solid var(--color-border, #333)",
  borderBottom: "1px solid var(--color-border, #333)",
  background: CARD_BG,
};
const rankCell: CSSProperties = { ...mainCell, ...anchorBorderBg, fontWeight: 700, fontSize: "1.125rem", verticalAlign: "middle", textAlign: "center" };
// Org font sized down (2026-08-20 follow-up) so it reads clearly smaller than
// Rank next to it -- was 0.9375rem, matching Rank's old size too closely.
const orgAnchorCell: CSSProperties = { ...mainCell, ...anchorBorderBg, fontWeight: 700, fontSize: "0.8125rem", verticalAlign: "middle" };

// "#N" everywhere a rank number is shown, matching TeamRankingsTable's
// convention (2026-08-20) -- not just the bare number.
const rankLabel = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `#${n}`);

// Fixed display order (2026-08-20, Rees's spec) -- not alphabetical.
// Roughly pitchers first, then hitter roles by defensive spectrum.
const ROLE_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "COF", "CF", "DH"];

export function ProspectTable({ rows }: { rows: ProspectRow[] }) {
  const [phFilter, setPhFilter] = useState<"all" | "H" | "P">("all");
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  // Bios default folded (2026-08-24, Rees's spec) -- a player has to be
  // explicitly expanded, per-row, to read it. Keyed by player_id, not row
  // index, so state doesn't get scrambled if the filtered/sorted set changes
  // shape between renders.
  const [expandedBios, setExpandedBios] = useState<Set<number>>(new Set());

  function toggleBio(playerId: number) {
    setExpandedBios((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  const phFiltered = useMemo(
    () => (phFilter === "all" ? rows : rows.filter((r) => r.ph === phFilter)),
    [rows, phFilter]
  );

  // Role options are derived from the current H/P-filtered set, not
  // hardcoded -- so switching to Pitchers only ever shows SP/RP, not the
  // hitter buckets (C/SS/CF/INF/COF/1B/DH), and an org-scoped view only
  // offers roles that org's prospects actually have. ROLE_ORDER fixes the
  // display order; roles with no current match just don't appear.
  const roleOptions = useMemo(() => {
    const present = new Set(phFiltered.map((r) => r.role).filter((r): r is string => !!r));
    return ROLE_ORDER.filter((role) => present.has(role));
  }, [phFiltered]);

  // Multi-select (2026-08-20): empty set = no role filter applied (show
  // all); otherwise a row passes if its role is any of the selected ones.
  const filteredRows = useMemo(
    () => (roleFilter.size === 0 ? phFiltered : phFiltered.filter((r) => r.role !== null && roleFilter.has(r.role))),
    [phFiltered, roleFilter]
  );

  // Name search (2026-08-24, Rees's spec) -- purely client-side, on top of
  // the H/P + Role filters above, scoped to this table only (System
  // Rankings alongside it is untouched). Matches against first+last name
  // together so a full "First Last" search works, not just one half.
  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q));
  }, [filteredRows, search]);

  function handlePhFilter(f: "all" | "H" | "P") {
    setPhFilter(f);
    setRoleFilter(new Set()); // last role selection may not apply to the new H/P set
  }

  function toggleRole(role: string) {
    setRoleFilter((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  // Step 6 of the visual refresh (2026-08-25): a fade-in whenever the H/P
  // or Role filters change, instead of the table hard-snapping to the new
  // row set. Deliberately keyed on phFilter/roleFilter only, NOT search --
  // changing the key remounts the whole table (see below), and doing that
  // on every keystroke while typing a name would feel laggy, not alive.
  // Live search staying instant is the correct behavior anyway.
  //
  // CSS animation on the key-remounted div, not the Motion library -- not
  // because Motion was broken, but because this session's Browser pane
  // couldn't verify it either way: tried motion.div (initial={{opacity:0}}
  // animate={{opacity:1}}) first, and it stayed stuck at opacity:0 no
  // matter what, which looked like a Motion bug at first -- but the same
  // plain CSS @keyframes fade (see .table-wrap in globals.css) also read
  // back as stuck at opacity:0 in computed style. Traced to
  // `document.timeline.currentTime` reading a frozen 0 in this pane no
  // matter how long the page sat idle -- this session's Browser pane
  // isn't advancing its animation/compositor clock at all (consistent
  // with screenshot capture failing all session with "not compositing
  // frames"), so NEITHER approach could ever be observed animating here,
  // correct or not. Kept the CSS version anyway since it's simpler, adds
  // no JS dependency, and needs no library state to depend on -- but
  // this specific choice was never actually verified working, only
  // verified not-yet-disprovable. Rees should confirm live that this
  // fade actually looks right, same as the earlier logo swaps.
  const filterKey = `${phFilter}|${[...roleFilter].sort().join(",")}`;

  return (
    <div>
      <div style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
        {(["all", "H", "P"] as const).map((f) => (
          <button
            key={f}
            onClick={() => handlePhFilter(f)}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              border: "1px solid var(--color-border-strong)",
              borderRadius: 4,
              background: phFilter === f ? "var(--color-navy)" : "transparent",
              color: phFilter === f ? "var(--color-text-on-navy)" : "inherit",
              cursor: "pointer",
            }}
          >
            {f === "all" ? "All" : f === "H" ? "Hitters" : "Pitchers"}
          </button>
        ))}
        <span style={{ fontSize: 12, marginLeft: 8 }}>Role</span>
        {roleOptions.map((role) => (
          <button
            key={role}
            onClick={() => toggleRole(role)}
            aria-pressed={roleFilter.has(role)}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              border: "1px solid var(--color-border-strong)",
              borderRadius: 4,
              background: roleFilter.has(role) ? "var(--color-navy)" : "transparent",
              color: roleFilter.has(role) ? "var(--color-text-on-navy)" : "inherit",
              cursor: "pointer",
            }}
          >
            {role}
          </button>
        ))}
        {roleFilter.size > 0 && (
          <button
            onClick={() => setRoleFilter(new Set())}
            style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
          >
            Clear roles
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            style={{
              padding: "3px 8px",
              fontSize: 12,
              border: "1px solid var(--color-border-strong)",
              borderRadius: 4,
              background: "transparent",
              color: "inherit",
              width: 160,
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              style={{ padding: "3px 8px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
            >
              ×
            </button>
          )}
        </div>
      </div>
    <div key={filterKey} className="table-wrap">
    <table className="prospect-table">
      <thead>
        <tr>
          <th style={{ textAlign: "center" }}>Rank</th>
          <th></th>
          <th>Org</th>
          <th style={{ padding: "0.125rem 0.2rem" }}>Role</th>
          <th style={{ whiteSpace: "nowrap" }}>Name</th>
          <th>Age</th>
          <th>LVL</th>
          <th>ETA</th>
          <th>Org Rank</th>
          <th>Draft Yr</th>
          <th>Rd</th>
          <th>Pick</th>
        </tr>
      </thead>
      <tbody>
        {searchedRows.map((r) => {
          const logo = teamLogoUrl(r.orgName, r.orgNickname);
          return (
            <Fragment key={r.player_id}>
              <tr>
                <td rowSpan={2} style={rankCell}>
                  {rankLabel(r.prospect_rank)}
                  {r.delta?.isNew ? <NewBadge /> : <Delta value={r.delta?.prospectRank} lowerIsBetter />}
                </td>
                <td rowSpan={2} style={logoCell}>
                  {logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" width={36} height={36} style={{ display: "block" }} />
                  )}
                </td>
                <td rowSpan={2} style={{ ...orgAnchorCell, whiteSpace: "nowrap" }}>{r.orgAbbr ?? "—"}</td>
                <td style={roleCell}>{r.role || "—"}</td>
                <td style={{ ...headlineCell, whiteSpace: "nowrap" }}>
                  <a
                    href={`https://atl-02.statsplus.net/thebigleague/player/${r.player_id}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "inherit", textDecoration: "none" }}
                    onMouseOver={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseOut={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                  >
                    {r.first_name} {r.last_name}
                  </a>
                </td>
                <td style={mainCell}>{r.age ?? "—"}</td>
                <td style={mainCell}>{levelLabel(r.level)}{r.teamAbbr ? ` (${r.teamAbbr})` : ""}</td>
                <td style={mainCell}>{r.eta ?? "—"}</td>
                <td style={mainCell}>
                  {rankLabel(r.prospect_org_rank)}
                  {r.delta?.isNew ? <NewBadge /> : <Delta value={r.delta?.prospectOrgRank} lowerIsBetter />}
                </td>
                {(() => {
                  // No draft record at all (year/round/pick all blank) means
                  // the player entered the org some other way -- international
                  // signing, in practice, per Rees 2026-08-20 -- so show one
                  // italic "INT" in the Draft Yr cell and leave Rd/Pick blank
                  // (2026-08-20 follow-up: not merged across all three).
                  const undrafted = r.draft_year == null && r.draft_round == null && r.draft_overall_pick == null;
                  return (
                    <>
                      <td style={r.isRecentDraftPick ? { ...mainCell, fontWeight: 700, color: "#38bdf8" } : mainCell}>
                        {undrafted ? <span style={{ fontStyle: "italic" }}>INT</span> : r.draft_year ?? "—"}
                      </td>
                      <td style={mainCell}>{undrafted ? "" : r.draft_round ?? "—"}</td>
                      <td style={mainCell}>{undrafted ? "" : r.draft_overall_pick ?? "—"}</td>
                    </>
                  );
                })()}
              </tr>
              <tr>
                <td colSpan={DETAIL_COLSPAN} style={detailCell}>
                  <strong>{statLine(r)}</strong>
                  {r.bio && (() => {
                    const isOpen = expandedBios.has(r.player_id);
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleBio(r.player_id)}
                          aria-expanded={isOpen}
                          style={bioToggle}
                        >
                          BIO {isOpen ? "▲" : "▼"}
                        </button>
                        {isOpen && (
                          <>
                            {" "}
                            {capBio(r.bio)}
                            {r.bioStale && r.bioDate && (
                              <span
                                title="This bio was written against an earlier snapshot -- ratings/rank have moved since."
                                style={{ marginLeft: 4, fontStyle: "italic", color: "var(--color-text-muted, #888)" }}
                              >
                                (stale since {fmtStaleDate(r.bioDate)})
                              </span>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}
                </td>
              </tr>
            </Fragment>
          );
        })}
        {searchedRows.length === 0 && (
          <tr>
            <td colSpan={COLUMN_COUNT} className="empty-state">No prospects match this filter.</td>
          </tr>
        )}
      </tbody>
    </table>
    </div>
    </div>
  );
}
