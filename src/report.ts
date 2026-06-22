import type { RowResult, Summary, CountOutcome, FileType } from './types';

export function summarize(results: RowResult[]): Summary {
  const summary: Summary = { total: results.length, counted: 0, noUrl: 0, failed: 0, byError: {} };
  for (const r of results) {
    if (r.status === 'ok') summary.counted++;
    else if (r.status === 'no-url') summary.noUrl++;
    else {
      summary.failed++;
      summary.byError[r.status] = (summary.byError[r.status] ?? 0) + 1;
    }
  }
  return summary;
}

export function formatSpreadsheetSummary(input: string, outputPath: string, summary: Summary): string {
  const lines = [
    `${input}  →  ${outputPath}`,
    `  ${summary.total} rows · ${summary.counted} counted · ${summary.noUrl} no-url · ${summary.failed} failed`,
  ];
  const errs = Object.entries(summary.byError).map(([k, v]) => `${v} ${k}`).join(' · ');
  if (errs) lines.push(`    failed: ${errs}`);
  return lines.join('\n');
}

export function buildSpreadsheetJson(
  input: string, outputPath: string, results: RowResult[], summary: Summary,
): object {
  return { input, output: outputPath, summary, rows: results };
}

export function formatDocumentLine(source: string, type: FileType | null, outcome: CountOutcome): string {
  const unit = outcome.pageCount === 1 ? 'page' : 'pages';
  const rendered = outcome.rendered ? ' (rendered)' : '';
  return `${source} · ${type ?? 'unknown'} · ${outcome.pageCount} ${unit}${rendered}`;
}

export function buildDocumentJson(source: string, type: FileType | null, outcome: CountOutcome): object {
  return {
    file: source,
    type,
    pageCount: outcome.pageCount,
    status: outcome.status,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

// Value for the page_count_notes column: the failure status for non-ok rows, an
// "estimate" caveat for counted DOCX (pagination is renderer/font-dependent), and
// empty for exact PDF/PPTX counts.
export function rowNote(r: RowResult): string {
  if (r.status !== 'ok') return r.status;
  if (r.type === 'docx') return 'estimate (docx page count depends on fonts/margins)';
  return '';
}
