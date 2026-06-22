import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { sanitizeCell } from './sanitize';

export async function readCsv(path: string): Promise<{ header: string[]; rows: string[][] }> {
  const text = await readFile(path, 'utf8');
  const records = parse(text, { relax_column_count: true }) as string[][];
  const [header = [], ...rows] = records;
  return { header, rows };
}

export async function writeCsv(outPath: string, header: string[], rows: string[][]): Promise<void> {
  const out = stringify([header.map(sanitizeCell), ...rows.map((r) => r.map(sanitizeCell))]);
  await writeFile(outPath, out, 'utf8');
}
