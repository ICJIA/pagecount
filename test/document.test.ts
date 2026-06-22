import { describe, it, expect } from 'vitest';
import { countDocument } from '../src/document';
import { resolveConfig } from '../src/config';
import { pdfBytes, writeTemp } from './helpers/fixtures';

describe('countDocument', () => {
  it('counts a local document', async () => {
    const file = await writeTemp(await pdfBytes(2), 'a.pdf');
    expect(await countDocument(file, false, resolveConfig({})))
      .toMatchObject({ type: 'pdf', outcome: { pageCount: 2, status: 'ok' } });
  });
});
