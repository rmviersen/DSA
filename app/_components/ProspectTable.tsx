"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ProspectRow } from "../../lib/queries";
// Import from display-helpers directly, NOT queries.ts -- queries.ts also
// creates a Supabase client at module scope using server-only secrets, which
// would get bundled into the browser (and crash) if a "use client" component
// pulls in even one unrelated value export from that file. See
// display-helpers.ts's top comment.
import { levelLabel, statsPlusPlayerUrl, teamLogoUrl } from "../../lib/display-helpers";

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

// Full-season totals, summed across every level the player played this
// season (reversed 2026-08-30 back from a 2026-08-19 "current level only"
// decision -- see lib/queries.ts's getTopProspectsDetailed for why: a
// mid-season promotion was silently truncating a real full-season workload
// down to whatever the new level alone showed). Pitchers: IP/FIP/ERA/K-9/
// WAR. Batters: AB, the standard AVG/OBP/SLG slash line, HR, SB, ZR (Zone
// Rating, a real raw fielding stat), WAR. Levels played this season are
// their own trailing "· LEVEL" or "· LEVEL/LEVEL" segment now (2026-08-30,
// Rees's spec: "552 AB · .301/.349/.505 · 27 HR · 2 SB · -0.1 ZR · 1.9 WAR
// · AA/AAA") -- shown even for a single level now, not just multi-level
// ("across AA & AAA" before this), so every row states where its stats
// came from, not just the split ones. Order still best-level-first (see
// t.levels' own ascending-by-level-number sort in lib/queries.ts) --
// unchanged by this rewrite, just the punctuation/wording around it.
// "value LABEL" throughout (2026-08-20 decision), e.g. "26 AB" not "AB 26" --
// matches how the slash line already reads (no leading label at all).
function statLine(r: ProspectRow): string {
  const t = r.seasonTotals;
  const levelsSuffix = t.levels.length > 0 ? ` · ${t.levels.join("/")}` : "";
  if (r.ph === "P") {
    if (t.ip === null) return "No Stats";
    return `${fmt1(t.ip)} IP · ${fmt2(t.fip)} FIP · ${fmt2(t.era)} ERA · ${fmt1(t.k9)} K/9 · ${fmt1(t.war)} WAR${levelsSuffix}`;
  }
  if (r.ph === "H") {
    if (t.ab === null) return "No Stats";
    return `${fmtInt(t.ab)} AB · ${rate(t.avg)}/${rate(t.obp)}/${rate(t.slg)} · ${fmtInt(t.hr)} HR · ${fmtInt(t.sb)} SB · ${fmt1(t.zr)} ZR · ${fmt1(t.war)} WAR${levelsSuffix}`;
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
    <span style={{ color, fontSize: 11, marginLeft: 4, fontWeight: 700, whiteSpace: "nowrap" }}>
      {arrow}{magnitude}
    </span>
  );
}

function NewBadge() {
  return <span style={{ color: "#38bdf8", fontSize: 10, marginLeft: 4, fontWeight: 700 }}>NEW</span>;
}

// Fixed display order (2026-08-20, Rees's spec) -- not alphabetical.
// Roughly pitchers first, then hitter roles by defensive spectrum.
const ROLE_ORDER = ["SP", "RP", "C", "1B", "INF", "SS", "COF", "CF", "DH"];

// "#N" everywhere a rank number is shown, matching TeamRankingsTable's
// convention (2026-08-20) -- not just the bare number.
const rankLabel = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `#${n}`);

// Role-pill color-coding (2026-08-26, Rees's spec) -- five position-family
// hues (pitchers/catchers/infield/outfield/DH), each role within a family
// a tonal variant of that one hue. The actual color values live in
// globals.css (--role-* custom properties, light + dark); this just maps
// a role string to the matching CSS class. Falls back to no extra class
// (globals.css's base .prospect-role already has a neutral default) for
// any role string outside ROLE_ORDER, rather than guessing a bucket.
const ROLE_CLASS: Record<string, string> = {
  SP: "role-sp", RP: "role-rp",
  C: "role-c",
  SS: "role-ss", INF: "role-inf", "1B": "role-1b",
  CF: "role-cf", COF: "role-cof",
  DH: "role-dh",
};
const roleClass = (role: string | null) => (role && ROLE_CLASS[role]) || "";

// showInternalLinks (2026-08-30): true shows both the internal
// /players/[id] link (as the name itself) and a small external StatsPlus
// "↗" icon after it -- the admin/real-owner experience. false shows only
// the name linking straight to StatsPlus, no icon, no internal link at
// all -- what a real guest (or an owner previewing as one) gets. Computed
// by the caller (FarmSystemReportBody, via each page's own owner check),
// not read from a cookie here -- this component has no access-control
// role, it just draws whichever mode it's told to.
export function ProspectTable({ rows, showInternalLinks }: { rows: ProspectRow[]; showInternalLinks: boolean }) {
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
  // or Role filters change, instead of the card list hard-snapping to the
  // new row set. Deliberately keyed on phFilter/roleFilter only, NOT search
  // -- changing the key remounts the whole list (see below), and doing that
  // on every keystroke while typing a name would feel laggy, not alive.
  // Live search staying instant is the correct behavior anyway.
  const filterKey = `${phFilter}|${[...roleFilter].sort().join(",")}`;

  return (
    <div>
      {/* flexWrap: "wrap" added 2026-08-31 -- this row (H/P + Role toggle
          buttons, plus the search box) had no wrap at all, so on a real
          mobile viewport (checked at 375px) it just overflowed the whole
          page horizontally instead of dropping extra buttons to a second
          line. rowGap keeps wrapped rows from touching once they stack. */}
      <div style={{ marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 8, rowGap: 6, alignItems: "center" }}>
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

      {searchedRows.length === 0 ? (
        <div className="empty-state">No prospects match this filter.</div>
      ) : (
        // Step 7 follow-up (2026-08-26): cards replace the old double-<tr>
        // table -- Rees found the table grid look clunky, especially once
        // dark mode made the hard cell borders more noticeable, and asked
        // for the rounded, lighter-fill "bubble" card style from the
        // original visual-refresh proposal's .option/.diag-item boxes
        // instead. Same fields, same order, just laid out as one card per
        // prospect rather than two table rows glued together with matching
        // backgrounds. Mocked up and approved by Rees before this was built
        // (see the "Prospect Cards Mockup" artifact) -- key={filterKey}
        // still remounts the whole list on an H/P or Role change so the
        // fade-in (.prospect-cards in globals.css) replays, same as before.
        <div key={filterKey} className="prospect-cards">
          {searchedRows.map((r) => {
            const logo = teamLogoUrl(r.orgName, r.orgNickname);
            const undrafted = r.draft_year == null && r.draft_round == null && r.draft_overall_pick == null;
            const isOpen = expandedBios.has(r.player_id);
            const hasBio = !!r.bio;

            // Whole-card click-to-expand (2026-08-30, Rees's spec) -- but
            // not when the click landed on a real link (player name,
            // StatsPlus icon): checking closest("a") here means any link
            // added inside a card later is automatically excluded too,
            // without having to remember to stopPropagation on each one.
            function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
              if (!hasBio) return;
              if ((e.target as HTMLElement).closest("a")) return;
              toggleBio(r.player_id);
            }
            function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
              if (!hasBio) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleBio(r.player_id);
              }
            }

            return (
              <div
                className={`prospect-card${hasBio ? " prospect-card--clickable" : ""}`}
                key={r.player_id}
                onClick={handleCardClick}
                onKeyDown={hasBio ? handleCardKeyDown : undefined}
                role={hasBio ? "button" : undefined}
                tabIndex={hasBio ? 0 : undefined}
                aria-expanded={hasBio ? isOpen : undefined}
              >
                {/* Header row: rank/logo/name/meta/stats -- restructured
                    2026-08-30 into its own row (was the card's direct
                    flex children before) specifically so its height never
                    changes when the bio below expands, which is what keeps
                    the logo/rank/name centering stable either way. See
                    .prospect-card's comment in globals.css. */}
                <div className="prospect-card-header">
                  <div className="prospect-card-rank">
                    <span className="num">{rankLabel(r.prospect_rank)}</span>
                    {r.delta?.isNew ? <NewBadge /> : <Delta value={r.delta?.prospectRank} lowerIsBetter />}
                  </div>
                  {/* Logo + org abbreviation grouped as one "team" unit
                      (2026-08-26, Rees's spec -- org used to sit at the far
                      right of the name row, disconnected from the logo it
                      identifies). Team-color-matched text is a follow-up --
                      no team color data exists anywhere in the schema yet
                      (`teams` is just id/name/nickname/parent_team_id), so
                      this is plain muted text for now pending that. */}
                  <div className="prospect-team">
                    <div className="prospect-logo">
                      {logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo} alt="" />
                      ) : (
                        r.orgAbbr?.slice(0, 3) ?? ""
                      )}
                    </div>
                    <span className="prospect-org">{r.orgAbbr ?? "—"}</span>
                  </div>
                  <div className="prospect-card-body">
                    {/* Role + Name group (2026-08-27, Rees's spec) -- its own
                        block now, vertically centered by .prospect-card-body
                        against .prospect-details next to it (which is taller,
                        two lines: meta + stats). Used to be one row together
                        with meta; splitting them out is what let Stats start
                        at the same x as Meta regardless of name length -- see
                        .prospect-details in globals.css. */}
                    <div className="prospect-namerow">
                      <span className={`prospect-role ${roleClass(r.role)}`}>{r.role || "—"}</span>
                      {/* Name links to our own player detail page
                          (2026-08-29, Rees's spec) plus a small external
                          StatsPlus "↗" icon after it -- but ONLY for a real,
                          non-previewing owner (2026-08-30). A guest (or an
                          owner previewing as one) gets just the name
                          linking straight to StatsPlus, no icon, no
                          internal link at all -- /players/[id] is
                          owner-only regardless, this is purely about not
                          advertising a link a guest can't use. Excluded
                          from the card's own click-to-expand via
                          closest("a") above either way. */}
                      {showInternalLinks ? (
                        <>
                          <Link href={`/players/${r.player_id}`} className="prospect-name">
                            {r.first_name} {r.last_name}
                          </Link>
                          <a
                            href={statsPlusPlayerUrl(r.player_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on StatsPlus"
                            style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}
                          >
                            ↗
                          </a>
                        </>
                      ) : (
                        <a href={statsPlusPlayerUrl(r.player_id)} target="_blank" rel="noopener noreferrer" className="prospect-name">
                          {r.first_name} {r.last_name}
                        </a>
                      )}
                    </div>
                    <div className="prospect-details">
                      {/* Each callout is its own flex child now (2026-08-27,
                          Rees's spec) -- was one text blob with word-spacing
                          stretching every space, which also wrongly widened
                          the space INSIDE "Org Rank" itself. A real `gap`
                          between callouts (globals.css) fixes that: spacing
                          lives between callouts, never inside one. */}
                      <div className="prospect-meta">
                        <span className="prospect-meta-item">Age <b>{r.age ?? "—"}</b></span>
                        <span className="prospect-meta-item">{levelLabel(r.level)}{r.teamAbbr ? ` (${r.teamAbbr})` : ""}</span>
                        <span className="prospect-meta-item">ETA <b>{r.eta ?? "—"}</b></span>
                        <span className="prospect-meta-item">
                          Org Rank <b>{rankLabel(r.prospect_org_rank)}</b>
                          {r.delta?.isNew ? <NewBadge /> : <Delta value={r.delta?.prospectOrgRank} lowerIsBetter />}
                        </span>
                        {/* Role Rank (2026-08-27, new): leaguewide rank within
                            this player's role bucket (SP/RP/C/1B/INF/SS/COF/
                            CF/DH) by prospect potential -- computed server-side
                            in scripts/compute-ratings.ts (player_computed.
                            prospect_role_rank), not derived here. Placed right
                            after Org Rank per spec. */}
                        <span className="prospect-meta-item">
                          Role Rank <b>{rankLabel(r.prospect_role_rank)}</b>
                          {r.delta?.isNew ? <NewBadge /> : <Delta value={r.delta?.prospectRoleRank} lowerIsBetter />}
                        </span>
                        <span className="prospect-meta-item">
                          {undrafted ? (
                            <span style={{ fontStyle: "italic" }}>INT</span>
                          ) : (
                            <span style={r.isRecentDraftPick ? { color: "#38bdf8", fontWeight: 700 } : undefined}>
                              {r.draft_year ?? "—"} R{r.draft_round ?? "—"} Pk{r.draft_overall_pick ?? "—"}
                            </span>
                          )}
                        </span>
                        {/* Player comp (2026-08-31, moved after Draft +
                            linked to StatsPlus 2026-08-31, Rees's follow-up
                            asks): nearest established MLB player whose
                            CURRENT tool grades match this prospect's
                            POTENTIAL grades, computed server-side in
                            scripts/compute-ratings.ts -- see that file's
                            "Player comp" section for the full methodology.
                            Only rendered when one exists (absent for a rare
                            role bucket with no established candidates, not
                            currently observed in real data). The name links
                            to the comp's own StatsPlus profile (opens in a
                            new tab, same convention as the ↗ icon next to a
                            prospect's own name) so a name you don't
                            recognize is one click from a real profile, not
                            a dead end. Similarity stays a hover tooltip, not
                            shown inline -- a bare linked name reads as a
                            clean, confident comp the way a real scouting
                            report states one, while the percentage is still
                            one hover away for anyone who wants it. */}
                        {r.compPlayerName && r.compPlayerId !== null && (
                          <span className="prospect-meta-item" title={r.compSimilarity !== null ? `${r.compSimilarity}% similarity` : undefined}>
                            Comp{" "}
                            <a href={statsPlusPlayerUrl(r.compPlayerId)} target="_blank" rel="noopener noreferrer">
                              <b>{r.compPlayerName}</b>
                            </a>
                          </span>
                        )}
                      </div>
                      <div className="prospect-stats">
                        {statLine(r)}
                        {hasBio && <span className="prospect-bio-indicator">BIO {isOpen ? "▲" : "▼"}</span>}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Expanded bio -- full card width, own block below the
                    header row (2026-08-30), not squeezed into the narrow
                    .prospect-details column the old one-line bio fit in.
                    No longer capBio()-truncated: the longer, more developed
                    format (draft background, development trajectory,
                    profile analysis) is the point now that this isn't
                    always-visible screen space. */}
                {isOpen && r.bio && (
                  <div className="prospect-bio-expanded">
                    {r.bio}
                    {r.bioStale && r.bioDate && (
                      <span
                        title="This bio was written against an earlier snapshot -- ratings/rank have moved since."
                        style={{ marginLeft: 6, fontStyle: "italic", color: "var(--color-text-muted, #888)" }}
                      >
                        (stale since {fmtStaleDate(r.bioDate)})
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
