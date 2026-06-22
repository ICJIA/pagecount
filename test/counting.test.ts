import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { countUrl, countLocalFile } from '../src/counting';
import { resolveConfig } from '../src/config';
import { pdfBytes, pptxBytes, writeTemp } from './helpers/fixtures';

let server: Server;
let base: string;

beforeAll(async () => {
  const pdf = await pdfBytes(3);
  server = createServer((req, res) => {
    if (req.url === '/a.pdf' || req.url === '/noext') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from(pdf));
    } else if (req.url === '/a.jpg') {
      res.writeHead(200);
      res.end('img');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cfg = resolveConfig({});

describe('countUrl', () => {
  it('counts a pdf identified by extension', async () => {
    expect(await countUrl(`${base}/a.pdf`, cfg))
      .toMatchObject({ type: 'pdf', outcome: { pageCount: 3, status: 'ok' } });
  });
  it('classifies by content-type when the URL has no extension', async () => {
    expect(await countUrl(`${base}/noext`, cfg))
      .toMatchObject({ type: 'pdf', outcome: { pageCount: 3, status: 'ok' } });
  });
  it('skips clearly-unsupported extensions without fetching', async () => {
    expect(await countUrl(`${base}/a.jpg`, cfg))
      .toMatchObject({ type: null, outcome: { status: 'unsupported' } });
  });
  it('maps fetch failures to a status', async () => {
    expect((await countUrl(`${base}/missing.pdf`, cfg)).outcome.status).toBe('not-found');
  });
});

describe('countLocalFile', () => {
  it('counts a local pptx', async () => {
    const file = await writeTemp(pptxBytes(4), 'deck.pptx');
    expect(await countLocalFile(file, cfg))
      .toMatchObject({ type: 'pptx', outcome: { pageCount: 4, status: 'ok' } });
  });
});
