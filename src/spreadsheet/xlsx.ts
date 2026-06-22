import ExcelJS from 'exceljs';
import type { AppendColumn } from '../types';
import { sanitizeCell } from './sanitize';

export interface XlsxData {
  header: string[];
  rows: string[][];
  workbook: ExcelJS.Workbook;
  sheet: ExcelJS.Worksheet;
}

export async function readXlsx(path: string): Promise<XlsxData> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('xlsx file has no worksheets');

  const colCount = sheet.columnCount;
  const header: string[] = [];
  for (let c = 1; c <= colCount; c++) header.push(sheet.getRow(1).getCell(c).text);

  const rows: string[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const values: string[] = [];
    for (let c = 1; c <= colCount; c++) values.push(row.getCell(c).text);
    rows.push(values);
  }
  return { header, rows, workbook, sheet };
}

// Append columns to the already-loaded workbook and write it out, preserving the
// original formatting and any other sheets.
export async function writeXlsx(
  data: Pick<XlsxData, 'workbook' | 'sheet'>,
  outPath: string,
  columns: AppendColumn[],
): Promise<void> {
  const { workbook, sheet } = data;
  const start = sheet.columnCount;
  columns.forEach((col, j) => {
    const c = start + 1 + j;
    sheet.getRow(1).getCell(c).value = sanitizeCell(col.header);
    for (let i = 0; i < col.values.length; i++) {
      const value = col.values[i];
      if (value != null && value !== '') {
        sheet.getRow(i + 2).getCell(c).value =
          typeof value === 'string' ? sanitizeCell(value) : value;
      }
    }
  });
  await workbook.xlsx.writeFile(outPath);
}

// Build a fresh workbook from plain header/rows plus appended columns. Used to emit
// an XLSX version of a CSV input (numeric values stay numeric).
export async function writeXlsxFromData(
  outPath: string,
  header: string[],
  rows: string[][],
  columns: AppendColumn[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow([...header, ...columns.map((c) => c.header)].map((v) => (typeof v === 'string' ? sanitizeCell(v) : v)));
  rows.forEach((r, i) => {
    const extra = columns.map((c) => {
      const v = c.values[i];
      return v == null || v === '' ? '' : v;
    });
    sheet.addRow([...r, ...extra].map((v) => (typeof v === 'string' ? sanitizeCell(v) : v)));
  });
  await workbook.xlsx.writeFile(outPath);
}
