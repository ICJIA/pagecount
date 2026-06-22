import { extname } from 'node:path';
import type { AppendColumn } from '../types';
import { readCsv, writeCsv } from './csv';
import { readXlsx, writeXlsx } from './xlsx';

export interface LoadedSpreadsheet {
  header: string[];
  rows: string[][];
  write: (outPath: string, columns: AppendColumn[]) => Promise<void>;
}

function cell(value: string | number | null | undefined): string {
  return value == null ? '' : String(value);
}

export async function readSpreadsheet(path: string): Promise<LoadedSpreadsheet> {
  const ext = extname(path).toLowerCase();

  if (ext === '.csv') {
    const { header, rows } = await readCsv(path);
    return {
      header,
      rows,
      write: (outPath, columns) =>
        writeCsv(
          outPath,
          [...header, ...columns.map((c) => c.header)],
          rows.map((r, i) => [...r, ...columns.map((c) => cell(c.values[i]))]),
        ),
    };
  }

  if (ext === '.xlsx') {
    const data = await readXlsx(path);
    return {
      header: data.header,
      rows: data.rows,
      write: (outPath, columns) => writeXlsx(data, outPath, columns),
    };
  }

  throw new Error(`Unsupported spreadsheet type: ${ext || '(none)'}`);
}
