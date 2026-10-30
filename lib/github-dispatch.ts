// Start (and watch) a GitHub Actions workflow from the site (2026-10-30, Rees's ask: "add that button for the trade block refresh ... and a button
// on the admin page for the league refresh"). Why this exists: GitHub's cron trigger is best-effort and was measured at one run every 3-6 hours
// instead of the 30 min / 1 hour the workflows ask for (HANDOFF 2026-10-30), so freshness can't depend on it. The StatsPlus WEBSITE cookies the
// trade-block scrape needs live only in GitHub's secrets store, so rather than copy them to Vercel the site asks GitHub to run the existing
// workflow ("workflow_dispatch") and then polls its status.
//
// Needs GITHUB_DISPATCH_TOKEN in the deployment's environment: a fine-grained personal access token limited to the rmviersen/DSA repository with
// "Actions: Read and write" (nothing else), with an expiry date. Only the two workflows below can ever be started -- the key is looked up here,
// the caller never supplies a file name.
const REPO = "rmviersen/DSA";
const REF = "main";

export const DISPATCHABLE = {
  "trade-block": { file: "trade-block.yml", inputs: {} as Record<string, string> },
  // only_if_new=true makes a manual run behave like a scheduled tick: it checks StatsPlus's game date first and stops in ~30 s if nothing new
  // has simmed, instead of forcing a full ~9 minute refresh (refresh.yml's input, added the same day).
  refresh: { file: "refresh.yml", inputs: { reason: "admin page button", only_if_new: "true" } as Record<string, string> },
} as const;
export type WorkflowKey = keyof typeof DISPATCHABLE;

export function isWorkflowKey(v: unknown): v is WorkflowKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DISPATCHABLE, v);
}

export interface RunInfo {
  id: number;
  status: string;           // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ... (null until completed)
  createdAt: string;
  url: string;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dsa-site",
  };
}

async function explain(res: Response, doing: string): Promise<Error> {
  const text = (await res.text().catch(() => "")).slice(0, 300);
  if (res.status === 401) return new Error(`GitHub rejected the token while ${doing} (401): it is wrong or has expired -- create a new one and update GITHUB_DISPATCH_TOKEN.`);
  if (res.status === 403 || res.status === 404) return new Error(`GitHub refused ${doing} (${res.status}): the token needs access to ${REPO} with "Actions: Read and write". ${text}`);
  return new Error(`GitHub error while ${doing} (${res.status}): ${text}`);
}

export async function latestRun(key: WorkflowKey, token: string): Promise<RunInfo | null> {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${DISPATCHABLE[key].file}/runs?per_page=1`;
  const res = await fetch(url, { headers: headers(token), cache: "no-store" });
  if (!res.ok) throw await explain(res, "reading the latest run");
  const body = (await res.json()) as { workflow_runs?: { id: number; status: string; conclusion: string | null; created_at: string; html_url: string }[] };
  const r = body.workflow_runs?.[0];
  return r ? { id: r.id, status: r.status, conclusion: r.conclusion, createdAt: r.created_at, url: r.html_url } : null;
}

export async function dispatch(key: WorkflowKey, token: string): Promise<void> {
  const w = DISPATCHABLE[key];
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${w.file}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: REF, inputs: w.inputs }),
  });
  if (res.status !== 204) throw await explain(res, "starting the workflow");
}
