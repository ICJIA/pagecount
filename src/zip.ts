import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8, type UnzipFileInfo } from 'fflate';

export type ZipEntries = Record<string, Uint8Array>;

export interface ZipLimits {
  maxEntryBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRY = 50 * 1024 * 1024;   // 50 MB per entry (declared uncompressed size)
const DEFAULT_MAX_TOTAL = 200 * 1024 * 1024;  // 200 MB total declared uncompressed
const DEFAULT_MAX_ENTRIES = 4096;             // cap on accepted entries (zip-bomb / fork defense)

// NOTE: caps are based on each entry's DECLARED uncompressed size (zip central
// directory). This bounds the realistic zip-bomb; a file that lies about its size
// is a residual risk fflate does not let us hard-cap mid-inflate.
function makeFilter(limits?: ZipLimits) {
  const maxEntry = limits?.maxEntryBytes ?? DEFAULT_MAX_ENTRY;
  const maxTotal = limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL;
  const maxEntries = limits?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  let total = 0;
  let count = 0;
  return (file: UnzipFileInfo): boolean => {
    if (file.originalSize > maxEntry) return false;
    if (count >= maxEntries) return false;
    total += file.originalSize;
    if (total > maxTotal) return false;
    count += 1;
    return true;
  };
}

export async function loadZip(filePath: string, limits?: ZipLimits): Promise<ZipEntries> {
  const buf = await readFile(filePath);
  return unzipSync(new Uint8Array(buf), { filter: makeFilter(limits) });
}

export function loadZipFromBytes(bytes: Uint8Array, limits?: ZipLimits): ZipEntries {
  return unzipSync(bytes, { filter: makeFilter(limits) });
}

export function entryText(zip: ZipEntries, name: string): string | null {
  const entry = zip[name];
  return entry ? strFromU8(entry) : null;
}
