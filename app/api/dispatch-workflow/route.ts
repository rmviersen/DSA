import { NextResponse, type NextRequest } from "next/server";
import { DISPATCHABLE, dispatch, isWorkflowKey, latestRun } from "../../../lib/github-dispatch";

// Target of WorkflowButton (2026-10-30): POST starts one of the two allow-listed GitHub workflows, GET reports the newest run's status so the
// button can show progress and reload the page's data when it finishes. See lib/github-dispatch.ts for why this goes through GitHub.
//
// No owner-cookie check here: /api/dispatch-workflow isn't in middleware.ts's GUEST_ALLOWED_PATHS, so a guest request is redirected before it
// reaches this handler (same reliance as app/api/draft-picks-refresh). On top of that POST requires a same-site Origin, so another website
// can't make the owner's browser start a run.
const NO_TOKEN = "GITHUB_DISPATCH_TOKEN is not set in this deployment's environment (Vercel project tbl-dsa > Settings > Environment Variables > Production), or the site was not redeployed after it was added.";

function fail(err: unknown, status = 500) {
  return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("workflow");
    if (!isWorkflowKey(key)) return fail("Unknown workflow.", 400);
    const token = process.env.GITHUB_DISPATCH_TOKEN;
    if (!token) return fail(NO_TOKEN);
    return NextResponse.json({ ok: true, run: await latestRun(key, token), serverTime: new Date().toISOString() });
  } catch (err) {
    console.error("dispatch-workflow GET failed:", err);
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.nextUrl.host) return fail("Cross-site request refused.", 403);
    const { workflow } = (await req.json().catch(() => ({}))) as { workflow?: unknown };
    if (!isWorkflowKey(workflow)) return fail("Unknown workflow.", 400);
    const token = process.env.GITHUB_DISPATCH_TOKEN;
    if (!token) return fail(NO_TOKEN);

    // Don't stack runs: if one is already queued or running, report it instead of starting another (and, for the trade block, hitting
    // StatsPlus's rate-limited website pages twice in a row).
    const current = await latestRun(workflow, token);
    if (current && current.status !== "completed") {
      return NextResponse.json({ ok: true, alreadyRunning: true, run: current, serverTime: new Date().toISOString() });
    }
    const dispatchedAt = new Date().toISOString();
    await dispatch(workflow, token);
    return NextResponse.json({ ok: true, alreadyRunning: false, dispatchedAt, label: DISPATCHABLE[workflow].file });
  } catch (err) {
    console.error("dispatch-workflow POST failed:", err);
    return fail(err);
  }
}
