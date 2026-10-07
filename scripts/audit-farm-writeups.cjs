// Mechanical audit of a Farm Rankings write-up batch against its fact sheet (2026-10-07). The separate audit pass the style guide
// requires (farm-rankings-writeup-style-guide.md section 5, step 3) -- it catches wrong name<->rank pairs, stat lines / ERAs / innings / ages /
// draft picks that belong to a different player, Top 100 / top-200 / readiness counts, position and level labels that contradict the sheet,
// stray grade numbers (NN/NN, mph), doubled words and word counts outside 80-140. It is deliberately conservative: a few findings are false
// positives (e.g. "reliever" describing the NEXT named player, "majors" describing a group) -- read each one. Superlatives (largest / steepest /
// only / tied) and movement still need a human check against the sheet; pass --table to print each org's sheet movement + counts for that.
//   node scripts/audit-farm-writeups.cjs <fact-sheet.md> <farm-writeups/file.json> [--table]
const fs = require("fs");
const [, , factsPath, jsonPath] = process.argv;
const facts = fs.readFileSync(factsPath, "utf8").split(/\r?\n/);
const writeups = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

// ---- parse the fact sheet ----
const orgs = {};
let cur = null;
for (const line of facts) {
  let m;
  if ((m = line.match(/^## #(\d+) (.+?)  \[team_id\/org (\d+)\]/))) {
    cur = { id: m[3], rank: +m[1], name: m[2], prospects: [] }; orgs[cur.id] = cur; continue;
  }
  if (!cur) continue;
  if ((m = line.match(/^- Movement: (.+?)\. Sub-ranks: batting #(\d+), pitching #(\d+), readiness #(\d+)\. Blue-Chip (.+?), Depth (.+?), Balance (.+?)\.$/))) {
    cur.movement = m[1]; cur.bat = +m[2]; cur.pit = +m[3]; cur.ready = +m[4]; cur.blue = m[5]; cur.depth = m[6]; cur.balance = m[7]; continue;
  }
  if ((m = line.match(/^- MLB club: .*? Prospects in leaguewide top 100: (\d+); top 200: (\d+)\./))) { cur.top100 = +m[1]; cur.top200 = +m[2]; continue; }
  if ((m = line.match(/^- Top-200 prospects: (\d+) \((\d+) hitters \/ (\d+) pitchers\); (\d+) from the/))) { cur.nH = +m[2]; cur.nP = +m[3]; cur.draftees = +m[4]; continue; }
  if ((m = line.match(/^\s+- #(\d+) (.+?), (\w+), age (\d+), ETA (\S+?); (.+?)\. Tools: (.*)$/))) {
    const rest = m[7];
    const dm = m[6].match(/drafted by (.+?) in (\d+) \(round (\d+), pick (\d+)\)/);
    const stat = rest.match(/(\d{4}): (\.\d{3}|1\.\d{3})\/(\.\d{3}|1\.\d{3})\/(\.\d{3}|1\.\d{3}), (\d+) HR in (\d+) AB/);
    const pstat = rest.match(/(\d{4}): (\d+\.\d\d) ERA, (\d+\.\d) K\/9, (\d+\.\d) BB\/9 in (\d+)\.(\d) IP/);
    const lvl = rest.match(/\(currently at (.+?)\)\s*$/);
    cur.prospects.push({
      rank: +m[1], name: m[2], role: m[3], age: +m[4],
      draft: dm ? { team: dm[1], round: +dm[3], pick: +dm[4] } : null,
      slash: stat ? `${stat[2]}/${stat[3]}/${stat[4]}` : null, hr: stat ? +stat[5] : null, ab: stat ? +stat[6] : null,
      era: pstat ? pstat[2] : null, k9: pstat ? pstat[3] : null, bb9: pstat ? pstat[4] : null, ip: pstat ? { w: +pstat[5], t: +pstat[6] } : null,
      level: lvl ? lvl[1] : null, tools: rest,
    });
  }
}

const problems = [];
const warn = (org, msg) => problems.push(`[${org.name} #${org.rank}] ${msg}`);
const ids = Object.keys(writeups).filter((k) => !k.startsWith("_"));
const sheetIds = Object.keys(orgs);
if (ids.length !== sheetIds.length || sheetIds.some((i) => !ids.includes(i))) problems.push(`KEY MISMATCH: json ${ids.length} keys vs sheet ${sheetIds.length}; missing: ${sheetIds.filter((i) => !ids.includes(i))}; extra: ${ids.filter((i) => !sheetIds.includes(i))}`);

const numWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const ordinal = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const toN = (w) => (/^\d+$/.test(w) ? +w : numWords[w.toLowerCase()]);
const surname = (n) => n.replace(/ Jr\.$/, "").split(" ").pop();

for (const id of ids) {
  const org = orgs[id]; if (!org) continue;
  const t = writeups[id];
  const words = t.split(/\s+/).length;
  if (words < 80 || words > 140) warn(org, `word count ${words} (want 80-140)`);

  // name <-> rank pairs
  const rankSet = new Map(org.prospects.map((p) => [p.rank, p]));
  const named = []; // {pos, p}
  for (const m of t.matchAll(/\(No\. (\d+)\)/g)) {
    const p = rankSet.get(+m[1]);
    if (!p) { warn(org, `(No. ${m[1]}) is not one of this org's listed prospects`); continue; }
    if (!t.includes(`${p.name} (No. ${p.rank})`)) warn(org, `(No. ${p.rank}) is not attached to ${p.name}`);
    named.push({ pos: m.index, p });
  }
  // every prospect named by full name should carry its rank; and no prospect named without a sheet entry (best effort: capitalised pairs before "(No.")
  const nearestBefore = (pos) => { let best = null; for (const n of named) if (n.pos <= pos && (!best || n.pos > best.pos)) best = n; return best && best.p; };

  // slash lines
  for (const m of t.matchAll(/(\.\d{3}\/\.\d{3}\/\.\d{3})/g)) {
    const owner = org.prospects.find((p) => p.slash === m[1]);
    if (!owner) { warn(org, `slash line ${m[1]} not in this org's sheet`); continue; }
    const near = nearestBefore(m.index);
    if (!near || near.rank !== owner.rank) warn(org, `slash line ${m[1]} belongs to ${owner.name} but the nearest preceding named player is ${near ? near.name : "none"}`);
  }
  // batting average alone, e.g. "hit .373 with 15 homers in 158 at-bats", "a .223 average", "hit .221", "hit just .204 in 152"
  for (const m of t.matchAll(/(?<![\/\d])(\.\d{3})(?![\/\d])/g)) {
    const near = nearestBefore(m.index);
    const candidates = org.prospects.filter((p) => p.slash && p.slash.startsWith(m[1] + "/"));
    if (!candidates.length) { warn(org, `average ${m[1]} not found as the AVG of any listed prospect`); continue; }
    if (!near || !candidates.some((c) => c.rank === near.rank)) warn(org, `average ${m[1]} ... nearest named player ${near ? near.name : "none"} is not its owner (${candidates.map((c) => c.name)})`);
  }
  // ERA / K9 / BB9
  for (const m of t.matchAll(/(\d+\.\d\d) ERA/g)) {
    const owner = org.prospects.find((p) => p.era === m[1]);
    const near = nearestBefore(m.index);
    if (!owner) warn(org, `ERA ${m[1]} not in this org's sheet`);
    else if (!near || near.rank !== owner.rank) warn(org, `ERA ${m[1]} is ${owner.name}'s, nearest preceding named is ${near ? near.name : "none"}`);
  }
  for (const m of t.matchAll(/(\d+\.\d) (?:strikeouts per nine|per nine)/g)) {
    const near = nearestBefore(m.index);
    const ownerK = org.prospects.find((p) => p.k9 === m[1]);
    const ownerB = org.prospects.find((p) => p.bb9 === m[1]);
    const ok = near && ((near.k9 === m[1]) || (near.bb9 === m[1]));
    if (!ok) warn(org, `per-nine figure ${m[1]} does not match the nearest preceding named player (${near ? near.name : "none"}); k9 owner ${ownerK && ownerK.name}, bb9 owner ${ownerB && ownerB.name}`);
  }
  for (const m of t.matchAll(/(\d+\.\d) walks per nine/g)) {
    const near = nearestBefore(m.index);
    if (!near || near.bb9 !== m[1]) warn(org, `walks-per-nine ${m[1]} vs nearest player ${near ? near.name : "none"} (sheet BB/9 ${near && near.bb9})`);
  }
  // innings in baseball fractions
  for (const m of t.matchAll(/(\d+)(?: ([12])\/3)? innings/g)) {
    const near = nearestBefore(m.index);
    const w = +m[1], tt = m[2] ? +m[2] : 0;
    if (!near || !near.ip || near.ip.w !== w || near.ip.t !== tt) warn(org, `innings "${m[0]}" vs nearest player ${near ? near.name : "none"} (sheet ${near && near.ip ? near.ip.w + "." + near.ip.t : "n/a"})`);
  }
  // "N innings" without "innings" word e.g. "63 innings" is covered; HR counts
  for (const m of t.matchAll(/(\d+) (?:home runs|homers)/g)) {
    const near = nearestBefore(m.index);
    if (!near || near.hr !== +m[1]) warn(org, `HR count ${m[1]} vs nearest player ${near ? near.name : "none"} (sheet HR ${near && near.hr})`);
  }
  for (const m of t.matchAll(/(?:with|hit|added|and) (?:eight|nine|ten) homers/g)) {
    const near = nearestBefore(m.index); const n = toN(m[0].split(" ")[m[0].split(" ").length - 2]);
    if (!near || near.hr !== n) warn(org, `HR count word "${m[0]}" vs nearest ${near ? near.name : "none"} (sheet ${near && near.hr})`);
  }
  for (const m of t.matchAll(/in (\d+) at-bats/g)) {
    const near = nearestBefore(m.index);
    if (!near || near.ab !== +m[1]) warn(org, `AB ${m[1]} vs nearest ${near ? near.name : "none"} (sheet AB ${near && near.ab})`);
  }
  // ages
  for (const m of t.matchAll(/(\d+)-year-old/g)) {
    const near = nearestBefore(m.index);
    // age phrase may precede the name (e.g. "a 22-year-old outfielder at Double-A with plus power, hit"): take nearest preceding; fall back to following within 120 chars
    let p = near;
    if (!p || p.age !== +m[1]) {
      const following = named.filter((n) => n.pos > m.index && n.pos - m.index < 160).map((n) => n.p);
      if (following.some((f) => f.age === +m[1])) p = following.find((f) => f.age === +m[1]);
    }
    if (!p || p.age !== +m[1]) warn(org, `age ${m[1]}-year-old vs nearest named ${near ? near.name + " (" + near.age + ")" : "none"}`);
  }
  // draft picks / rounds
  for (const m of t.matchAll(/the (\w+) overall pick/g)) {
    const w = m[1].toLowerCase(); const map = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
    let n = map[w] ?? parseInt(w, 10);
    const near = nearestBefore(m.index);
    if (!near || !near.draft || near.draft.pick !== n) warn(org, `draft claim "${m[0]}" vs nearest ${near ? near.name : "none"} (sheet pick ${near && near.draft ? near.draft.pick : "n/a"})`);
  }
  for (const m of t.matchAll(/an? (\w+)-round pick|a (\w+)-round pick|(\w+)-round pick/g)) {
    const w = (m[1] || m[2] || m[3]).toLowerCase(); const map = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
    const near = nearestBefore(m.index);
    if (!near || !near.draft || near.draft.round !== map[w]) warn(org, `round claim "${m[0]}" vs nearest ${near ? near.name : "none"} (sheet round ${near && near.draft ? near.draft.round : "n/a"})`);
  }
  for (const m of t.matchAll(/(\d+)(?:st|nd|rd|th) overall pick/g)) {
    const near = nearestBefore(m.index);
    if (!near || !near.draft || near.draft.pick !== +m[1]) warn(org, `draft claim "${m[0]}" vs nearest ${near ? near.name : "none"} (sheet pick ${near && near.draft ? near.draft.pick : "n/a"})`);
  }
  // "drafted"/"draftee" must be backed by draft data
  for (const m of t.matchAll(/draftees? ([A-Z][\w.' ]+?) \(No\. (\d+)\)/g)) { /* checked by name<->rank */ }

  // positions vs role
  const posMap = [
    [/\bcatcher\b/, ["C"]], [/\bshortstop\b/, ["SS"]], [/\bcenter fielder\b/, ["CF"]], [/\bdesignated hitter\b/, ["DH"]],
    [/\binfielder\b/, ["INF", "SS", "1B"]], [/\boutfielder\b/, ["COF", "CF"]], [/\bstarter\b/, ["SP"]], [/\breliever\b|\bbullpen\b/, ["RP"]],
  ];
  for (const n of named) {
    const seg = t.slice(n.pos, n.pos + 110);
    const stop = seg.search(/\(No\./g); // only look until next named player
    const next = [...seg.matchAll(/\(No\. \d+\)/g)];
    const lim = next.length > 1 ? next[1].index : seg.length;
    const sub = seg.slice(0, lim);
    for (const [re, roles] of posMap) {
      if (re.test(sub) && !roles.includes(n.p.role)) warn(org, `${n.p.name} (role ${n.p.role}) described with "${sub.match(re)[0]}"`);
    }
  }

  // level labels: tokens between a named player and the next named player must match the sheet's 'currently at'
  const lvlWord = { AAA: 'Triple-A', AA: 'Double-A', 'A+': 'A+', A: 'A', 'A-': 'A-', Rookie: 'Rookie ball', International: 'the international complex', MLB: 'big leagues' };
  const sorted = named.slice().sort((a, b) => a.pos - b.pos);
  sorted.forEach((n, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].pos : t.length;
    const seg = t.slice(n.pos, end);
    const want = lvlWord[n.p.level] || n.p.level;
    const found = [];
    for (const m of seg.matchAll(/(Triple-A|Double-A|\bA\+|\bA-|Rookie ball|international complex|big leagues|majors)|\bat A(?![-+\w])/g)) found.push(m[0] === 'at A' ? 'A' : m[0].replace('international complex','the international complex').replace('majors','big leagues'));
    for (const f of found) if (f !== want) warn(org, n.p.name + ' is currently at ' + want + ' but the text near him says ' + f);
  });

  // counts: Top 100 / top-200 mentions
  const wordRe = "(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+)";
  for (const m of t.matchAll(new RegExp(`\\b${wordRe} (?:of (?:its|them) )?(?:in the )?Top 100`, "gi"))) { const n = toN(m[1]); if (n !== org.top100) warn(org, `"${m[0]}" vs sheet top100=${org.top100}`); }
  for (const m of t.matchAll(new RegExp(`\\b${wordRe} Top 100`, "gi"))) { const n = toN(m[1]); if (n !== org.top100) warn(org, `"${m[0]}" vs sheet top100=${org.top100}`); }
  for (const m of t.matchAll(new RegExp(`\\b${wordRe} top-200 (?:prospects|names)`, "gi"))) { const n = toN(m[1]); if (n !== org.top200 && !(/^eight of its nine/.test(t.slice(m.index - 16, m.index + 20)))) warn(org, `"${m[0]}" vs sheet top200=${org.top200}`); }
  for (const m of t.matchAll(/(\w+) of its (\w+) top-200 (?:prospects|names)/g)) {
    const a = toN(m[1]), b = toN(m[2]);
    if (b !== org.top200) warn(org, `"${m[0]}" total vs sheet top200=${org.top200}`);
    if (a !== org.nH && a !== org.nP) warn(org, `"${m[0]}" part ${a} vs sheet hitters/pitchers ${org.nH}/${org.nP}`);
  }
  // sub-rank ordinals: "<ordinal>-ranked/best/ranked <ordinal>"
  for (const m of t.matchAll(/(\w+)-ranked readiness|(\w+)-best readiness|readiness (?:mark )?(?:ranks|ranked) (\d+)(?:st|nd|rd|th)|(\w+)-place readiness|best readiness/g)) {
    const raw = (m[1] || m[2] || m[4] || (m[3] ? m[3] : "best")).toLowerCase();
    const n = ordinal[raw] ?? (m[3] ? +m[3] : raw === "best" ? 1 : null);
    if (n !== org.ready) warn(org, `readiness claim "${m[0]}" vs sheet readiness #${org.ready}`);
  }

  // forbidden: numeric grades, velocities
  if (/\b\d{2}\/\d{2}\b/.test(t)) warn(org, "contains a NN/NN pattern (grade pair?)");
  if (/\bmph\b/i.test(t)) warn(org, "mentions mph");
  if (/\b(?:20-80|grade of \d|\b[2-8]0 (?:hit|power|speed|grade))\b/i.test(t)) warn(org, "numeric grade language");
  // doubled words
  for (const m of t.matchAll(/\b(\w+) \1\b/gi)) if (!/^(that|had)$/i.test(m[1])) warn(org, `doubled word "${m[0]}"`);
  // movement & rank sentence: print for manual review
}

// ---- manual-review tables ----
console.log(`orgs parsed: ${sheetIds.length}; write-ups: ${ids.length}`);
if (problems.length === 0) console.log("MECHANICAL CHECKS: no problems found");
else { console.log(`MECHANICAL CHECKS: ${problems.length} finding(s)`); problems.forEach((p) => console.log("  - " + p)); }
if (process.argv.includes("--table")) {
  for (const id of ids) {
    const o = orgs[id];
    const first = writeups[id].split(/(?<=\.)\s/)[0];
    console.log(`\n#${o.rank} ${o.name} | ${o.movement} | bat #${o.bat} pit #${o.pit} ready #${o.ready} | ${o.blue}/${o.depth}/${o.balance} | top100 ${o.top100} top200 ${o.top200} (${o.nH}H/${o.nP}P) draftees ${o.draftees}\n   > ${first}`);
  }
}
