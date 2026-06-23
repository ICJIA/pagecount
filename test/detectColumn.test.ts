import { describe, it, expect } from 'vitest';
import { detectUrlColumn, findColumn, resolveColumn, type Table } from '../src/detectColumn';

const table: Table = {
  header: ['Name', 'Notes', 'Link'],
  rows: [
    ['Alpha', 'x', 'https://x.org/a.pdf'],
    ['Beta', 'y', 'https://x.org/b.docx'],
    ['Gamma', 'z', ''],
  ],
};

describe('detectUrlColumn', () => {
  it('auto-detects the column with the most URLs', () => {
    expect(detectUrlColumn(table)).toBe(2);
  });
  it('prefers a column of document URLs over a column of page URLs', () => {
    const t: Table = {
      header: ['Title', 'Page URL', 'File URL'],
      rows: [
        ['A', 'https://site.org/news/a', 'https://site.org/files/a.pdf'],
        ['B', 'https://site.org/news/b', 'https://site.org/files/b.docx'],
      ],
    };
    expect(detectUrlColumn(t)).toBe(2); // File URL, not Page URL
  });
  it('falls back to any URL column when none link to documents', () => {
    const t: Table = {
      header: ['Title', 'Link'],
      rows: [
        ['A', 'https://site.org/page-a'],
        ['B', 'https://site.org/page-b'],
      ],
    };
    expect(detectUrlColumn(t)).toBe(1);
  });
  it('honors an override by header name (case-insensitive)', () => {
    expect(detectUrlColumn(table, 'link')).toBe(2);
  });
  it('honors an override by 1-based index', () => {
    expect(detectUrlColumn(table, '1')).toBe(0);
  });
  it('throws when no URL column is found', () => {
    expect(() => detectUrlColumn({ header: ['a', 'b'], rows: [['1', '2']] })).toThrow();
  });
  it('throws on an out-of-range index override', () => {
    expect(() => detectUrlColumn(table, '9')).toThrow(/range/);
  });
  it('throws on an unknown name override', () => {
    expect(() => detectUrlColumn(table, 'nope')).toThrow(/not found/);
  });
});

describe('findColumn', () => {
  it('resolves a header name case-insensitively and trims', () => {
    expect(findColumn(table, 'link')).toBe(2);
    expect(findColumn(table, '  LINK ')).toBe(2);
  });
  it('resolves a 1-based index', () => {
    expect(findColumn(table, '1')).toBe(0);
    expect(findColumn(table, '3')).toBe(2);
  });
  it('returns undefined for an unknown name', () => {
    expect(findColumn(table, 'nope')).toBeUndefined();
  });
  it('returns undefined for an out-of-range or zero index', () => {
    expect(findColumn(table, '9')).toBeUndefined();
    expect(findColumn(table, '0')).toBeUndefined();
  });
  it('returns undefined for a blank ref', () => {
    expect(findColumn(table, '   ')).toBeUndefined();
  });
});

describe('resolveColumn', () => {
  it('resolves valid name or index refs', () => {
    expect(resolveColumn(table, 'Name', '--filter-column')).toBe(0);
    expect(resolveColumn(table, '3', '--filter-column')).toBe(2);
  });
  it('throws a flag-aware error for an unknown name', () => {
    expect(() => resolveColumn(table, 'nope', '--filter-column'))
      .toThrow(/--filter-column "nope" not found/);
  });
  it('throws a flag-aware error for an out-of-range index', () => {
    expect(() => resolveColumn(table, '9', '--filter-column'))
      .toThrow(/--filter-column index 9 is out of range/);
  });
});
