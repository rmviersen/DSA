"use client";

import type { ProspectSnapshotOption } from "../../lib/queries";

// getProspectSnapshotOptions() already excludes snapshots with no in-game
// date (2026-08-20) -- gameDate is always real here, the "" fallback below
// is just to satisfy the `string | null` type, not an expected runtime case.
// Just the bare date (2026-08-24, Rees's spec) -- was "Game date 2031-07-21".
function snapshotLabel(opt: ProspectSnapshotOption): string {
  return opt.gameDate ?? "";
}

// Combined into one form (not two separate TeamFilter-style forms) so
// changing either dropdown preserves the other's current selection --
// two independent GET forms would each drop the other's query param.
export function ProspectFilters({
  teams,
  selectedOrgId,
  snapshots,
  selectedBaselineId,
  action,
}: {
  teams: { id: number; name: string; nickname: string }[];
  selectedOrgId?: number;
  snapshots: ProspectSnapshotOption[];
  selectedBaselineId?: number;
  // Was hardcoded to "/prospects" (2026-08-20 bug, caught before the /report
  // route shipped): on /report, using either dropdown would silently
  // redirect to /prospects -- the internal, nav-visible page -- instead of
  // staying on /report. Now passed in by the caller, same pattern as
  // TeamFilter's existing `action` prop.
  action: string;
}) {
  return (
    <form method="get" action={action} className="filter-bar">
      <label htmlFor="team-filter">Organization</label>
      <select
        id="team-filter"
        name="team"
        defaultValue={selectedOrgId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">All teams</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} {t.nickname}
          </option>
        ))}
      </select>

      <label htmlFor="since-filter">Change from</label>
      <select
        id="since-filter"
        name="since"
        defaultValue={selectedBaselineId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="">(current only, no comparison)</option>
        {snapshots.map((s) => (
          <option key={s.refreshRunId} value={s.refreshRunId}>
            {snapshotLabel(s)}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit">Apply</button>
      </noscript>
    </form>
  );
}
