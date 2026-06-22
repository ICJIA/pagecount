import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { processSpreadsheet } from '../../src/spreadsheet/process';
import { resolveConfig } from '../../src/config';
import { pdfBytes, writeTemp } from '../helpers/fixtures';

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
    const { results, summary, counts } = await processSpreadsheet(file, resolveConfig({}));
    expect(counts).toEqual([3, null, null, null]);
    expect(results.map((r) => r.status)).toEqual(['ok', 'no-url', 'no-url', 'not-found']);
    expect(results[0].row).toBe(2);
    expect(summary).toMatchObject({ total: 4, counted: 1, noUrl: 2, failed: 1 });
  });
});
