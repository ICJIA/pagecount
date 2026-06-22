import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readXlsx, writeXlsx } from '../../src/spreadsheet/xlsx';
import { writeXlsxFile } from '../helpers/fixtures';

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pc-'));
}

describe('xlsx read/write', () => {
  it('reads header and rows as text', async () => {
    const dir = await tmpDir();
    const file = join(dir, 'in.xlsx');
    await writeXlsxFile(file, ['Name', 'URL'], [['A', 'https://x/a.pdf'], ['B', '']]);
    const data = await readXlsx(file);
    expect(data.header).toEqual(['Name', 'URL']);
    expect(data.rows).toEqual([['A', 'https://x/a.pdf'], ['B', '']]);
  });

  it('appends a PageCount column and preserves existing cells', async () => {
    const dir = await tmpDir();
    const file = join(dir, 'in.xlsx');
    const out = join(dir, 'out.xlsx');
    await writeXlsxFile(file, ['Name', 'URL'], [['A', 'u1'], ['B', 'u2']]);
    const data = await readXlsx(file);
    await writeXlsx(data, out, [{ header: 'PageCount', values: [3, null] }]);
    const reread = await readXlsx(out);
    expect(reread.header).toEqual(['Name', 'URL', 'PageCount']);
    expect(reread.rows[0]).toEqual(['A', 'u1', '3']);
    expect(reread.rows[1]).toEqual(['B', 'u2', '']);
  });

  it('appends multiple columns at the right', async () => {
    const dir = await tmpDir();
    const file = join(dir, 'in.xlsx');
    const out = join(dir, 'out.xlsx');
    await writeXlsxFile(file, ['Name', 'URL'], [['A', 'u1'], ['B', 'u2']]);
    const data = await readXlsx(file);
    await writeXlsx(data, out, [
      { header: 'programmatic_page_count', values: [3, null] },
      { header: 'programmatic_page_count_notes', values: ['', 'corrupt'] },
    ]);
    const reread = await readXlsx(out);
    expect(reread.header).toEqual([
      'Name', 'URL', 'programmatic_page_count', 'programmatic_page_count_notes',
    ]);
    expect(reread.rows[0]).toEqual(['A', 'u1', '3', '']);
    expect(reread.rows[1]).toEqual(['B', 'u2', '', 'corrupt']);
  });
});
