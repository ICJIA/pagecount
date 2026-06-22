import { XMLParser } from 'fast-xml-parser';
import type { Config } from '../config';
import type { CountOutcome } from '../types';
import { loadZip, entryText } from '../zip';
import { findLibreOffice, renderDocxToPdf } from '../render/libreoffice';
import { countPdf } from './pdf';

export interface DocxDeps {
  findRenderer: () => string | null;
  render: (filePath: string, soffice: string) => Promise<{ pdfPath: string; cleanup: () => Promise<void> }>;
  countPdf: (filePath: string) => Promise<CountOutcome>;
}

const defaultDeps: DocxDeps = {
  findRenderer: findLibreOffice,
  render: renderDocxToPdf,
  countPdf,
};

function pagesFromAppXml(xml: string | null): number | null {
  if (!xml) return null;
  const parser = new XMLParser({ removeNSPrefix: true });
  const doc = parser.parse(xml) as Record<string, any>;
  const raw = doc?.Properties?.Pages;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function countDocx(
  filePath: string,
  cfg: Config,
  deps: DocxDeps = defaultDeps,
): Promise<CountOutcome> {
  let metadata: number | null = null;
  try {
    const zip = await loadZip(filePath);
    metadata = pagesFromAppXml(entryText(zip, 'docProps/app.xml'));
  } catch (err) {
    return { pageCount: null, status: 'corrupt', error: err instanceof Error ? err.message : String(err) };
  }

  const soffice = deps.findRenderer();
  const wantRender = cfg.docxRender || metadata === null;

  if (wantRender && soffice) {
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const rendered = await deps.render(filePath, soffice);
      cleanup = rendered.cleanup;
      const out = await deps.countPdf(rendered.pdfPath);
      if (out.status === 'ok') return { ...out, rendered: true };
    } catch {
      // fall through to metadata / no-page-data
    } finally {
      if (cleanup) await cleanup().catch(() => {});
    }
  }

  if (metadata !== null) return { pageCount: metadata, status: 'ok' };
  return { pageCount: null, status: 'no-page-data' };
}
