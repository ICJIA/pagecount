import { describe, it, expect } from 'vitest';
import { countDocx, type DocxDeps } from '../../src/counters/docx';
import { resolveConfig } from '../../src/config';
import { docxBytes, writeTemp } from '../helpers/fixtures';
import type { CountOutcome } from '../../src/types';

const cfg = resolveConfig({});
const cfgForce = resolveConfig({ docxRender: true });

const noRenderer: DocxDeps = {
  findRenderer: () => null,
  render: async () => { throw new Error('should not render'); },
  countPdf: async () => { throw new Error('should not count'); },
};

function fakeRenderer(pages: number): DocxDeps {
  return {
    findRenderer: () => 'soffice',
    render: async () => 'rendered.pdf',
    countPdf: async (): Promise<CountOutcome> => ({ pageCount: pages, status: 'ok' }),
  };
}

describe('countDocx', () => {
  it('uses cached <Pages> metadata when present', async () => {
    const file = await writeTemp(docxBytes({ pages: 4 }), 'a.docx');
    expect(await countDocx(file, cfg, noRenderer)).toMatchObject({ pageCount: 4, status: 'ok' });
  });

  it('returns no-page-data when metadata is missing and no renderer', async () => {
    const file = await writeTemp(docxBytes({}), 'a.docx');
    expect(await countDocx(file, cfg, noRenderer)).toMatchObject({ pageCount: null, status: 'no-page-data' });
  });

  it('renders to fill in a missing count', async () => {
    const file = await writeTemp(docxBytes({}), 'a.docx');
    const out = await countDocx(file, cfg, fakeRenderer(7));
    expect(out).toMatchObject({ pageCount: 7, status: 'ok', rendered: true });
  });

  it('forces render over metadata when --docx-render is set', async () => {
    const file = await writeTemp(docxBytes({ pages: 4 }), 'a.docx');
    const out = await countDocx(file, cfgForce, fakeRenderer(9));
    expect(out).toMatchObject({ pageCount: 9, status: 'ok', rendered: true });
  });
});
