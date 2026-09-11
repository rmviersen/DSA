import * as fs from "node:fs";
import * as path from "node:path";

// Generic reader for OOTP's "Configure SQL dump for MySQL" export format
// (multi-league architecture plan, §1/§3; Step 5, 2026-09-11). Each table
// gets its own file named `<table>.mysql.sql`, containing:
//   # comment header (game name, game date, build number)
//   DROP TABLE IF EXISTS `<Prefix><table>`;
//   CREATE TABLE IF NOT EXISTS `<Prefix><table>` (`col1` TYPE, `col2` TYPE, ..., PRIMARY KEY (...));
//   insert ignore into `<Prefix><table>` (`col1`, `col2`, ...) VALUES (...), (...), ...;
//   [repeated insert ignore blocks for large tables]
//
// `<Prefix>` is the league's own in-game name (e.g. "Duud"), not a fixed
// string -- confirmed by inspecting a real dump. This reader never needs to
// know or guess that prefix: since each file holds exactly one table, it
// just reads whatever CREATE TABLE / insert statements are actually in the
// file, regardless of what the table happens to be named inside it.
//
// Real format details confirmed against an actual dump before writing this
// (see multi-league-architecture-plan.md, Step 5 research notes):
// - Encoding is UTF-8, CRLF line endings.
// - String values are double-quoted (`"..."`), not single-quoted -- this
//   means a name like O'Brien needs no escaping for the apostrophe itself,
//   but a literal `"` or `\` inside a string IS backslash-escaped (`\"`,
//   `\\`), confirmed via a real occurrence in messages.mysql.sql. Standard
//   MySQL string escapes (`\'`, `\"`, `\\`, `\n`, `\r`, `\t`, `\0`, `\b`,
//   `\Z`) are all handled; any other `\X` sequence just drops the backslash
//   (matching MySQL's own real behavior for an unrecognized escape).
// - `NULL` appears as a bare, unquoted keyword.
// - A single table's rows can be split across several `insert ignore into`
//   statements in the same file (confirmed: players.mysql.sql alone has
//   over 200 such statements) -- every one is read and concatenated.
//
// Known, deliberate limitation: the tuple-boundary scan below is
// quote-aware (a `)` or `,` inside a quoted string never ends a value or a
// row), but the statement-boundary scan that finds each `insert ... VALUES
// (...);` block stops at the first bare `;`, which is NOT quote-aware. This
// is safe for every table this importer actually reads (players, teams,
// contracts, stats, ratings -- all short numeric/date/name fields, no free
// text), but would break on a table with a free-text field containing a
// literal semicolon (e.g. messages, trade_history) -- neither of which is
// read by this importer.

export type DumpRow = Record<string, string>;

/** Splits the inside of a CREATE TABLE's outer parens on top-level commas
 * only -- a naive comma-split would incorrectly break on the comma inside
 * `VARCHAR(50)` or `PRIMARY KEY (\`a\`, \`b\`)`. No quote-awareness needed
 * here: column definitions never contain quoted strings. */
function splitTopLevelByParenDepth(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const c of s) {
    if (c === "(") { depth++; buf += c; continue; }
    if (c === ")") { depth--; buf += c; continue; }
    if (c === "," && depth === 0) { parts.push(buf.trim()); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Extracts the ordered column names from a `CREATE TABLE ... (...)` line,
 * dropping any trailing PRIMARY KEY/KEY/UNIQUE/CONSTRAINT clause. */
export function parseCreateTableColumns(createTableLine: string): string[] {
  const start = createTableLine.indexOf("(");
  if (start === -1) throw new Error("No opening paren found in CREATE TABLE line");
  let depth = 0;
  let end = -1;
  for (let i = start; i < createTableLine.length; i++) {
    if (createTableLine[i] === "(") depth++;
    else if (createTableLine[i] === ")") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error("No matching closing paren found in CREATE TABLE line");
  const inner = createTableLine.slice(start + 1, end);
  const segments = splitTopLevelByParenDepth(inner);
  const columns: string[] = [];
  for (const seg of segments) {
    if (/^(PRIMARY\s+KEY|KEY|UNIQUE|CONSTRAINT|INDEX)\b/i.test(seg)) continue;
    const m = seg.match(/^`([^`]+)`/);
    if (m) columns.push(m[1]);
  }
  return columns;
}

const ESCAPE_MAP: Record<string, string> = {
  "'": "'", '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t", "0": "\0", b: "\b", Z: "\x1a",
};

/** Parses a `(...), (...), ...` VALUES section into an array of row tuples
 * (each an array of raw field strings, in column order). Quote-aware: a `,`
 * or `)` inside a double-quoted string is just a character, not a
 * delimiter. Trims whitespace around unquoted (numeric/NULL) fields only --
 * a quoted string's content is preserved exactly as written. `NULL`
 * (unquoted) becomes `""`, matching the same null-sentinel convention the
 * existing StatsPlus mappers already use for blank CSV fields. */
export function parseValueTuples(valuesSection: string): string[][] {
  const tuples: string[][] = [];
  const n = valuesSection.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(valuesSection[i])) i++;
    if (i >= n) break;
    if (valuesSection[i] !== "(") { i++; continue; }
    i++; // consume '('
    const fields: string[] = [];
    let buf = "";
    let inQuote = false;
    let wasQuoted = false;
    while (i < n) {
      const c = valuesSection[i];
      // Skip whitespace between a `,`/`(` and the start of the next field
      // (e.g. the space in `, "Africa"`) -- must happen before the quote
      // check below, or that leading space ends up inside `buf` and
      // survives into a quoted field's value (trim() only helps unquoted
      // fields; a quoted field's content is deliberately preserved as-is).
      if (!inQuote && buf === "" && /\s/.test(c)) { i++; continue; }
      if (inQuote) {
        if (c === "\\" && i + 1 < n) {
          const next = valuesSection[i + 1];
          buf += ESCAPE_MAP[next] !== undefined ? ESCAPE_MAP[next] : next;
          i += 2;
          continue;
        }
        if (c === '"') { inQuote = false; i++; continue; }
        buf += c;
        i++;
        continue;
      }
      if (c === '"') { inQuote = true; wasQuoted = true; i++; continue; }
      if (c === ",") { fields.push(wasQuoted ? buf : buf.trim()); buf = ""; wasQuoted = false; i++; continue; }
      if (c === ")") { fields.push(wasQuoted ? buf : buf.trim()); i++; break; }
      buf += c;
      i++;
    }
    tuples.push(fields.map((f) => (f === "NULL" ? "" : f)));
  }
  return tuples;
}

const insertBlockRegex = /insert\s+ignore\s+into\s+`[^`]+`\s*\([^)]*\)\s*VALUES\s+([\s\S]*?);/gi;

/** Reads one dump table file (`<dumpDir>/<logicalName>.mysql.sql`) and
 * returns its rows as plain string-keyed objects, one per data row, in the
 * same shape the existing StatsPlus mappers already expect (a CSV-like
 * `Record<string,string>` row) so the same `int()/num()/bool()/str()/date()`
 * coercion helpers can be reused unchanged. */
export function readDumpTable(dumpDir: string, logicalName: string): { columns: string[]; rows: DumpRow[] } {
  const filePath = path.join(dumpDir, `${logicalName}.mysql.sql`);
  const content = fs.readFileSync(filePath, "utf8");
  const createMatch = content.match(/CREATE TABLE[^\r\n]*/i);
  if (!createMatch) throw new Error(`No CREATE TABLE statement found in ${filePath}`);
  const columns = parseCreateTableColumns(createMatch[0]);

  const rows: DumpRow[] = [];
  let m: RegExpExecArray | null;
  insertBlockRegex.lastIndex = 0;
  while ((m = insertBlockRegex.exec(content))) {
    const tuples = parseValueTuples(m[1]);
    for (const tuple of tuples) {
      const row: DumpRow = {};
      columns.forEach((col, idx) => { row[col] = tuple[idx] ?? ""; });
      rows.push(row);
    }
  }
  return { columns, rows };
}
