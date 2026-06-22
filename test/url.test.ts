import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isFullUrl, typeFromExtension, hasUnsupportedExtension, typeFromContentType, sniffType,
} from '../src/url';
import { zipBytes } from './helpers/fixtures';

describe('isFullUrl', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(isFullUrl('https://x.org/a.pdf')).toBe(true);
    expect(isFullUrl('  http://x.org/a ')).toBe(true);
  });
  it('rejects blanks, relative paths, and other schemes', () => {
    expect(isFullUrl('')).toBe(false);
    expect(isFullUrl('a.pdf')).toBe(false);
    expect(isFullUrl('/files/a.pdf')).toBe(false);
    expect(isFullUrl('ftp://x.org/a.pdf')).toBe(false);
  });
});

describe('typeFromExtension / hasUnsupportedExtension', () => {
  it('reads the extension, ignoring query/fragment', () => {
    expect(typeFromExtension('https://x.org/a.PDF?token=1')).toBe('pdf');
    expect(typeFromExtension('/docs/report.docx')).toBe('docx');
    expect(typeFromExtension('deck.pptx#2')).toBe('pptx');
    expect(typeFromExtension('https://x.org/download?id=9')).toBeNull();
  });
  it('flags a present, unsupported extension', () => {
    expect(hasUnsupportedExtension('photo.jpg')).toBe(true);
    expect(hasUnsupportedExtension('a.pdf')).toBe(false);
    expect(hasUnsupportedExtension('https://x.org/download?id=9')).toBe(false);
  });
});

describe('typeFromContentType', () => {
  it('maps known content types', () => {
    expect(typeFromContentType('application/pdf')).toBe('pdf');
    expect(typeFromContentType(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(typeFromContentType(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation; charset=x'))
      .toBe('pptx');
    expect(typeFromContentType(null)).toBeNull();
    expect(typeFromContentType('text/html')).toBeNull();
  });
});

describe('sniffType', () => {
  async function tmp(bytes: Uint8Array): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'pc-'));
    const file = join(dir, 'f.bin');
    await writeFile(file, bytes);
    return file;
  }
  it('detects a PDF by header', async () => {
    expect(await sniffType(await tmp(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])))).toBe('pdf');
  });
  it('detects pptx vs docx inside a zip', async () => {
    expect(await sniffType(await tmp(zipBytes({ 'ppt/presentation.xml': '<p/>' })))).toBe('pptx');
    expect(await sniffType(await tmp(zipBytes({ 'word/document.xml': '<w/>' })))).toBe('docx');
  });
  it('returns null for unknown content', async () => {
    expect(await sniffType(await tmp(new Uint8Array([1, 2, 3, 4])))).toBeNull();
  });
});
