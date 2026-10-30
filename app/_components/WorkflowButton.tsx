"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// "Refresh now" button for the two data jobs that GitHub's throttled scheduler can't keep fresh on its own (2026-10-30, Rees's ask: a trade-block
// refresh button on /trade-finder and a league-refresh button on /admin). It POSTs to /api/dispatch-workflow, which asks GitHub to run the real
// workflow, then polls that route for the run's status and calls router.refresh() once it succeeds so the page re-reads the new data -- same
// "server does the work, page re-fetches" shape as app/[league]/draft/DraftAutoRefresh.tsx.
//
// lastUpdatedIso is formatted in the browser's own time zone (inside an effect, so server and client renders agree) -- the server runs in UTC.
type Phase = "idle" | "starting" | "running" | "done" | "error";
const POLL_MS = 5000;

export function WorkflowButton({
  workflow, label, lastUpdatedIso, lastUpdatedLabel, maxWaitSec,
}: {
  workflow: "trade-block" | "refresh";
  label: string;
  lastUpdatedIso?: string | null;
  lastUpdatedLabel?: string;
  maxWaitSec: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [runUrl, setRunUrl] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    setLastUpdated(lastUpdatedIso ? new Date(lastUpdatedIso).toLocaleString() : null);
  }, [lastUpdatedIso]);

  async function start() {
    if (phase === "starting" || phase === "running") return;
    setPhase("starting"); setNote(null); setRunUrl(null);
    try {
      const res = await fetch("/api/dispatch-workflow", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow }), cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Our run is either the one already in progress, or the first run created after the moment the server asked GitHub to start one.
      const ownRunId: number | null = body.alreadyRunning ? body.run.id : null;
      const notBefore = body.alreadyRunning ? 0 : Date.parse(body.dispatchedAt) - 5000;
      if (body.alreadyRunning) setNote("Already running -- following that run.");
      setPhase("running");

      const deadline = Date.now() + maxWaitSec * 1000;
      while (alive.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const pr = await fetch(`/api/dispatch-workflow?workflow=${workflow}`, { cache: "no-store" });
        const pb = await pr.json();
        if (!pr.ok || !pb.ok) throw new Error(pb.error ?? `HTTP ${pr.status}`);
        const run = pb.run as { id: number; status: string; conclusion: string | null; createdAt: string; url: string } | null;
        if (!run) continue;
        const isOurs = ownRunId !== null ? run.id === ownRunId : Date.parse(run.createdAt) >= notBefore;
        if (!isOurs) continue; // GitHub hasn't listed the new run yet
        setRunUrl(run.url);
        if (run.status !== "completed") continue;
        if (run.conclusion === "success") {
          setPhase("done"); setNote("Finished -- data reloaded.");
          router.refresh();
        } else {
          setPhase("error"); setNote(`The run ended with "${run.conclusion}".`);
        }
        return;
      }
      if (alive.current) { setPhase("done"); setNote("Still running on GitHub -- reload this page in a few minutes."); }
    } catch (err) {
      if (alive.current) { setPhase("error"); setNote(err instanceof Error ? err.message : String(err)); }
    }
  }

  const busy = phase === "starting" || phase === "running";
  return (
    <p style={{ color: "var(--color-text-muted, #888)", fontSize: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <button
        onClick={start}
        disabled={busy}
        style={{ padding: "4px 10px", fontSize: 12, border: "1px solid var(--color-border-strong)", borderRadius: 4, background: "transparent", color: "inherit", cursor: busy ? "default" : "pointer" }}
      >
        {phase === "starting" ? "Starting…" : phase === "running" ? "Running…" : label}
      </button>
      {lastUpdated && lastUpdatedLabel && <span>{lastUpdatedLabel} {lastUpdated}</span>}
      {note && <span style={{ color: phase === "error" ? "rgb(220,38,38)" : undefined }}>{note}</span>}
      {runUrl && <a href={runUrl} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>view run</a>}
    </p>
  );
}
