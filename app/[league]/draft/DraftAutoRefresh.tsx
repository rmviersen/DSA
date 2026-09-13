"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Auto-refresh for the live draft board (2026-09-13, Rees's ask, same
// afternoon as the "Available only" filter: "set it up to auto-refresh every
// few minutes"). Polls the /api/draft-picks-refresh route (a thin server
// wrapper around StatsPlus's public draftv2 feed) on a timer, then calls
// router.refresh() so the page's server-rendered data (getTopDraftees, which
// reads draft_picks) re-fetches with whatever just got upserted -- no full
// page reload, no client-side re-implementation of the draft-board query.
//
// 3-minute interval: frequent enough to matter during a live draft (a real
// pick took as little as ~1 minute between two automated auto-picks earlier
// today) without hammering StatsPlus's server needlessly between checks.
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;

export function DraftAutoRefresh({ league }: { league: string }) {
  const router = useRouter();
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function checkNow() {
    if (inFlight.current) return; // don't stack overlapping checks if one runs long
    inFlight.current = true;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/draft-picks-refresh?league=${encodeURIComponent(league)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setLastChecked(new Date());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  useEffect(() => {
    checkNow(); // once immediately on load, so opening the page is never stale by up to 3 minutes
    const id = setInterval(checkNow, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkNow closes over `league`, which is stable for the life of this page
  }, [league]);

  return (
    <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
      <span>Auto-refreshing picks every 3 minutes.</span>
      <button
        onClick={checkNow}
        disabled={checking}
        style={{ padding: "2px 8px", fontSize: 11, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", color: "inherit", cursor: checking ? "default" : "pointer" }}
      >
        {checking ? "Checking…" : "Check now"}
      </button>
      {lastChecked && !checking && <span>Last checked {lastChecked.toLocaleTimeString()}</span>}
      {error && <span style={{ color: "rgb(220,38,38)" }}>Check failed: {error}</span>}
    </p>
  );
}
