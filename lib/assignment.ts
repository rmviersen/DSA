// Small, generic weighted-bipartite-assignment solver (2026-09-10, built for
// /lineup's optimizer -- Rees's ask: "optimize my lineup," not just "list the
// best bat at each position independently"). A greedy per-position pick would
// get this wrong the moment one real bat is the top choice at more than one
// spot (a common case -- a 1B/3B masher, a CF who also grades out in a corner)
// : greedily giving him to whichever position is considered first can leave a
// worse total lineup than moving him to his second-best spot and letting a
// different player take his first. This solves for the assignment that
// maximizes total lineup value across ALL positions at once, guaranteeing no
// player is used twice.
//
// Deliberately NOT the general Hungarian algorithm -- this only ever needs to
// handle a handful of fixed lineup SLOTS (9: eight fielding positions + DH),
// with many more CANDIDATES than slots. That asymmetry makes a bitmask DP
// over "which slots are filled" both simpler to get right and plenty fast:
// with S slots there are only 2^S subsets, so this runs in
// O(candidates * 2^S * S) time -- for S=9 (512 subsets) and a few dozen
// candidates, a few hundred thousand operations, well under a millisecond.
//
// `values[i][p]` is candidate i's score at slot p, or null if candidate i is
// NOT eligible for slot p at all (never assigned there, regardless of score).
// Returns, for each slot, the index into `values` of the candidate assigned
// there, or null if no eligible candidate could fill it (should only happen
// if a slot has zero eligible candidates in the whole pool).
export function optimalAssignment(numSlots: number, values: (number | null)[][]): (number | null)[] {
  const FULL = 1 << numSlots;
  // dp[mask] = best total value achievable with slots in `mask` filled,
  // using some subset of the candidates considered so far. -Infinity means
  // "not achievable yet."
  let dp = new Array<number>(FULL).fill(-Infinity);
  dp[0] = 0;
  // choice[i][mask]: -2 means "candidate i wasn't used to fill this mask"
  // (carry dp[mask] forward from before candidate i); a real slot index p
  // means "candidate i was assigned to slot p to reach this mask."
  const choice: Int8Array[] = [];

  for (let i = 0; i < values.length; i++) {
    const prev = dp;
    const cur = prev.slice();
    const thisChoice = new Int8Array(FULL).fill(-2);
    for (let mask = 0; mask < FULL; mask++) {
      for (let p = 0; p < numSlots; p++) {
        if (!(mask & (1 << p))) continue; // this transition only fills slot p
        const v = values[i][p];
        if (v === null) continue; // candidate i isn't eligible for slot p
        const prevMask = mask & ~(1 << p);
        if (prev[prevMask] === -Infinity) continue;
        const total = prev[prevMask] + v;
        if (total > cur[mask]) {
          cur[mask] = total;
          thisChoice[mask] = p;
        }
      }
    }
    dp = cur;
    choice.push(thisChoice);
  }

  // Prefer filling every slot if at all possible, but degrade gracefully
  // (fewest empty slots, then highest value) if the real pool can't fill
  // all of them -- e.g. a real roster with fewer than 9 healthy hitters.
  // Not expected in normal use (a real active roster always has enough
  // eligible hitters, DH has no eligibility gate at all), but a silent
  // crash on a thin/injury-depleted roster would be worse than a partial
  // lineup with some slots left null.
  let bestMask = FULL - 1;
  if (dp[bestMask] === -Infinity) {
    for (let mask = 0; mask < FULL; mask++) {
      if (dp[mask] === -Infinity) continue;
      const filled = popcount(mask);
      const bestFilled = popcount(bestMask);
      if (dp[bestMask] === -Infinity || filled > bestFilled || (filled === bestFilled && dp[mask] > dp[bestMask])) {
        bestMask = mask;
      }
    }
  }

  const assignment: (number | null)[] = new Array(numSlots).fill(null);
  let mask = bestMask;
  for (let i = values.length - 1; i >= 0; i--) {
    const c = choice[i][mask];
    if (c !== -2) {
      assignment[c] = i;
      mask = mask & ~(1 << c);
    }
  }
  return assignment;
}

function popcount(n: number): number {
  let count = 0;
  while (n > 0) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}
