import ExcelJS from 'exceljs';
import type { AppendColumn } from '../types';

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

export async function writeXlsx(
  data: Pick<XlsxData, 'workbook' | 'sheet'>,
  outPath: string,
  columns: AppendColumn[],
): Promise<void> {
  const { workbook, sheet } = data;
  const start = sheet.columnCount;
  columns.forEach((col, j) => {
    const c = start + 1 + j;
    sheet.getRow(1).getCell(c).value = col.header;
    for (let i = 0; i < col.values.length; i++) {
      const value = col.values[i];
      if (value != null && value !== '') sheet.getRow(i + 2).getCell(c).value = value;
    }
  });
  await workbook.xlsx.writeFile(outPath);
}
