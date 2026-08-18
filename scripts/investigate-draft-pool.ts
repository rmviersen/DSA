import "dotenv/config";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { makeSupabaseClient } from "../lib/supabase-client.js";

const CSV_PATH = "C:/Users/rmvie/OneDrive/Documents/Out of the Park Developments/OOTP Baseball 27/saved_games/TheBigLeague.lg/import_export/the_big_league_draft_pool_-_draft_pool_player_info.csv";

async function main() {
  const supabase = makeSupabaseClient();
  const raw = parse(readFileSync(CSV_PATH, "utf-8"), { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  const poolIds = raw.map((r) => Number(r.ID));
  console.log(`2031 draft pool export: ${poolIds.length} players`);

  // Pull date_of_birth for every ID in the pool
  const inPool: { id: number; date_of_birth: string | null; age: number | null; draft_eligible: boolean | null; draft_year: number | null }[] = [];
  for (let i = 0; i < poolIds.length; i += 500) {
    const chunk = poolIds.slice(i, i + 500);
    const { data, error } = await supabase.from("players").select("id, date_of_birth, age, draft_eligible, draft_year").in("id", chunk);
    if (error) throw error;
    inPool.push(...(data as never[]));
  }
  console.log(`Matched ${inPool.length} of ${poolIds.length} pool IDs in our players table`);

  const dobs = inPool.filter((p) => p.date_of_birth).map((p) => p.date_of_birth as string).sort();
  console.log(`Pool date_of_birth range: ${dobs[0]}  to  ${dobs[dobs.length - 1]}`);

  const notDraftEligible = inPool.filter((p) => p.draft_eligible === false);
  console.log(`Pool members with draft_eligible=false: ${notDraftEligible.length}`);

  // Now find players NOT in the pool whose DOB falls inside that same range, to check
  // whether the DOB window alone perfectly separates "in this class" from "not".
  const minDob = dobs[0];
  const maxDob = dobs[dobs.length - 1];
  const poolIdSet = new Set(poolIds);

  const inRangeAll: { id: number; date_of_birth: string; draft_eligible: boolean; retired: boolean; free_agent: boolean; organization_id: number | null }[] = [];
  {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase.from("players")
        .select("id, date_of_birth, draft_eligible, retired, free_agent, organization_id")
        .gte("date_of_birth", minDob).lte("date_of_birth", maxDob)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      inRangeAll.push(...(data as never[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  const inRangeButNotInPool = inRangeAll.filter((p) => !poolIdSet.has(p.id));
  console.log(`Players with DOB in that exact range but NOT in the 2031 pool: ${inRangeButNotInPool.length}`);
  console.log("Sample of those (first 10):", inRangeButNotInPool.slice(0, 10));

  const inPoolButOutsideEligible = inPool.filter((p) => p.draft_eligible !== true);
  console.log("Pool members where draft_eligible isn't exactly true:", inPoolButOutsideEligible.length, inPoolButOutsideEligible.slice(0, 5));

  async function fetchAllRows<T>(build: (from: number, to: number) => ReturnType<typeof supabase.from>): Promise<T[]> {
    const all: T[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await (build(from, from + PAGE - 1) as never as Promise<{ data: T[] | null; error: unknown }>);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  // Hypothesis: the real pool = draft_eligible AND unrostered (organization_id null) AND free_agent.
  // Test this against the WHOLE player table, no date restriction. PAGINATED — Supabase
  // caps a single select at 1000 rows, which silently truncated the first pass of this script.
  const hypoSet = await fetchAllRows<{ id: number; date_of_birth: string; organization_id: null; free_agent: true; retired: boolean }>(
    (from, to) => supabase.from("players")
      .select("id, date_of_birth, organization_id, free_agent, retired")
      .eq("draft_eligible", true).eq("free_agent", true).is("organization_id", null)
      .range(from, to)
  );
  console.log(`\nHypothesis (draft_eligible + free_agent + no org, no date filter): ${hypoSet.length} players`);

  const hypoIds = new Set(hypoSet.map((p) => p.id));
  const inPoolNotHypo = poolIds.filter((id) => !hypoIds.has(id));
  const hypoNotInPool = hypoSet.filter((p) => !poolIdSet.has(p.id));
  console.log(`Pool members NOT matching hypothesis: ${inPoolNotHypo.length}`, inPoolNotHypo.slice(0, 10));
  console.log(`Hypothesis matches NOT in the real pool: ${hypoNotInPool.length}`);
  console.log(hypoNotInPool.slice(0, 10));

  // Check: are the "pool members not matching hypothesis" simply missing from our
  // players table entirely, or present with unexpected free_agent/org values?
  const missingCheck = await supabase.from("players").select("id, organization_id, free_agent, draft_eligible, date_of_birth").in("id", inPoolNotHypo.slice(0, 20));
  console.log("\nWhat our players table actually has for the first 20 pool-not-hypothesis IDs:", missingCheck.data);

  // Combined hypothesis: free_agent + no org + draft_eligible + DOB in the pool's exact range
  const combo = await fetchAllRows<{ id: number }>(
    (from, to) => supabase.from("players").select("id")
      .eq("draft_eligible", true).eq("free_agent", true).is("organization_id", null)
      .gte("date_of_birth", minDob).lte("date_of_birth", maxDob)
      .range(from, to)
  );
  const comboIds = new Set(combo.map((p) => p.id));
  console.log(`\nCombined hypothesis (+ DOB in pool's exact range): ${comboIds.size} players`);
  const comboMismatch = poolIds.filter((id) => !comboIds.has(id));
  console.log(`Pool members not matching combined hypothesis: ${comboMismatch.length}`, comboMismatch.slice(0, 15));
  const comboExtra = [...comboIds].filter((id) => !poolIdSet.has(id));
  console.log(`Combined-hypothesis matches not in real pool: ${comboExtra.length}`, comboExtra.slice(0, 15));
}

main().catch((e) => { console.error(e); process.exit(1); });
