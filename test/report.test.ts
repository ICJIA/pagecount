import { describe, it, expect } from 'vitest';
import {
  summarize, formatSpreadsheetSummary, formatDocumentLine, buildDocumentJson, rowNote,
} from '../src/report';
import type { RowResult } from '../src/types';

const rows: RowResult[] = [
  { row: 2, url: 'u', type: 'pdf', pageCount: 3, status: 'ok' },
  { row: 3, url: null, type: null, pageCount: null, status: 'no-url' },
  { row: 4, url: 'u', type: 'docx', pageCount: null, status: 'timeout', error: 't' },
  { row: 5, url: 'u', type: null, pageCount: null, status: 'unsupported' },
];

describe('summarize', () => {
  it('tallies counts and errors', () => {
    const s = summarize(rows);
    expect(s).toMatchObject({ total: 4, counted: 1, noUrl: 1, failed: 2 });
    expect(s.byError).toEqual({ timeout: 1, unsupported: 1 });
  });
});

describe('formatters', () => {
  it('formats a spreadsheet summary with failure breakdown', () => {
    const txt = formatSpreadsheetSummary('in.csv', 'out.csv', summarize(rows));
    expect(txt).toContain('4 rows · 1 counted · 1 no-url · 2 failed');
    expect(txt).toContain('failed:');
  });
  it('formats a document line (plural / singular / rendered)', () => {
    expect(formatDocumentLine('a.pdf', 'pdf', { pageCount: 2, status: 'ok' }))
      .toBe('a.pdf · pdf · 2 pages');
    expect(formatDocumentLine('a.pdf', 'pdf', { pageCount: 1, status: 'ok' }))
      .toBe('a.pdf · pdf · 1 page');
    expect(formatDocumentLine('a.docx', 'docx', { pageCount: 5, status: 'ok', rendered: true }))
      .toBe('a.docx · docx · 5 pages (rendered)');
  });
  it('builds document json including an error field', () => {
    expect(buildDocumentJson('a.pdf', null, { pageCount: null, status: 'corrupt', error: 'bad' }))
      .toEqual({ file: 'a.pdf', type: null, pageCount: null, status: 'corrupt', error: 'bad' });
  });
});

describe('rowNote', () => {
  it('flags a counted docx page count as an estimate', () => {
    expect(rowNote({ row: 2, url: 'u', type: 'docx', pageCount: 5, status: 'ok' }))
      .toMatch(/estimate/i);
  });
  it('is empty for exact pdf/pptx counts', () => {
    expect(rowNote({ row: 2, url: 'u', type: 'pdf', pageCount: 3, status: 'ok' })).toBe('');
    expect(rowNote({ row: 2, url: 'u', type: 'pptx', pageCount: 3, status: 'ok' })).toBe('');
  });
  it('returns the failure status for non-ok rows', () => {
    expect(rowNote({ row: 2, url: 'u', type: null, pageCount: null, status: 'corrupt' })).toBe('corrupt');
    expect(rowNote({ row: 3, url: null, type: null, pageCount: null, status: 'no-url' })).toBe('no-url');
  });
});
