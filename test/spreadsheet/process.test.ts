import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { processSpreadsheet } from '../../src/spreadsheet/process';
import { resolveConfig } from '../../src/config';
import { pdfBytes, writeTemp } from '../helpers/fixtures';
import { buildTotalRow } from '../../src/spreadsheet/total';

let server: Server;
let base: string;

beforeAll(async () => {
  const pdf = await pdfBytes(3);
  server = createServer((req, res) => {
    if (req.url === '/a.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from(pdf));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('processSpreadsheet', () => {
  it('counts URLs, blanks non-URLs, and summarizes failures', async () => {
    const csv = `Name,Link\nA,${base}/a.pdf\nB,\nC,not-a-url\nD,${base}/missing.pdf\n`;
    const file = await writeTemp(csv, 'in.csv');
    const { results, summary, counts } = await processSpreadsheet(file, resolveConfig({ allowPrivateHosts: true }));
    expect(counts).toEqual([3, null, null, null]);
    expect(results.map((r) => r.status)).toEqual(['ok', 'no-url', 'no-url', 'not-found']);
    expect(results[0].row).toBe(2);
    expect(summary).toMatchObject({ total: 4, counted: 1, noUrl: 2, failed: 1 });
  });

  it('by default counts only rows whose Recommendation is remediate', async () => {
    const csv = `File,Recommendation,Link\n` +
      `A,Remediate,${base}/a.pdf\n` +
      `B,Accessible,${base}/a.pdf\n` +
      `C,remediate,${base}/a.pdf\n`;
    const file = await writeTemp(csv, 'rec.csv');
    const { results, counts, summary } =
      await processSpreadsheet(file, resolveConfig({ allowPrivateHosts: true }));
    expect(results.map((r) => r.status)).toEqual(['ok', 'filtered', 'ok']);
    expect(counts).toEqual([3, null, 3]);
    expect(summary).toMatchObject({ counted: 2, filtered: 1, totalPages: 6 });
  });

  it('never fetches filtered rows', async () => {
    // The non-matching row points at a URL the server 404s. If it were fetched the
    // status would be 'not-found'; filtering must short-circuit it to 'filtered'.
    const csv = `File,Recommendation,Link\nB,Accessible,${base}/missing.pdf\n`;
    const file = await writeTemp(csv, 'nofetch.csv');
    const { results } = await processSpreadsheet(file, resolveConfig({ allowPrivateHosts: true }));
    expect(results[0].status).toBe('filtered');
  });

  it('matches any of several --filter-value alternatives, case-insensitively', async () => {
    const csv = `File,Recommendation,Link\nA,Remediate,${base}/a.pdf\nB,TRUE,${base}/a.pdf\n`;
    const file = await writeTemp(csv, 'multi.csv');
    const cfg = resolveConfig({ allowPrivateHosts: true, filterValue: 'remediate,true' });
    const { results } = await processSpreadsheet(file, cfg);
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('counts every row and warns when the default column is absent', async () => {
    const csv = `Name,Link\nA,${base}/a.pdf\n`;
    const file = await writeTemp(csv, 'nocol.csv');
    const { results, warnings } =
      await processSpreadsheet(file, resolveConfig({ allowPrivateHosts: true }));
    expect(results.map((r) => r.status)).toEqual(['ok']);
    expect(warnings.join(' ')).toMatch(/Recommendation/);
  });

  it('throws when an explicit --filter-column is missing', async () => {
    const csv = `Name,Link\nA,${base}/a.pdf\n`;
    const file = await writeTemp(csv, 'explicit.csv');
    const cfg = resolveConfig({ allowPrivateHosts: true, filterColumn: 'Disposition' });
    await expect(processSpreadsheet(file, cfg)).rejects.toThrow(/Disposition/);
  });

  it('counts all rows with noFilter even when Recommendation exists', async () => {
    const csv = `File,Recommendation,Link\nA,Remediate,${base}/a.pdf\nB,Accessible,${base}/a.pdf\n`;
    const file = await writeTemp(csv, 'all.csv');
    const cfg = resolveConfig({ allowPrivateHosts: true, noFilter: true });
    const { results } = await processSpreadsheet(file, cfg);
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('throws a range-aware error for an out-of-range explicit --filter-column index', async () => {
    const csv = `File,Recommendation,Link\nA,Remediate,${base}/a.pdf\n`;
    const file = await writeTemp(csv, 'oor.csv');
    const cfg = resolveConfig({ allowPrivateHosts: true, filterColumn: '99' });
    await expect(processSpreadsheet(file, cfg)).rejects.toThrow(/out of range/);
  });

  it('TOTAL row sums only the matched (remediate) rows, excluding filtered nulls', async () => {
    const csv = `File,Recommendation,Link\n` +
      `A,Remediate,${base}/a.pdf\n` +
      `B,Accessible,${base}/a.pdf\n` +
      `C,Remediate,${base}/a.pdf\n`;
    const file = await writeTemp(csv, 'total-filter.csv');
    const { loaded, counts } = await processSpreadsheet(file, resolveConfig({ allowPrivateHosts: true }));
    expect(counts).toEqual([3, null, 3]);
    const total = buildTotalRow(loaded.header.length, [
      { header: 'programmatic_page_count', values: counts },
    ]);
    expect(total[total.length - 1]).toBe(6); // the Accessible (filtered → null) row is excluded
  });
});
