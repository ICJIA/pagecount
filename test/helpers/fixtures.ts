import { zipSync, strToU8 } from 'fflate';

/** Build an in-memory ZIP from a map of path → text content. */
export function zipBytes(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return zipSync(entries);
}
