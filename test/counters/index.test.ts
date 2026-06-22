import { describe, it, expect } from 'vitest';
import { countByType } from '../../src/counters/index';
import { resolveConfig } from '../../src/config';
import { pdfBytes, pptxBytes, writeTemp } from '../helpers/fixtures';

const cfg = resolveConfig({});

describe('countByType', () => {
  it('routes pdf', async () => {
    const file = await writeTemp(await pdfBytes(2), 'a.pdf');
    expect(await countByType('pdf', file, cfg)).toMatchObject({ pageCount: 2, status: 'ok' });
  });
  it('routes pptx', async () => {
    const file = await writeTemp(pptxBytes(3), 'a.pptx');
    expect(await countByType('pptx', file, cfg)).toMatchObject({ pageCount: 3, status: 'ok' });
  });
});
