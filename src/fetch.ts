import { mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Config } from './config';
import { CountError, statusFromHttp } from './errors';
import { assertPublicUrl } from './ssrf';

export interface FetchedFile {
  tempPath: string;
  contentType: string | null;
  cleanup: () => Promise<void>;
}

const MAX_REDIRECTS = 5;
const USER_AGENT = 'pagecount/0.1 (+https://github.com/ICJIA/pagecount)';

async function followRedirects(initialUrl: string, cfg: Config, signal: AbortSignal): Promise<Response> {
  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!cfg.allowPrivateHosts) await assertPublicUrl(url);
    const res = await fetch(url, { signal, redirect: 'manual', headers: { 'user-agent': USER_AGENT } });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).toString();
      await res.body?.cancel().catch(() => {});
      continue;
    }
    return res;
  }
  throw new CountError('network-error', 'too many redirects');
}

export async function fetchToTempFile(url: string, cfg: Config): Promise<FetchedFile> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);
  try {
    const res = await followRedirects(url, cfg, controller.signal);
    if (!res.ok) throw new CountError(statusFromHttp(res.status), `HTTP ${res.status}`);

    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > cfg.maxSize) {
      throw new CountError('too-large', `content-length ${len} exceeds max ${cfg.maxSize}`);
    }
    if (!res.body) throw new CountError('network-error', 'empty response body');

    const dir = await mkdtemp(join(tmpdir(), 'pc-fetch-'));
    const tempPath = join(dir, 'download');
    const cleanup = () => rm(dir, { recursive: true, force: true });

    const handle = await open(tempPath, 'w');
    let written = 0;
    try {
      for await (const chunk of Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])) {
        written += (chunk as Buffer).length;
        if (written > cfg.maxSize) throw new CountError('too-large', `body exceeds max ${cfg.maxSize}`);
        await handle.write(chunk);
      }
    } catch (err) {
      await handle.close();
      await cleanup();
      throw err;
    }
    await handle.close();

    return { tempPath, contentType: res.headers.get('content-type'), cleanup };
  } finally {
    clearTimeout(timer);
  }
}
