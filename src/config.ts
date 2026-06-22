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
}

export const DEFAULTS = {
  countColumn: 'programmatic_page_count',
  suffix: 'pagecount',
  concurrency: 8,
  timeoutSec: 30,
  maxSizeMb: 100,
} as const;

function positive(value: string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected a positive number, got: ${String(value)}`);
  }
  return n;
}

export function resolveConfig(raw: RawOptions): Config {
  return {
    output: raw.output,
    column: raw.column,
    countColumn: raw.countColumn ?? DEFAULTS.countColumn,
    suffix: raw.suffix ?? DEFAULTS.suffix,
    json: raw.json ?? false,
    quiet: raw.quiet ?? false,
    concurrency: positive(raw.concurrency, DEFAULTS.concurrency),
    timeout: positive(raw.timeout, DEFAULTS.timeoutSec) * 1000,
    maxSize: positive(raw.maxSize, DEFAULTS.maxSizeMb) * 1024 * 1024,
    docxRender: raw.docxRender ?? false,
    allowPrivateHosts: raw.allowPrivateHosts ?? false,
  };
}
