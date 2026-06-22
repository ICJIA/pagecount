import { resolve } from 'node:path';
import type { Config } from './config';
import type { CountOutcome, FileType } from './types';
import { fetchToTempFile } from './fetch';
import { countByType } from './counters/index';
import {
  typeFromExtension, hasUnsupportedExtension, typeFromContentType, sniffType,
} from './url';
import { statusFromFetchError } from './errors';

export interface CountResult {
  type: FileType | null;
  outcome: CountOutcome;
}

const UNSUPPORTED: CountResult = { type: null, outcome: { pageCount: null, status: 'unsupported' } };

export async function countLocalFile(filePath: string, cfg: Config): Promise<CountResult> {
  const abs = resolve(filePath);
  const type = typeFromExtension(abs) ?? (await sniffType(abs));
  if (!type) return UNSUPPORTED;
  return { type, outcome: await countByType(type, abs, cfg) };
}

export async function countUrl(url: string, cfg: Config): Promise<CountResult> {
  if (hasUnsupportedExtension(url)) return UNSUPPORTED;

  let fetched;
  try {
    fetched = await fetchToTempFile(url, cfg);
  } catch (err) {
    return {
      type: null,
      outcome: {
        pageCount: null,
        status: statusFromFetchError(err),
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }

  try {
    const type =
      typeFromExtension(url) ??
      typeFromContentType(fetched.contentType) ??
      (await sniffType(fetched.tempPath));
    if (!type) return UNSUPPORTED;
    return { type, outcome: await countByType(type, fetched.tempPath, cfg) };
  } finally {
    await fetched.cleanup();
  }
}
