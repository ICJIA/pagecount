import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/config';

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
    const c = resolveConfig({});
    expect(c.countColumn).toBe('programmatic_page_count');
    expect(c.suffix).toBe('pagecount');
    expect(c.concurrency).toBe(8);
    expect(c.timeout).toBe(30_000);          // seconds → ms
    expect(c.maxSize).toBe(100 * 1024 * 1024); // MB → bytes
    expect(c.json).toBe(false);
    expect(c.quiet).toBe(false);
    expect(c.docxRender).toBe(false);
  });

  it('keeps an explicit empty suffix', () => {
    expect(resolveConfig({ suffix: '' }).suffix).toBe('');
  });

  it('parses numeric strings from the CLI', () => {
    const c = resolveConfig({ concurrency: '16', timeout: '5', maxSize: '10' });
    expect(c.concurrency).toBe(16);
    expect(c.timeout).toBe(5_000);
    expect(c.maxSize).toBe(10 * 1024 * 1024);
  });

  it('rejects non-positive numbers', () => {
    expect(() => resolveConfig({ concurrency: '0' })).toThrow();
    expect(() => resolveConfig({ timeout: 'abc' })).toThrow();
  });

  it('clamps concurrency to 64', () => {
    expect(resolveConfig({ concurrency: '1000' }).concurrency).toBe(64);
  });

  it('rejects a path-traversing suffix', () => {
    expect(() => resolveConfig({ suffix: '../x' })).toThrow();
  });
});

describe('resolveConfig filter', () => {
  it('defaults to Recommendation=remediate', () => {
    expect(resolveConfig({}).filter)
      .toEqual({ column: 'Recommendation', columnExplicit: false, values: ['remediate'] });
  });
  it('marks an explicit filter column', () => {
    expect(resolveConfig({ filterColumn: 'Action' }).filter)
      .toMatchObject({ column: 'Action', columnExplicit: true });
  });
  it('splits, trims, lowercases, and de-dupes values', () => {
    expect(resolveConfig({ filterValue: 'Remediate, TRUE ,remediate, ' }).filter?.values)
      .toEqual(['remediate', 'true']);
  });
  it('disables filtering with noFilter', () => {
    expect(resolveConfig({ noFilter: true }).filter).toBeNull();
  });
  it('rejects an all-empty filter value', () => {
    expect(() => resolveConfig({ filterValue: ' , ,' })).toThrow();
  });
});
