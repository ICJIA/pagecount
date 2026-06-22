import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { stat, readFile } from 'node:fs/promises';
import { run, outputPathFor } from '../src/run';
import { resolveConfig } from '../src/config';
import { pdfBytes, writeTemp } from './helpers/fixtures';

describe('outputPathFor', () => {
  it('places output in .pagecount-output beside the file with a suffix', () => {
    expect(outputPathFor('/data/in.csv', resolveConfig({})))
      .toBe('/data/.pagecount-output/in-pagecount.csv');
  });
  it('honors --output and an empty --suffix', () => {
    expect(outputPathFor('/data/in.csv', resolveConfig({ output: '/out', suffix: '' })))
      .toBe('/out/in.csv');
  });
});

describe('run — document mode', () => {
  it('prints a line and returns 0 for a local pdf', async () => {
    const file = await writeTemp(await pdfBytes(2), 'a.pdf');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run([file], resolveConfig({}));
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(' ')).toContain('pdf');
    log.mockRestore();
  });
  it('returns 1 for an unsupported input', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run(['notes.txt'], resolveConfig({}))).toBe(1);
    err.mockRestore();
  });
});

describe('run — spreadsheet mode (end-to-end)', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const pdf = await pdfBytes(4);
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

  it('writes an output csv with a PageCount column', async () => {
    const file = await writeTemp(`Name,Link\nA,${base}/a.pdf\nB,\n`, 'data.csv');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run([file], resolveConfig({ allowPrivateHosts: true }));
    expect(code).toBe(0);
    const outPath = outputPathFor(file, resolveConfig({ allowPrivateHosts: true }));
    await stat(outPath); // throws if missing
    const text = await readFile(outPath, 'utf8');
    expect(text).toContain('Name,Link,programmatic_page_count,programmatic_page_count_notes');
    expect(text).toContain(',4,');
    expect(text.trim().split('\n')[2]).toBe('B,,,no-url');
    log.mockRestore();
  });
});
