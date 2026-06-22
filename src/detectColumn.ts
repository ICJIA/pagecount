import { isFullUrl } from './url';

export interface Table {
  header: string[];
  rows: string[][];
}

export function detectUrlColumn(table: Table, override?: string): number {
  if (override !== undefined && override !== '') {
    const asNum = Number(override);
    if (Number.isInteger(asNum)) {
      const idx = asNum - 1; // 1-based
      if (idx < 0 || idx >= table.header.length) {
        throw new Error(`--column index ${override} is out of range (1..${table.header.length})`);
      }
      return idx;
    }
    const idx = table.header.findIndex(
      (h) => h.trim().toLowerCase() === override.trim().toLowerCase(),
    );
    if (idx === -1) throw new Error(`--column "${override}" not found in header`);
    return idx;
  }

  let best = -1;
  let bestRatio = 0;
  for (let c = 0; c < table.header.length; c++) {
    let nonEmpty = 0;
    let urls = 0;
    for (const row of table.rows) {
      const cell = (row[c] ?? '').trim();
      if (!cell) continue;
      nonEmpty++;
      if (isFullUrl(cell)) urls++;
    }
    const ratio = nonEmpty === 0 ? 0 : urls / nonEmpty;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  if (best === -1 || bestRatio < 0.5) {
    throw new Error('Could not find a URL column; specify one with --column');
  }
  return best;
}
