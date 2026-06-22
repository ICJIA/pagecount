import { zipSync, strToU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

/** Build an in-memory ZIP from a map of path → text content. */
export function zipBytes(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return zipSync(entries);
}

export async function pdfBytes(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

export async function writeTemp(bytes: Uint8Array | string, name = 'f.bin'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pc-'));
  const file = join(dir, name);
  await writeFile(file, bytes);
  return file;
}

export function pptxBytes(slides: number): Uint8Array {
  const ids = Array.from({ length: slides }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  const xml =
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r">` +
    `<p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`;
  return zipBytes({ 'ppt/presentation.xml': xml });
}

export function docxBytes(opts: { pages?: number } = {}): Uint8Array {
  const files: Record<string, string> = { 'word/document.xml': '<w:document/>' };
  if (opts.pages != null) {
    files['docProps/app.xml'] =
      `<?xml version="1.0"?><Properties xmlns="ext"><Pages>${opts.pages}</Pages></Properties>`;
  }
  return zipBytes(files);
}

export async function writeXlsxFile(
  path: string, header: string[], rows: (string | number)[][],
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(path);
}
