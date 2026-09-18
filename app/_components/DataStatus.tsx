"use client";

import { useEffect, useState } from "react";
import type { DataFreshness } from "../../lib/display-helpers";

// Public-header data badge (2026-09-18, Rees's ask): "Data as of <in-game date>"
// plus a status line ("Current · updated 3h ago" / "Refreshing…" / "Update
// delayed"), so guests can tell when the numbers last refreshed. The status
// comes from the server (getDataFreshness); the "updated Xh ago" text is
// computed here in the browser after mount (the server can't know the
// viewer's "now" without the page going stale under caching, and rendering
// it on both sides would trip a hydration mismatch) -- until mount it just
// shows the status word.

const STATUS_LABEL: Record<DataFreshness["state"], string> = {
  current: "Current",
  refreshing: "Refreshing…",
  delayed: "Update delayed",
};

function fmtGameDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DataStatus({ freshness }: { freshness: DataFreshness }) {
  const [agoText, setAgoText] = useState<string | null>(null);
  useEffect(() => {
    if (freshness.completedAt) setAgoText(ago(freshness.completedAt));
  }, [freshness.completedAt]);

  if (!freshness.gameDate) return null;
  const title = freshness.completedAt
    ? `Last successful refresh: ${new Date(freshness.completedAt).toLocaleString()}`
    : undefined;
  return (
    <div className={`data-status data-status--${freshness.state}`} title={title}>
      <span className="data-status-date">Data as of {fmtGameDate(freshness.gameDate)}</span>
      <span className="data-status-state">
        <span className="data-status-dot" aria-hidden="true" />
        {STATUS_LABEL[freshness.state]}
        {agoText && freshness.state !== "refreshing" ? ` · updated ${agoText}` : ""}
      </span>
    </div>
  );
}
