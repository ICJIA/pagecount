import { resolve, dirname, basename, extname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Config } from './config';
import { classifyInput } from './input';
import { processSpreadsheet } from './spreadsheet/process';
import { countDocument } from './document';
import {
  formatSpreadsheetSummary, buildSpreadsheetJson, formatDocumentLine, buildDocumentJson,
} from './report';

export function outputPathFor(inputPath: string, cfg: Config): string {
  const abs = resolve(inputPath);
  const ext = extname(abs);
  const base = basename(abs, ext);
  const name = cfg.suffix ? `${base}-${cfg.suffix}${ext}` : `${base}${ext}`;
  const dir = cfg.output ?? join(dirname(abs), '.pagecount-output');
  return join(dir, name);
}

async function runSpreadsheet(path: string, cfg: Config): Promise<void> {
  const { loaded, results, summary, counts } = await processSpreadsheet(path, cfg);
  const notes = results.map((r) => (r.status === 'ok' ? '' : r.status));
  const outPath = outputPathFor(path, cfg);
  await mkdir(dirname(outPath), { recursive: true });
  await loaded.write(outPath, [
    { header: cfg.countColumn, values: counts },
    { header: `${cfg.countColumn}_notes`, values: notes },
  ]);
  console.log(formatSpreadsheetSummary(path, outPath, summary));
  if (cfg.json) {
    const jsonPath = outPath.replace(/\.[^.]+$/, '.json');
    await writeFile(jsonPath, JSON.stringify(buildSpreadsheetJson(path, outPath, results, summary), null, 2));
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
