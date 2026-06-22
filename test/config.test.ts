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
});
