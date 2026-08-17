import { parse } from "csv-parse/sync";

export interface StatsPlusConfig {
  baseUrl: string; // e.g. https://atl-02.statsplus.net/thebigleague/api
  sessionId?: string;
  csrfToken?: string;
}

/** Rows come back keyed by the CSV's original header text — untouched, unmapped. */
export type RawRow = Record<string, string>;

function cookieHeader(cfg: StatsPlusConfig): Record<string, string> {
  if (!cfg.sessionId || !cfg.csrfToken) return {};
  return { Cookie: `sessionid=${cfg.sessionId}; csrftoken=${cfg.csrfToken}` };
}

// Throttle every outbound request through here, and back off hard on 429s —
// we've leaned on this API a lot this session; being a good citizen of someone
// else's server matters more than shaving seconds off a refresh run.
const MIN_REQUEST_GAP_MS = 1500;
let lastRequestAt = 0;

async function throttle() {
  const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const MAX_429_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_429_RETRIES; attempt++) {
    await throttle();
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 10_000 * attempt;
      console.warn(`429 from StatsPlus (attempt ${attempt}/${MAX_429_RETRIES}), waiting ${retryAfterMs}ms — ${url}`);
      await new Promise((r) => setTimeout(r, retryAfterMs));
      continue;
    }
    if (!res.ok) {
      throw new Error(`StatsPlus request failed: ${res.status} ${res.statusText} — ${url}`);
    }
    return res.text();
  }
  throw new Error(`StatsPlus kept returning 429 after ${MAX_429_RETRIES} attempts — ${url}`);
}

function parseCsv(text: string): RawRow[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "Unknown API") {
    throw new Error(`StatsPlus returned no data (endpoint may not exist or auth failed): ${trimmed.slice(0, 200)}`);
  }
  return parse(trimmed, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

/** Plain public endpoints — no auth, returns CSV directly. */
async function fetchPublicCsv(cfg: StatsPlusConfig, endpoint: string, params: Record<string, string | number> = {}): Promise<RawRow[]> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `${cfg.baseUrl}/${endpoint}/${qs ? `?${qs}` : ""}`;
  const text = await fetchText(url);
  return parseCsv(text);
}

/** Session-gated endpoints (gamehistory) — needs cookies, returns CSV directly. */
async function fetchAuthedCsv(cfg: StatsPlusConfig, endpoint: string, params: Record<string, string | number> = {}): Promise<RawRow[]> {
  if (!cfg.sessionId || !cfg.csrfToken) {
    throw new Error(`${endpoint} requires STATSPLUS_SESSION_ID and STATSPLUS_CSRF_TOKEN — none provided, skipping.`);
  }
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `${cfg.baseUrl}/${endpoint}/${qs ? `?${qs}` : ""}`;
  const text = await fetchText(url, cookieHeader(cfg));
  return parseCsv(text);
}

/**
 * /ratings/ is an async job: the first request kicks it off and returns a poll URL.
 * Poll until the response stops being the "still in progress" placeholder text.
 */
async function fetchRatingsCsv(cfg: StatsPlusConfig, opts: { pollIntervalMs?: number; timeoutMs?: number } = {}): Promise<RawRow[]> {
  if (!cfg.sessionId || !cfg.csrfToken) {
    throw new Error("ratings requires STATSPLUS_SESSION_ID and STATSPLUS_CSRF_TOKEN — none provided, skipping.");
  }
  const kickoff = await fetchText(`${cfg.baseUrl}/ratings/`, cookieHeader(cfg));
  const match = kickoff.match(/https:\/\/\S+\/api\/mycsv\/\?request=\S+/);
  if (!match) {
    throw new Error(`Unexpected /ratings/ response, no poll URL found: ${kickoff.slice(0, 200)}`);
  }
  // The kickoff response sometimes points at the generic statsplus.net host rather than
  // this league's specific shard (atl-02) — that host redirects and drops auth. Force it
  // back onto the same host we're already talking to.
  const pollUrl = match[0].replace(/^https:\/\/[^/]+/, new URL(cfg.baseUrl).origin);

  const pollIntervalMs = opts.pollIntervalMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = await fetchText(pollUrl, cookieHeader(cfg));
    if (!/still in progress/i.test(text)) {
      return parseCsv(text);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Ratings export did not finish within ${timeoutMs}ms`);
}

export function makeStatsPlusClient(cfg: StatsPlusConfig) {
  return {
    teams: () => fetchPublicCsv(cfg, "teams"),
    players: () => fetchPublicCsv(cfg, "players"),
    contracts: () => fetchPublicCsv(cfg, "contract"),
    contractExtensions: () => fetchPublicCsv(cfg, "contractextension"),
    draft: (lid?: string) => fetchPublicCsv(cfg, "draftv2", lid ? { lid } : {}),
    playerBatting: (year?: number) => fetchPublicCsv(cfg, "playerbatstatsv2", year ? { year } : {}),
    playerPitching: (year?: number) => fetchPublicCsv(cfg, "playerpitchstatsv2", year ? { year } : {}),
    playerFielding: (year?: number) => fetchPublicCsv(cfg, "playerfieldstatsv2", year ? { year } : {}),
    teamBatting: (year?: number) => fetchPublicCsv(cfg, "teambatstats", year ? { year } : {}),
    teamPitching: (year?: number) => fetchPublicCsv(cfg, "teampitchstats", year ? { year } : {}),
    gameHistory: () => fetchAuthedCsv(cfg, "gamehistory"),
    ratings: (opts?: { pollIntervalMs?: number; timeoutMs?: number }) => fetchRatingsCsv(cfg, opts),
    hasSession: () => Boolean(cfg.sessionId && cfg.csrfToken),
  };
}

export type StatsPlusClient = ReturnType<typeof makeStatsPlusClient>;
