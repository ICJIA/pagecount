import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadZip, loadZipFromBytes, entryText } from '../src/zip';
import { zipBytes } from './helpers/fixtures';

describe('zip helper', () => {
  it('reads entries from bytes', () => {
    const zip = loadZipFromBytes(zipBytes({ 'a/b.xml': '<x>1</x>' }));
    expect(entryText(zip, 'a/b.xml')).toBe('<x>1</x>');
    expect(entryText(zip, 'missing')).toBeNull();
  });

  it('reads entries from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pc-'));
    const file = join(dir, 'sample.zip');
    await writeFile(file, zipBytes({ 'hello.txt': 'hi' }));
    const zip = await loadZip(file);
    expect(entryText(zip, 'hello.txt')).toBe('hi');
  });

  it('drops entries whose declared size exceeds the per-entry cap', () => {
    const bytes = zipBytes({ 'small.txt': 'ok', 'big.txt': 'x'.repeat(2048) });
    const zip = loadZipFromBytes(bytes, { maxEntryBytes: 64 });
    expect(entryText(zip, 'small.txt')).toBe('ok');
    expect('big.txt' in zip).toBe(false);
  });

  it('caps the number of accepted entries', () => {
    const bytes = zipBytes({ 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' });
    const zip = loadZipFromBytes(bytes, { maxEntries: 1 });
    expect(Object.keys(zip)).toHaveLength(1);
    expect(entryText(zip, 'a.txt')).toBe('1');
  });
});
