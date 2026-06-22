import type { Config } from '../config';
import type { RowResult, Summary } from '../types';
import { readSpreadsheet, type LoadedSpreadsheet } from './read';
import { detectUrlColumn } from '../detectColumn';
import { mapWithConcurrency } from '../pool';
import { countUrl } from '../counting';
import { isFullUrl } from '../url';
import { summarize } from '../report';

export interface ProcessResult {
  loaded: LoadedSpreadsheet;
  results: RowResult[];
  summary: Summary;
  counts: (number | null)[];
}

export async function processSpreadsheet(path: string, cfg: Config): Promise<ProcessResult> {
  const loaded = await readSpreadsheet(path);
  const col = detectUrlColumn({ header: loaded.header, rows: loaded.rows }, cfg.column);

  const results = await mapWithConcurrency(
    loaded.rows,
    cfg.concurrency,
    async (row, i): Promise<RowResult> => {
      const cell = (row[col] ?? '').trim();
      const rowNumber = i + 2; // row 1 is the header
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

  return { loaded, results, summary: summarize(results), counts: results.map((r) => r.pageCount) };
}
