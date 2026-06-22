import { extname } from 'node:path';
import { readCsv, writeCsv } from './csv';
import { readXlsx, writeXlsx } from './xlsx';

export interface LoadedSpreadsheet {
  header: string[];
  rows: string[][];
  write: (outPath: string, countHeader: string, counts: (number | null)[]) => Promise<void>;
}

export async function readSpreadsheet(path: string): Promise<LoadedSpreadsheet> {
  const ext = extname(path).toLowerCase();

  if (ext === '.csv') {
    const { header, rows } = await readCsv(path);
    return {
      header,
      rows,
      write: (outPath, countHeader, counts) =>
        writeCsv(
          outPath,
          [...header, countHeader],
          rows.map((r, i) => [...r, counts[i] != null ? String(counts[i]) : '']),
        ),
    };
  }

  if (ext === '.xlsx') {
    const data = await readXlsx(path);
    return {
      header: data.header,
      rows: data.rows,
      write: (outPath, countHeader, counts) => writeXlsx(data, outPath, countHeader, counts),
    };
  }

  throw new Error(`Unsupported spreadsheet type: ${ext || '(none)'}`);
}
