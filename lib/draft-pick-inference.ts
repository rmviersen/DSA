// Round-1 draft pick inference (2026-10-14/15, Rees: "you should easily be able to trace a player's original team that selected him").
//
// What the data DOES say: every drafted player has the team that made the selection (players.draft_team_id -- the pick's final
// holder, e.g. Gary Huber "selected by the San Diego Seals"). What it does NOT say: which ORIGINAL owner's pick that was, when the
// holder used several round-1 picks (San Diego made three in 2013: #12, #19, #23, one of which came from Las Vegas). StatsPlus's
// player page, draft page and trade ledger don't record the slot of a traded pick either (checked 2026-10-15).
//
// What we can do: round 1 is a lottery, but a team's round-1 slot stays close to its later-round slot (the draft order every OTHER
// round) -- measured on teams that kept their own pick (2012-2032): slot shift sd ~4.5. So among the picks one holder made, owners
// with a late later-round slot most probably took the later round-1 slots. This returns, for each owner, the probability that he took
// each slot, over every possible assignment of the group's owners to its slots. Pure, no imports; unit-testable.

export const R1_SHIFT_SD = 4.7;
const MAX_GROUP = 6; // 6! = 720 assignments; bigger groups fall back to "one of N" without probabilities

/**
 * @param ownerModal later-round ("modal") slot of each owner in the group; null when unknown (that owner is then uninformative)
 * @param slots      the round-1 slots the holder actually drafted at (same count as owners)
 * @returns probs[i][j] = P(owner i drafted at slots[j]); null when the group is too big or the sizes don't match
 */
export function assignmentProbabilities(ownerModal: (number | null)[], slots: number[], sd = R1_SHIFT_SD): number[][] | null {
  const n = ownerModal.length;
  if (n === 0 || n !== slots.length || n > MAX_GROUP) return null;
  const logw = (owner: number, slot: number): number => {
    const m = ownerModal[owner];
    return m === null ? 0 : -((slots[slot] - m) ** 2) / (2 * sd * sd);
  };
  const perm: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const acc: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let total = 0;
  const walk = (owner: number, lw: number) => {
    if (owner === n) {
      const w = Math.exp(lw);
      total += w;
      for (let o = 0; o < n; o++) acc[o][perm[o]] += w;
      return;
    }
    for (let s = 0; s < n; s++) {
      if (used[s]) continue;
      used[s] = true;
      perm[owner] = s;
      walk(owner + 1, lw + logw(owner, s));
      used[s] = false;
    }
  };
  walk(0, 0);
  return acc.map((row) => row.map((w) => (total > 0 ? w / total : 1 / n)));
}
