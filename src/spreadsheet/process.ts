import type { Config } from '../config';
import type { RowResult, Summary } from '../types';
import { readSpreadsheet, type LoadedSpreadsheet } from './read';
import { detectUrlColumn, findColumn, resolveColumn } from '../detectColumn';
import { mapWithConcurrency } from '../pool';
import { countUrl } from '../counting';
import { isFullUrl } from '../url';
import { summarize } from '../report';

export interface ProcessResult {
  loaded: LoadedSpreadsheet;
  results: RowResult[];
  summary: Summary;
  counts: (number | null)[];
  warnings: string[];
}

export async function processSpreadsheet(path: string, cfg: Config): Promise<ProcessResult> {
  const loaded = await readSpreadsheet(path);
  const table = { header: loaded.header, rows: loaded.rows };
  const col = detectUrlColumn(table, cfg.column);

  // Resolve the optional row filter. An explicit --filter-column that is missing is an
  // error; the default column merely being absent falls back to counting every row.
  const warnings: string[] = [];
  let filterCol: number | null = null;
  let accept: Set<string> | null = null;
  if (cfg.filter) {
    if (cfg.filter.columnExplicit) {
      // An explicit --filter-column must exist; resolveColumn throws a single-sourced,
      // range-aware error (consistent with how --column reports a bad index/name).
      filterCol = resolveColumn(table, cfg.filter.column, '--filter-column');
      accept = new Set(cfg.filter.values);
    } else {
      const idx = findColumn(table, cfg.filter.column);
      if (idx !== undefined) {
        filterCol = idx;
        accept = new Set(cfg.filter.values);
      } else {
        warnings.push(`No "${cfg.filter.column}" column found; counted all rows.`);
      }
    }
  }

  const results = await mapWithConcurrency(
    loaded.rows,
    cfg.concurrency,
    async (row, i): Promise<RowResult> => {
      const rowNumber = i + 2; // row 1 is the header
      if (filterCol !== null && accept) {
        const value = (row[filterCol] ?? '').trim().toLowerCase();
        if (!accept.has(value)) {
          return { row: rowNumber, url: null, type: null, pageCount: null, status: 'filtered' };
        }
      }
      const cell = (row[col] ?? '').trim();
      if (!isFullUrl(cell)) {
        return { row: rowNumber, url: cell || null, type: null, pageCount: null, status: 'no-url' };
      }
      const { type, outcome } = await countUrl(cell, cfg);
      return {
        row: rowNumber,
        url: cell,
        type,
        pageCount: outcome.pageCount,
        status: outcome.status,
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    },
  );

  return {
    loaded,
    results,
    summary: summarize(results),
    counts: results.map((r) => r.pageCount),
    warnings,
  };
}
