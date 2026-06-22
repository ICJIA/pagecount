import { readFile } from 'node:fs/promises';
import type { FileType } from './types';
import { loadZipFromBytes } from './zip';

const EXT_MAP: Record<string, FileType> = { pdf: 'pdf', docx: 'docx', pptx: 'pptx' };

export function isFullUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function extensionOf(s: string): string | null {
  const noQuery = s.split(/[?#]/)[0] ?? s;
  const seg = noQuery.split('/').pop() ?? '';
  const dot = seg.lastIndexOf('.');
  if (dot <= 0 || dot === seg.length - 1) return null;
  return seg.slice(dot + 1).toLowerCase();
}

export function typeFromExtension(s: string): FileType | null {
  const ext = extensionOf(s);
  return ext ? (EXT_MAP[ext] ?? null) : null;
}

export function hasUnsupportedExtension(s: string): boolean {
  const ext = extensionOf(s);
  return ext !== null && !(ext in EXT_MAP);
}

export function typeFromContentType(ct: string | null): FileType | null {
  if (!ct) return null;
  const v = ct.toLowerCase();
  if (v.includes('application/pdf')) return 'pdf';
  if (v.includes('wordprocessingml.document')) return 'docx';
  if (v.includes('presentationml.presentation')) return 'pptx';
  return null;
}

export async function sniffType(filePath: string): Promise<FileType | null> {
  const bytes = new Uint8Array(await readFile(filePath));
  if (bytes.length >= 4 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf'; // %PDF
  }
  if (bytes.length >= 4 &&
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    try {
      const zip = loadZipFromBytes(bytes);
      if ('ppt/presentation.xml' in zip) return 'pptx';
      if ('word/document.xml' in zip) return 'docx';
    } catch {
      return null;
    }
  }
  return null;
}
