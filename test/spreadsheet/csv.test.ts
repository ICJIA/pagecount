import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readCsv, writeCsv } from '../../src/spreadsheet/csv';
import { writeTemp } from '../helpers/fixtures';

describe('csv read/write', () => {
  it('reads header and rows', async () => {
    const file = await writeTemp('Name,URL\nA,https://x/a.pdf\nB,\n', 'in.csv');
    const { header, rows } = await readCsv(file);
    expect(header).toEqual(['Name', 'URL']);
    expect(rows).toEqual([['A', 'https://x/a.pdf'], ['B', '']]);
  });

  it('round-trips quoted fields', async () => {
    const out = await writeTemp('', 'out.csv');
    await writeCsv(out, ['Name', 'URL'], [['A, Inc.', 'u1']]);
    const text = await readFile(out, 'utf8');
    expect(text).toContain('"A, Inc."');
    const reread = await readCsv(out);
    expect(reread.rows[0]).toEqual(['A, Inc.', 'u1']);
  });

  it('neutralizes formula-injection cells with a leading quote', async () => {
    const out = await writeTemp('', 'out.csv');
    await writeCsv(out, ['h1', 'h2', 'h3', 'h4'], [['=cmd|x', '+1', '-2', '@SUM(A1)']]);
    const reread = await readCsv(out);
    for (const cell of reread.rows[0]!) {
      expect(cell.startsWith("'")).toBe(true);
    }
  });
});
