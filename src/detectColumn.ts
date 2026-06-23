import { isFullUrl, typeFromExtension } from './url';

export interface Table {
  header: string[];
  rows: string[][];
}

type ColumnLookup = { ok: true; index: number } | { ok: false; reason: 'range' | 'name' };

// Resolve a header name (case-insensitive, trimmed) or a 1-based index to a 0-based index.
function lookupColumn(table: Table, ref: string): ColumnLookup {
  const r = ref.trim();
  if (r === '') return { ok: false, reason: 'name' };
  const asNum = Number(r);
  if (Number.isInteger(asNum)) {
    const index = asNum - 1; // 1-based
    if (index < 0 || index >= table.header.length) return { ok: false, reason: 'range' };
    return { ok: true, index };
  }
  const index = table.header.findIndex((h) => h.trim().toLowerCase() === r.toLowerCase());
  return index === -1 ? { ok: false, reason: 'name' } : { ok: true, index };
}

// Name-or-index resolution that returns undefined when the column isn't present
// (unknown name, out-of-range index, or blank ref). Used for the optional default
// filter column, where absence falls back to counting every row rather than erroring.
export function findColumn(table: Table, ref: string): number | undefined {
  const r = lookupColumn(table, ref);
  return r.ok ? r.index : undefined;
}

// Name-or-index resolution that throws a flag-aware error when the column isn't present.
// Used for explicit overrides (`--column`, an explicit `--filter-column`).
export function resolveColumn(table: Table, ref: string, flagName: string): number {
  const r = lookupColumn(table, ref);
  if (r.ok) return r.index;
  if (r.reason === 'range') {
    throw new Error(`${flagName} index ${ref} is out of range (1..${table.header.length})`);
  }
  throw new Error(`${flagName} "${ref}" not found in header`);
}

export function detectUrlColumn(table: Table, override?: string): number {
  if (override !== undefined && override !== '') {
    return resolveColumn(table, override, '--column');
  }

  // Score each column two ways: by how many non-empty cells link to an actual
  // document (a .pdf/.docx/.pptx URL), and by how many are any http(s) URL.
  // Prefer the column that points at real files (e.g. a "File URL" column) over
  // one that merely holds page links (e.g. a "Page URL" column). Fall back to
  // the any-URL score when no column links to documents (e.g. extensionless
  // download URLs); `--column` overrides either way.
  let bestDoc = -1;
  let bestDocRatio = 0;
  let bestUrl = -1;
  let bestUrlRatio = 0;
  for (let c = 0; c < table.header.length; c++) {
    let nonEmpty = 0;
    let urls = 0;
    let docs = 0;
    for (const row of table.rows) {
      const cell = (row[c] ?? '').trim();
      if (!cell) continue;
      nonEmpty++;
      if (isFullUrl(cell)) {
        urls++;
        if (typeFromExtension(cell) !== null) docs++;
      }
    }
    if (nonEmpty === 0) continue;
    const docRatio = docs / nonEmpty;
    const urlRatio = urls / nonEmpty;
    if (docRatio > bestDocRatio) {
      bestDocRatio = docRatio;
      bestDoc = c;
    }
    if (urlRatio > bestUrlRatio) {
      bestUrlRatio = urlRatio;
      bestUrl = c;
    }
  }

  if (bestDoc !== -1 && bestDocRatio >= 0.5) return bestDoc;
  if (bestUrl !== -1 && bestUrlRatio >= 0.5) return bestUrl;
  throw new Error('Could not find a URL column; specify one with --column');
}
