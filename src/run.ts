import { resolve, dirname, basename, extname, join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import type { Config } from './config';
import { classifyInput } from './input';
import { processSpreadsheet } from './spreadsheet/process';
import { countDocument } from './document';
import {
  formatSpreadsheetSummary, buildSpreadsheetJson, formatDocumentLine, buildDocumentJson, rowNote,
} from './report';

// Output path without an extension: <dir>/<name>-<suffix>
export function outputBaseFor(inputPath: string, cfg: Config): string {
  const abs = resolve(inputPath);
  const ext = extname(abs);
  const base = basename(abs, ext);
  const name = cfg.suffix ? `${base}-${cfg.suffix}` : base;
  const dir = cfg.output ?? join(dirname(abs), '.pagecount-output');
  return join(dir, name);
}

export function outputPathFor(inputPath: string, cfg: Config): string {
  return `${outputBaseFor(inputPath, cfg)}${extname(resolve(inputPath))}`;
}

async function runSpreadsheet(path: string, cfg: Config): Promise<void> {
  const { loaded, results, summary, counts } = await processSpreadsheet(path, cfg);
  const notes = results.map(rowNote);
  const columns = [
    { header: cfg.countColumn, values: counts },
    { header: `${cfg.countColumn}_notes`, values: notes },
  ];

  const base = outputBaseFor(path, cfg);
  await mkdir(dirname(base), { recursive: true });
  // Always write both a CSV and an XLSX version of the result.
  await loaded.writeCsv(`${base}.csv`, columns);
  await loaded.writeXlsx(`${base}.xlsx`, columns);
  console.log(formatSpreadsheetSummary(path, outputPathFor(path, cfg), summary));

  // Keep .pagecount-output to the single latest result: write the JSON sidecar only
  // with --json, and remove a stale one otherwise.
  const jsonPath = `${base}.json`;
  if (cfg.json) {
    await writeFile(
      jsonPath,
      JSON.stringify(buildSpreadsheetJson(path, `${base}.csv`, results, summary), null, 2),
    );
  } else {
    await rm(jsonPath, { force: true });
  }
}

function reportDocument(
  source: string,
  result: Awaited<ReturnType<typeof countDocument>>,
  cfg: Config,
): void {
  const { type, outcome } = result;
  if (cfg.json) {
    console.log(JSON.stringify(buildDocumentJson(source, type, outcome)));
  } else if (cfg.quiet) {
    if (outcome.status === 'ok') console.log(outcome.pageCount);
    else console.error(`${source}: ${outcome.error ?? outcome.status}`);
  } else if (outcome.status === 'ok') {
    console.log(formatDocumentLine(source, type, outcome));
  } else {
    console.error(`${source} · error: ${outcome.error ?? outcome.status}`);
  }
}

export async function run(inputs: string[], cfg: Config): Promise<number> {
  let exitCode = 0;
  for (const arg of inputs) {
    const kind = classifyInput(arg);
    if (kind.kind === 'unsupported') {
      console.error(`Unsupported input: ${arg} (expected .csv/.xlsx, .pdf/.docx/.pptx, or a URL)`);
      exitCode = 1;
      continue;
    }
    try {
      if (kind.kind === 'spreadsheet') {
        await runSpreadsheet(kind.path, cfg);
      } else {
        const result = await countDocument(kind.source, kind.remote, cfg);
        reportDocument(kind.source, result, cfg);
        if (result.outcome.status !== 'ok') exitCode = 1;
      }
    } catch (err) {
      console.error(`${arg}: ${err instanceof Error ? err.message : String(err)}`);
      exitCode = 1;
    }
  }
  return exitCode;
}
