import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

export type ZipEntries = Record<string, Uint8Array>;

export async function loadZip(filePath: string): Promise<ZipEntries> {
  const buf = await readFile(filePath);
  return unzipSync(new Uint8Array(buf));
}

export function loadZipFromBytes(bytes: Uint8Array): ZipEntries {
  return unzipSync(bytes);
}

export function entryText(zip: ZipEntries, name: string): string | null {
  const entry = zip[name];
  return entry ? strFromU8(entry) : null;
}
