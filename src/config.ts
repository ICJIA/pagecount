export interface FilterSpec {
  column: string;          // header name or 1-based index, as given or defaulted
  columnExplicit: boolean; // true only when the user passed --filter-column
  values: string[];        // trimmed, lowercased, de-duped, non-empty
}

export interface Config {
  output?: string;
  column?: string;
  countColumn: string;
  suffix: string;
  json: boolean;
  quiet: boolean;
  concurrency: number;
  timeout: number; // milliseconds
  maxSize: number; // bytes
  docxRender: boolean;
  allowPrivateHosts: boolean;
  filter: FilterSpec | null; // null only when --no-filter
}

export interface RawOptions {
  output?: string;
  column?: string;
  countColumn?: string;
  suffix?: string;
  json?: boolean;
  quiet?: boolean;
  concurrency?: string | number;
  timeout?: string | number;
  maxSize?: string | number;
  docxRender?: boolean;
  allowPrivateHosts?: boolean;
  filterColumn?: string;
  filterValue?: string;
  noFilter?: boolean;
}

export const DEFAULTS = {
  countColumn: 'programmatic_page_count',
  suffix: 'pagecount',
  concurrency: 8,
  timeoutSec: 30,
  maxSizeMb: 100,
  filterColumn: 'Recommendation',
  filterValue: 'remediate',
} as const;

function positive(value: string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected a positive number, got: ${String(value)}`);
  }
  return n;
}

// Normalize the raw filter options into a FilterSpec, or null when filtering is off.
function buildFilter(raw: RawOptions): FilterSpec | null {
  if (raw.noFilter) return null;
  const explicit = raw.filterColumn !== undefined && raw.filterColumn.trim() !== '';
  const column = explicit ? raw.filterColumn!.trim() : DEFAULTS.filterColumn;
  const rawValue = raw.filterValue ?? DEFAULTS.filterValue;
  const values = [
    ...new Set(rawValue.split(',').map((v) => v.trim().toLowerCase()).filter((v) => v !== '')),
  ];
  if (values.length === 0) {
    throw new Error('--filter-value must contain at least one non-empty value');
  }
  return { column, columnExplicit: explicit, values };
}

export function resolveConfig(raw: RawOptions): Config {
  const suffix = raw.suffix ?? DEFAULTS.suffix;
  if (/[/\\]|\.\./.test(suffix)) {
    throw new Error('--suffix may not contain path separators or ".."');
  }
  return {
    output: raw.output,
    column: raw.column,
    countColumn: raw.countColumn ?? DEFAULTS.countColumn,
    suffix,
    json: raw.json ?? false,
    quiet: raw.quiet ?? false,
    concurrency: Math.min(positive(raw.concurrency, DEFAULTS.concurrency), 64),
    timeout: positive(raw.timeout, DEFAULTS.timeoutSec) * 1000,
    maxSize: positive(raw.maxSize, DEFAULTS.maxSizeMb) * 1024 * 1024,
    docxRender: raw.docxRender ?? false,
    allowPrivateHosts: raw.allowPrivateHosts ?? false,
    filter: buildFilter(raw),
  };
}
