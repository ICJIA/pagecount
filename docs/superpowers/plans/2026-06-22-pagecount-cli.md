# PageCount CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pagecount`, a Node CLI that adds a `PageCount` column to a spreadsheet of public document URLs (PDF/DOCX/PPTX), and that also counts a single local/remote document on demand.

**Architecture:** A small, bottom-up set of focused modules — pure helpers (types, url/input classification, config) → I/O units (zip, fetch, spreadsheet read/write) → page counters (one per format, behind a dispatch) → two orchestration modes (spreadsheet, document) → a thin `commander` CLI. Each module has one responsibility and is unit-tested in isolation; counters and the pipeline are tested with fixtures generated in-test (no committed binaries).

**Tech Stack:** Node 20+, TypeScript (ESM), `commander`, `csv-parse`/`csv-stringify`, `exceljs`, `pdf-lib`, `fflate`, `fast-xml-parser`, `p-limit`; built with `tsup`, tested with `vitest`.

## Global Constraints

Every task implicitly includes these. Exact values copied from the spec (`docs/superpowers/specs/2026-06-22-pagecount-cli-design.md`):

- **Runtime floor:** Node.js **20+** (uses built-in `fetch`). `engines.node >= 20`.
- **Language/format:** TypeScript, ESM (`"type": "module"`), `moduleResolution: Bundler` (extensionless imports).
- **Package name:** `@icjia/pagecount`; **bin name:** `pagecount` → `dist/cli.js`.
- **Supported document types:** `pdf`, `docx`, `pptx` only. **Spreadsheet types:** `csv`, `xlsx` only.
- **Output dir:** `.pagecount-output` beside each input file (created if missing, reused if present); `--output <dir>` forces one shared dir.
- **Output filename:** `<name>-<suffix><ext>`; suffix default `pagecount`; `--suffix ""` disables it.
- **Added column:** header `PageCount` (default; `--count-column`), appended as the **last** column.
- **Defaults:** concurrency `8`, timeout `30`s, max-size `100`MB.
- **Blank rule (spreadsheet mode):** every non-`ok` status → blank cell; failures tallied in the summary.
- **Exit codes:** spreadsheet mode → `0` unless the spreadsheet can't be read or no URL column is found; document mode → non-zero if a count fails.
- **Commits:** conventional-commit messages, **no AI co-author trailer** (user's global preference). Commit at the end of every task.

## File structure

```
package.json            # deps, scripts, bin, engines
tsconfig.json           # strict ESM TS
tsup.config.ts          # bundle src/cli.ts → dist/cli.js (+ shebang)
vitest.config.ts        # node test env
src/
  types.ts              # FileType, Status, CountOutcome, RowResult, InputKind, Summary
  errors.ts             # CountError; statusFromHttp(); statusFromFetchError()
  config.ts             # Config, RawOptions, DEFAULTS, resolveConfig()
  zip.ts                # loadZip(); loadZipFromBytes(); entryText()
  url.ts                # isFullUrl(); typeFromExtension(); hasUnsupportedExtension();
                        #   typeFromContentType(); sniffType()
  input.ts              # classifyInput(arg) → InputKind
  fetch.ts              # fetchToTempFile(url, cfg)
  pool.ts               # mapWithConcurrency()
  detectColumn.ts       # detectUrlColumn(table, override?)
  counters/
    pdf.ts              # countPdf(filePath)
    pptx.ts             # countPptx(filePath)
    docx.ts             # countDocx(filePath, cfg, deps?)
    index.ts            # countByType(type, filePath, cfg)
  render/
    libreoffice.ts      # findLibreOffice(); renderDocxToPdf(filePath)
  spreadsheet/
    csv.ts              # readCsv(); writeCsv()
    xlsx.ts             # readXlsx(); writeXlsx()
    read.ts             # readSpreadsheet(path) → LoadedSpreadsheet (dispatch)
    process.ts          # processSpreadsheet(path, cfg)
  report.ts             # summarize(); format/build for spreadsheet & document
  document.ts           # countDocument(source, remote, cfg)
  run.ts                # run(inputs, cfg) → exit code
  cli.ts                # commander → resolveConfig → run → exit
test/
  *.test.ts             # one suite per module
  helpers/fixtures.ts   # in-test generators: pdf, pptx, docx, csv, xlsx, zip
```

---

### Task 1: Project scaffolding & toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- Create: `test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` / `npm run build` / `npm run typecheck` toolchain for all later tasks.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@icjia/pagecount",
  "version": "0.1.0",
  "description": "Add exact page counts to a spreadsheet of document URLs, or check a single file.",
  "type": "module",
  "bin": { "pagecount": "dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "csv-parse": "^5.5.6",
    "csv-stringify": "^6.5.1",
    "exceljs": "^4.4.0",
    "fast-xml-parser": "^4.4.1",
    "fflate": "^0.8.2",
    "p-limit": "^6.1.0",
    "pdf-lib": "^1.17.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsup": "^8.2.4",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 5: Create `test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs a test', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Run the smoke test**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript CLI project (tsup, vitest)"
```

---

### Task 2: Shared types & error taxonomy

**Files:**
- Create: `src/types.ts`
- Create: `src/errors.ts`
- Test: `test/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FileType = 'pdf' | 'docx' | 'pptx'`
  - `Status` (11 literals, see below)
  - `interface CountOutcome { pageCount: number | null; status: Status; error?: string; rendered?: boolean }`
  - `interface RowResult { row: number; url: string | null; type: FileType | null; pageCount: number | null; status: Status; error?: string }`
  - `type InputKind` (discriminated union: spreadsheet | document | unsupported)
  - `interface Summary { total: number; counted: number; noUrl: number; failed: number; byError: Record<string, number> }`
  - `class CountError extends Error { status: Status }`
  - `statusFromHttp(code: number): Status`
  - `statusFromFetchError(err: unknown): Status`

- [ ] **Step 1: Write `src/types.ts`** (pure type declarations — no test needed)

```ts
export type FileType = 'pdf' | 'docx' | 'pptx';

export type Status =
  | 'ok'
  | 'no-url'
  | 'unsupported'
  | 'not-found'
  | 'http-error'
  | 'timeout'
  | 'network-error'
  | 'too-large'
  | 'corrupt'
  | 'encrypted'
  | 'no-page-data';

export interface CountOutcome {
  pageCount: number | null;
  status: Status;
  error?: string;
  rendered?: boolean;
}

export interface RowResult {
  row: number; // 1-based source row (row 1 = header)
  url: string | null;
  type: FileType | null;
  pageCount: number | null;
  status: Status;
  error?: string;
}

export type InputKind =
  | { kind: 'spreadsheet'; path: string }
  | { kind: 'document'; source: string; remote: boolean }
  | { kind: 'unsupported'; arg: string };

export interface Summary {
  total: number;
  counted: number;
  noUrl: number;
  failed: number;
  byError: Record<string, number>;
}
```

- [ ] **Step 2: Write the failing test `test/errors.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { CountError, statusFromHttp, statusFromFetchError } from '../src/errors';

describe('statusFromHttp', () => {
  it('maps 404 and 410 to not-found', () => {
    expect(statusFromHttp(404)).toBe('not-found');
    expect(statusFromHttp(410)).toBe('not-found');
  });
  it('maps other non-2xx to http-error', () => {
    expect(statusFromHttp(500)).toBe('http-error');
    expect(statusFromHttp(403)).toBe('http-error');
  });
});

describe('statusFromFetchError', () => {
  it('maps AbortError/TimeoutError to timeout', () => {
    const a = new Error('aborted'); a.name = 'AbortError';
    const t = new Error('timed out'); t.name = 'TimeoutError';
    expect(statusFromFetchError(a)).toBe('timeout');
    expect(statusFromFetchError(t)).toBe('timeout');
  });
  it('passes through a CountError status', () => {
    expect(statusFromFetchError(new CountError('too-large'))).toBe('too-large');
  });
  it('defaults unknown errors to network-error', () => {
    expect(statusFromFetchError(new Error('boom'))).toBe('network-error');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/errors.test.ts`
Expected: FAIL — cannot find module `../src/errors`.

- [ ] **Step 4: Write `src/errors.ts`**

```ts
import type { Status } from './types';

export class CountError extends Error {
  constructor(public status: Status, message?: string) {
    super(message ?? status);
    this.name = 'CountError';
  }
}

export function statusFromHttp(code: number): Status {
  if (code === 404 || code === 410) return 'not-found';
  return 'http-error';
}

export function statusFromFetchError(err: unknown): Status {
  if (err instanceof CountError) return err.status;
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  return 'network-error';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/errors.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/errors.ts test/errors.test.ts
git commit -m "feat: add shared types and error-status taxonomy"
```

---

### Task 3: Config resolution

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Config { output?: string; column?: string; countColumn: string; suffix: string; json: boolean; quiet: boolean; concurrency: number; timeout: number /* ms */; maxSize: number /* bytes */; docxRender: boolean }`
  - `interface RawOptions { ...optional string|number|boolean fields... }`
  - `const DEFAULTS`
  - `resolveConfig(raw: RawOptions): Config`

- [ ] **Step 1: Write the failing test `test/config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/config';

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
    const c = resolveConfig({});
    expect(c.countColumn).toBe('PageCount');
    expect(c.suffix).toBe('pagecount');
    expect(c.concurrency).toBe(8);
    expect(c.timeout).toBe(30_000);          // seconds → ms
    expect(c.maxSize).toBe(100 * 1024 * 1024); // MB → bytes
    expect(c.json).toBe(false);
    expect(c.quiet).toBe(false);
    expect(c.docxRender).toBe(false);
  });

  it('keeps an explicit empty suffix', () => {
    expect(resolveConfig({ suffix: '' }).suffix).toBe('');
  });

  it('parses numeric strings from the CLI', () => {
    const c = resolveConfig({ concurrency: '16', timeout: '5', maxSize: '10' });
    expect(c.concurrency).toBe(16);
    expect(c.timeout).toBe(5_000);
    expect(c.maxSize).toBe(10 * 1024 * 1024);
  });

  it('rejects non-positive numbers', () => {
    expect(() => resolveConfig({ concurrency: '0' })).toThrow();
    expect(() => resolveConfig({ timeout: 'abc' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot find module `../src/config`.

- [ ] **Step 3: Write `src/config.ts`**

```ts
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
}

export const DEFAULTS = {
  countColumn: 'PageCount',
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
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add config resolution with defaults and validation"
```

---

### Task 4: ZIP helper

**Files:**
- Create: `src/zip.ts`
- Create: `test/helpers/fixtures.ts` (start the shared fixture helpers here)
- Test: `test/zip.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ZipEntries = Record<string, Uint8Array>`
  - `loadZip(filePath: string): Promise<ZipEntries>`
  - `loadZipFromBytes(bytes: Uint8Array): ZipEntries`
  - `entryText(zip: ZipEntries, name: string): string | null`
  - In `test/helpers/fixtures.ts`: `zipBytes(files: Record<string, string>): Uint8Array`

- [ ] **Step 1: Create `test/helpers/fixtures.ts`**

```ts
import { zipSync, strToU8 } from 'fflate';

/** Build an in-memory ZIP from a map of path → text content. */
export function zipBytes(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  return zipSync(entries);
}
```

- [ ] **Step 2: Write the failing test `test/zip.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadZip, loadZipFromBytes, entryText } from '../src/zip';
import { zipBytes } from './helpers/fixtures';

describe('zip helper', () => {
  it('reads entries from bytes', () => {
    const zip = loadZipFromBytes(zipBytes({ 'a/b.xml': '<x>1</x>' }));
    expect(entryText(zip, 'a/b.xml')).toBe('<x>1</x>');
    expect(entryText(zip, 'missing')).toBeNull();
  });

  it('reads entries from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pc-'));
    const file = join(dir, 'sample.zip');
    await writeFile(file, zipBytes({ 'hello.txt': 'hi' }));
    const zip = await loadZip(file);
    expect(entryText(zip, 'hello.txt')).toBe('hi');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/zip.test.ts`
Expected: FAIL — cannot find module `../src/zip`.

- [ ] **Step 4: Write `src/zip.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

export type ZipEntries = Record<string, Uint8Array>;

export async function loadZip(filePath: string): Promise<ZipEntries> {
  const buf = await readFile(filePath);
  return unzipSync(new Uint8Array(buf));
}

export function loadZipFromBytes(bytes: Uint8Array): ZipEntries {
  return unzipSync(bytes);
}

export function entryText(zip: ZipEntries, name: string): string | null {
  const entry = zip[name];
  return entry ? strFromU8(entry) : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/zip.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/zip.ts test/zip.test.ts test/helpers/fixtures.ts
git commit -m "feat: add zip read helper and in-test zip fixture builder"
```

---

### Task 5: URL & content classification

**Files:**
- Create: `src/url.ts`
- Test: `test/url.test.ts`

**Interfaces:**
- Consumes: `FileType` (Task 2); `loadZipFromBytes` (Task 4); `zipBytes` fixture (Task 4).
- Produces:
  - `isFullUrl(value: string): boolean`
  - `typeFromExtension(s: string): FileType | null`
  - `hasUnsupportedExtension(s: string): boolean`
  - `typeFromContentType(ct: string | null): FileType | null`
  - `sniffType(filePath: string): Promise<FileType | null>`

- [ ] **Step 1: Write the failing test `test/url.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isFullUrl, typeFromExtension, hasUnsupportedExtension, typeFromContentType, sniffType,
} from '../src/url';
import { zipBytes } from './helpers/fixtures';

describe('isFullUrl', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(isFullUrl('https://x.org/a.pdf')).toBe(true);
    expect(isFullUrl('  http://x.org/a ')).toBe(true);
  });
  it('rejects blanks, relative paths, and other schemes', () => {
    expect(isFullUrl('')).toBe(false);
    expect(isFullUrl('a.pdf')).toBe(false);
    expect(isFullUrl('/files/a.pdf')).toBe(false);
    expect(isFullUrl('ftp://x.org/a.pdf')).toBe(false);
  });
});

describe('typeFromExtension / hasUnsupportedExtension', () => {
  it('reads the extension, ignoring query/fragment', () => {
    expect(typeFromExtension('https://x.org/a.PDF?token=1')).toBe('pdf');
    expect(typeFromExtension('/docs/report.docx')).toBe('docx');
    expect(typeFromExtension('deck.pptx#2')).toBe('pptx');
    expect(typeFromExtension('https://x.org/download?id=9')).toBeNull();
  });
  it('flags a present, unsupported extension', () => {
    expect(hasUnsupportedExtension('photo.jpg')).toBe(true);
    expect(hasUnsupportedExtension('a.pdf')).toBe(false);
    expect(hasUnsupportedExtension('https://x.org/download?id=9')).toBe(false);
  });
});

describe('typeFromContentType', () => {
  it('maps known content types', () => {
    expect(typeFromContentType('application/pdf')).toBe('pdf');
    expect(typeFromContentType(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
    expect(typeFromContentType(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation; charset=x'))
      .toBe('pptx');
    expect(typeFromContentType(null)).toBeNull();
    expect(typeFromContentType('text/html')).toBeNull();
  });
});

describe('sniffType', () => {
  async function tmp(bytes: Uint8Array): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'pc-'));
    const file = join(dir, 'f.bin');
    await writeFile(file, bytes);
    return file;
  }
  it('detects a PDF by header', async () => {
    expect(await sniffType(await tmp(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])))).toBe('pdf');
  });
  it('detects pptx vs docx inside a zip', async () => {
    expect(await sniffType(await tmp(zipBytes({ 'ppt/presentation.xml': '<p/>' })))).toBe('pptx');
    expect(await sniffType(await tmp(zipBytes({ 'word/document.xml': '<w/>' })))).toBe('docx');
  });
  it('returns null for unknown content', async () => {
    expect(await sniffType(await tmp(new Uint8Array([1, 2, 3, 4])))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/url.test.ts`
Expected: FAIL — cannot find module `../src/url`.

- [ ] **Step 3: Write `src/url.ts`**

```ts
import { readFile } from 'node:fs/promises';
import type { FileType } from './types';
import { loadZipFromBytes } from './zip';

const EXT_MAP: Record<string, FileType> = { pdf: 'pdf', docx: 'docx', pptx: 'pptx' };

export function isFullUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function extensionOf(s: string): string | null {
  const noQuery = s.split(/[?#]/)[0] ?? s;
  const seg = noQuery.split('/').pop() ?? '';
  const dot = seg.lastIndexOf('.');
  if (dot <= 0 || dot === seg.length - 1) return null;
  return seg.slice(dot + 1).toLowerCase();
}

export function typeFromExtension(s: string): FileType | null {
  const ext = extensionOf(s);
  return ext ? (EXT_MAP[ext] ?? null) : null;
}

export function hasUnsupportedExtension(s: string): boolean {
  const ext = extensionOf(s);
  return ext !== null && !(ext in EXT_MAP);
}

export function typeFromContentType(ct: string | null): FileType | null {
  if (!ct) return null;
  const v = ct.toLowerCase();
  if (v.includes('application/pdf')) return 'pdf';
  if (v.includes('wordprocessingml.document')) return 'docx';
  if (v.includes('presentationml.presentation')) return 'pptx';
  return null;
}

export async function sniffType(filePath: string): Promise<FileType | null> {
  const bytes = new Uint8Array(await readFile(filePath));
  if (bytes.length >= 4 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf'; // %PDF
  }
  if (bytes.length >= 4 &&
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    try {
      const zip = loadZipFromBytes(bytes);
      if ('ppt/presentation.xml' in zip) return 'pptx';
      if ('word/document.xml' in zip) return 'docx';
    } catch {
      return null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/url.ts test/url.test.ts
git commit -m "feat: add url validation and file-type classification"
```

---

### Task 6: Input-kind classification

**Files:**
- Create: `src/input.ts`
- Test: `test/input.test.ts`

**Interfaces:**
- Consumes: `InputKind` (Task 2); `isFullUrl` (Task 5).
- Produces: `classifyInput(arg: string): InputKind`

- [ ] **Step 1: Write the failing test `test/input.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { classifyInput } from '../src/input';

describe('classifyInput', () => {
  it('classifies spreadsheets', () => {
    expect(classifyInput('data.csv')).toEqual({ kind: 'spreadsheet', path: 'data.csv' });
    expect(classifyInput('/a/b/report.XLSX')).toEqual({ kind: 'spreadsheet', path: '/a/b/report.XLSX' });
  });
  it('classifies local documents', () => {
    expect(classifyInput('file.pdf')).toEqual({ kind: 'document', source: 'file.pdf', remote: false });
    expect(classifyInput('deck.pptx')).toEqual({ kind: 'document', source: 'deck.pptx', remote: false });
  });
  it('classifies URLs as remote documents (even .csv URLs)', () => {
    expect(classifyInput('https://x.org/a.pdf')).toEqual({ kind: 'document', source: 'https://x.org/a.pdf', remote: true });
    expect(classifyInput('https://x.org/data.csv')).toEqual({ kind: 'document', source: 'https://x.org/data.csv', remote: true });
  });
  it('flags unsupported inputs', () => {
    expect(classifyInput('notes.txt')).toEqual({ kind: 'unsupported', arg: 'notes.txt' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/input.test.ts`
Expected: FAIL — cannot find module `../src/input`.

- [ ] **Step 3: Write `src/input.ts`**

```ts
import type { InputKind } from './types';
import { isFullUrl } from './url';

const SPREADSHEET_EXT = /\.(csv|xlsx)$/i;
const DOC_EXT = /\.(pdf|docx|pptx)$/i;

export function classifyInput(arg: string): InputKind {
  if (isFullUrl(arg)) return { kind: 'document', source: arg, remote: true };
  if (SPREADSHEET_EXT.test(arg)) return { kind: 'spreadsheet', path: arg };
  if (DOC_EXT.test(arg)) return { kind: 'document', source: arg, remote: false };
  return { kind: 'unsupported', arg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/input.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/input.ts test/input.test.ts
git commit -m "feat: add input-kind classification"
```

---

### Task 7: PDF counter

**Files:**
- Create: `src/counters/pdf.ts`
- Modify: `test/helpers/fixtures.ts` (add `pdfBytes`, `writeTemp`)
- Test: `test/counters/pdf.test.ts`

**Interfaces:**
- Consumes: `CountOutcome` (Task 2).
- Produces: `countPdf(filePath: string): Promise<CountOutcome>`; fixtures `pdfBytes(pages: number): Promise<Uint8Array>` and `writeTemp(bytes, name?): Promise<string>`.

- [ ] **Step 1: Add fixture helpers to `test/helpers/fixtures.ts`**

```ts
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
```

- [ ] **Step 2: Write the failing test `test/counters/pdf.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { countPdf } from '../../src/counters/pdf';
import { pdfBytes, writeTemp } from '../helpers/fixtures';

describe('countPdf', () => {
  it('counts pages in a valid PDF', async () => {
    const file = await writeTemp(await pdfBytes(3), 'a.pdf');
    expect(await countPdf(file)).toMatchObject({ pageCount: 3, status: 'ok' });
  });
  it('reports corrupt for non-PDF bytes', async () => {
    const file = await writeTemp(new Uint8Array([1, 2, 3, 4]), 'a.pdf');
    const out = await countPdf(file);
    expect(out.pageCount).toBeNull();
    expect(out.status).toBe('corrupt');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/counters/pdf.test.ts`
Expected: FAIL — cannot find module `../../src/counters/pdf`.

- [ ] **Step 4: Write `src/counters/pdf.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import type { CountOutcome } from '../types';

export async function countPdf(filePath: string): Promise<CountOutcome> {
  try {
    const bytes = await readFile(filePath);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return { pageCount: doc.getPageCount(), status: 'ok' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { pageCount: null, status: /encrypt/i.test(msg) ? 'encrypted' : 'corrupt', error: msg };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/counters/pdf.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/counters/pdf.ts test/counters/pdf.test.ts test/helpers/fixtures.ts
git commit -m "feat: add PDF page counter"
```

---

### Task 8: PPTX counter

**Files:**
- Create: `src/counters/pptx.ts`
- Modify: `test/helpers/fixtures.ts` (add `pptxBytes`)
- Test: `test/counters/pptx.test.ts`

**Interfaces:**
- Consumes: `CountOutcome` (Task 2); `loadZip`, `entryText` (Task 4); `zipBytes` (Task 4).
- Produces: `countPptx(filePath: string): Promise<CountOutcome>`; fixture `pptxBytes(slides: number): Uint8Array`.

- [ ] **Step 1: Add `pptxBytes` to `test/helpers/fixtures.ts`**

```ts
export function pptxBytes(slides: number): Uint8Array {
  const ids = Array.from({ length: slides }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  const xml =
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r">` +
    `<p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`;
  return zipBytes({ 'ppt/presentation.xml': xml });
}
```

- [ ] **Step 2: Write the failing test `test/counters/pptx.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { countPptx } from '../../src/counters/pptx';
import { pptxBytes, writeTemp } from '../helpers/fixtures';
import { zipBytes } from '../helpers/fixtures';

describe('countPptx', () => {
  it('counts slides from presentation.xml (many)', async () => {
    const file = await writeTemp(pptxBytes(5), 'deck.pptx');
    expect(await countPptx(file)).toMatchObject({ pageCount: 5, status: 'ok' });
  });
  it('counts a single slide (non-array sldId)', async () => {
    const file = await writeTemp(pptxBytes(1), 'deck.pptx');
    expect(await countPptx(file)).toMatchObject({ pageCount: 1, status: 'ok' });
  });
  it('falls back to counting slide parts', async () => {
    const file = await writeTemp(zipBytes({
      'ppt/slides/slide1.xml': '<s/>',
      'ppt/slides/slide2.xml': '<s/>',
    }), 'deck.pptx');
    expect(await countPptx(file)).toMatchObject({ pageCount: 2, status: 'ok' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/counters/pptx.test.ts`
Expected: FAIL — cannot find module `../../src/counters/pptx`.

- [ ] **Step 4: Write `src/counters/pptx.ts`**

```ts
import { XMLParser } from 'fast-xml-parser';
import type { CountOutcome } from '../types';
import { loadZip, entryText } from '../zip';

function countSldIds(xml: string): number {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const doc = parser.parse(xml) as Record<string, any>;
  const ids = doc?.presentation?.sldIdLst?.sldId;
  if (!ids) return 0;
  return Array.isArray(ids) ? ids.length : 1;
}

export async function countPptx(filePath: string): Promise<CountOutcome> {
  try {
    const zip = await loadZip(filePath);
    const xml = entryText(zip, 'ppt/presentation.xml');
    if (xml) {
      const n = countSldIds(xml);
      if (n > 0) return { pageCount: n, status: 'ok' };
    }
    const slides = Object.keys(zip).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    if (slides.length > 0) return { pageCount: slides.length, status: 'ok' };
    return { pageCount: null, status: 'corrupt', error: 'no slides found' };
  } catch (err) {
    return { pageCount: null, status: 'corrupt', error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/counters/pptx.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/counters/pptx.ts test/counters/pptx.test.ts test/helpers/fixtures.ts
git commit -m "feat: add PPTX slide counter"
```

---

### Task 9: LibreOffice render helper

**Files:**
- Create: `src/render/libreoffice.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `findLibreOffice(): string | null` (honors `PAGECOUNT_SOFFICE` env override)
  - `renderDocxToPdf(filePath: string, soffice?: string | null): Promise<string>` (path to produced PDF)

> Note: LibreOffice can't be assumed present in CI, so the conversion path is covered by a guarded integration test (`it.skipIf`). Detection and the "not found" error path are unit-tested directly. The DOCX counter (Task 10) tests the fallback logic via dependency injection, so full coverage does not require LibreOffice.

- [ ] **Step 1: Write the failing test `test/render.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { findLibreOffice, renderDocxToPdf } from '../src/render/libreoffice';

describe('findLibreOffice', () => {
  it('returns a string or null without throwing', () => {
    const r = findLibreOffice();
    expect(r === null || typeof r === 'string').toBe(true);
  });
});

describe('renderDocxToPdf', () => {
  it('throws when no LibreOffice is available', async () => {
    await expect(renderDocxToPdf('/nope/x.docx', null)).rejects.toThrow(/LibreOffice/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — cannot find module `../src/render/libreoffice`.

- [ ] **Step 3: Write `src/render/libreoffice.ts`**

```ts
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const CANDIDATES = [
  process.env.PAGECOUNT_SOFFICE,
  'soffice',
  'libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter((c): c is string => Boolean(c));

export function findLibreOffice(): string | null {
  for (const cmd of CANDIDATES) {
    if (cmd.includes('/')) {
      if (existsSync(cmd)) return cmd;
      continue;
    }
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (r.status === 0) return cmd;
  }
  return null;
}

export async function renderDocxToPdf(
  filePath: string,
  soffice: string | null = findLibreOffice(),
): Promise<string> {
  if (!soffice) throw new Error('LibreOffice not found');
  const outDir = await mkdtemp(join(tmpdir(), 'pc-render-'));
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`soffice exited with code ${code}`))));
  });
  return join(outDir, basename(filePath).replace(/\.[^.]+$/, '') + '.pdf');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/libreoffice.ts test/render.test.ts
git commit -m "feat: add LibreOffice detection and docx-to-pdf render"
```

---

### Task 10: DOCX counter (hybrid)

**Files:**
- Create: `src/counters/docx.ts`
- Modify: `test/helpers/fixtures.ts` (add `docxBytes`)
- Test: `test/counters/docx.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 3); `CountOutcome` (Task 2); `loadZip`/`entryText` (Task 4); `findLibreOffice`/`renderDocxToPdf` (Task 9); `countPdf` (Task 7).
- Produces:
  - `interface DocxDeps { findRenderer: () => string | null; render: (filePath: string, soffice: string) => Promise<string>; countPdf: (filePath: string) => Promise<CountOutcome> }`
  - `countDocx(filePath: string, cfg: Config, deps?: DocxDeps): Promise<CountOutcome>`

- [ ] **Step 1: Add `docxBytes` to `test/helpers/fixtures.ts`**

```ts
export function docxBytes(opts: { pages?: number } = {}): Uint8Array {
  const files: Record<string, string> = { 'word/document.xml': '<w:document/>' };
  if (opts.pages != null) {
    files['docProps/app.xml'] =
      `<?xml version="1.0"?><Properties xmlns="ext"><Pages>${opts.pages}</Pages></Properties>`;
  }
  return zipBytes(files);
}
```

- [ ] **Step 2: Write the failing test `test/counters/docx.test.ts`**

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/counters/docx.test.ts`
Expected: FAIL — cannot find module `../../src/counters/docx`.

- [ ] **Step 4: Write `src/counters/docx.ts`**

```ts
import { XMLParser } from 'fast-xml-parser';
import type { Config } from '../config';
import type { CountOutcome } from '../types';
import { loadZip, entryText } from '../zip';
import { findLibreOffice, renderDocxToPdf } from '../render/libreoffice';
import { countPdf } from './pdf';

export interface DocxDeps {
  findRenderer: () => string | null;
  render: (filePath: string, soffice: string) => Promise<string>;
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
    try {
      const pdf = await deps.render(filePath, soffice);
      const out = await deps.countPdf(pdf);
      if (out.status === 'ok') return { ...out, rendered: true };
    } catch {
      // fall through to metadata / no-page-data
    }
  }

  if (metadata !== null) return { pageCount: metadata, status: 'ok' };
  return { pageCount: null, status: 'no-page-data' };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/counters/docx.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/counters/docx.ts test/counters/docx.test.ts test/helpers/fixtures.ts
git commit -m "feat: add hybrid DOCX counter (metadata + render fallback)"
```

---

### Task 11: Counter dispatch

**Files:**
- Create: `src/counters/index.ts`
- Test: `test/counters/index.test.ts`

**Interfaces:**
- Consumes: `FileType`/`CountOutcome` (Task 2); `Config` (Task 3); `countPdf`/`countPptx`/`countDocx` (Tasks 7,8,10).
- Produces: `countByType(type: FileType, filePath: string, cfg: Config): Promise<CountOutcome>`

- [ ] **Step 1: Write the failing test `test/counters/index.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { countByType } from '../../src/counters/index';
import { resolveConfig } from '../../src/config';
import { pdfBytes, pptxBytes, writeTemp } from '../helpers/fixtures';

const cfg = resolveConfig({});

describe('countByType', () => {
  it('routes pdf', async () => {
    const file = await writeTemp(await pdfBytes(2), 'a.pdf');
    expect(await countByType('pdf', file, cfg)).toMatchObject({ pageCount: 2, status: 'ok' });
  });
  it('routes pptx', async () => {
    const file = await writeTemp(pptxBytes(3), 'a.pptx');
    expect(await countByType('pptx', file, cfg)).toMatchObject({ pageCount: 3, status: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/counters/index.test.ts`
Expected: FAIL — cannot find module `../../src/counters/index`.

- [ ] **Step 3: Write `src/counters/index.ts`**

```ts
import type { FileType, CountOutcome } from '../types';
import type { Config } from '../config';
import { countPdf } from './pdf';
import { countPptx } from './pptx';
import { countDocx } from './docx';

export function countByType(type: FileType, filePath: string, cfg: Config): Promise<CountOutcome> {
  switch (type) {
    case 'pdf': return countPdf(filePath);
    case 'pptx': return countPptx(filePath);
    case 'docx': return countDocx(filePath, cfg);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/counters/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/counters/index.ts test/counters/index.test.ts
git commit -m "feat: add counter dispatch by file type"
```

---

### Task 12: Fetch to temp file

**Files:**
- Create: `src/fetch.ts`
- Test: `test/fetch.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 3); `CountError`, `statusFromHttp` (Task 2).
- Produces:
  - `interface FetchedFile { tempPath: string; contentType: string | null; cleanup: () => Promise<void> }`
  - `fetchToTempFile(url: string, cfg: Config): Promise<FetchedFile>` — throws `CountError` (with a `status`) on HTTP/size errors; throws `AbortError` on timeout.

- [ ] **Step 1: Write the failing test `test/fetch.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fetchToTempFile } from '../src/fetch';
import { resolveConfig } from '../src/config';
import { statusFromFetchError } from '../src/errors';
import { pdfBytes } from './helpers/fixtures';

let server: Server;
let base: string;
let pdf: Uint8Array;

beforeAll(async () => {
  pdf = await pdfBytes(2);
  server = createServer((req, res) => {
    if (req.url === '/ok.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from(pdf));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/ok.pdf' });
      res.end();
    } else if (req.url === '/missing') {
      res.writeHead(404);
      res.end('nope');
    } else if (req.url === '/slow') {
      setTimeout(() => { res.writeHead(200); res.end('late'); }, 1000);
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cfg = resolveConfig({});

describe('fetchToTempFile', () => {
  it('downloads a file and reports content-type', async () => {
    const f = await fetchToTempFile(`${base}/ok.pdf`, cfg);
    const bytes = new Uint8Array(await readFile(f.tempPath));
    expect(bytes.length).toBe(pdf.length);
    expect(f.contentType).toContain('application/pdf');
    await f.cleanup();
  });

  it('follows redirects', async () => {
    const f = await fetchToTempFile(`${base}/redirect`, cfg);
    expect(f.contentType).toContain('application/pdf');
    await f.cleanup();
  });

  it('maps 404 to a not-found CountError', async () => {
    await expect(fetchToTempFile(`${base}/missing`, cfg)).rejects.toMatchObject({ status: 'not-found' });
  });

  it('times out slow responses', async () => {
    const fast = resolveConfig({ timeout: '0.1' });
    try {
      await fetchToTempFile(`${base}/slow`, fast);
      throw new Error('should have thrown');
    } catch (err) {
      expect(statusFromFetchError(err)).toBe('timeout');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fetch.test.ts`
Expected: FAIL — cannot find module `../src/fetch`.

- [ ] **Step 3: Write `src/fetch.ts`**

```ts
import { mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Config } from './config';
import { CountError, statusFromHttp } from './errors';

export interface FetchedFile {
  tempPath: string;
  contentType: string | null;
  cleanup: () => Promise<void>;
}

export async function fetchToTempFile(url: string, cfg: Config): Promise<FetchedFile> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'pagecount/0.1 (+https://github.com/ICJIA/icjia-pagecount)' },
    });
    if (!res.ok) throw new CountError(statusFromHttp(res.status), `HTTP ${res.status}`);

    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > cfg.maxSize) {
      throw new CountError('too-large', `content-length ${len} exceeds max ${cfg.maxSize}`);
    }
    if (!res.body) throw new CountError('network-error', 'empty response body');

    const dir = await mkdtemp(join(tmpdir(), 'pc-fetch-'));
    const tempPath = join(dir, 'download');
    const cleanup = () => rm(dir, { recursive: true, force: true });

    const handle = await open(tempPath, 'w');
    let written = 0;
    try {
      for await (const chunk of Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])) {
        written += (chunk as Buffer).length;
        if (written > cfg.maxSize) throw new CountError('too-large', `body exceeds max ${cfg.maxSize}`);
        await handle.write(chunk);
      }
    } catch (err) {
      await handle.close();
      await cleanup();
      throw err;
    }
    await handle.close();

    return { tempPath, contentType: res.headers.get('content-type'), cleanup };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/fetch.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/fetch.ts test/fetch.test.ts
git commit -m "feat: add timeout/size-capped fetch to temp file"
```

---

### Task 13: Concurrency pool

**Files:**
- Create: `src/pool.ts`
- Test: `test/pool.test.ts`

**Interfaces:**
- Consumes: nothing (wraps `p-limit`).
- Produces: `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>` — order-preserving.

- [ ] **Step 1: Write the failing test `test/pool.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../src/pool';

describe('mapWithConcurrency', () => {
  it('preserves order and maps results', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let max = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
    expect(max).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pool.test.ts`
Expected: FAIL — cannot find module `../src/pool`.

- [ ] **Step 3: Write `src/pool.ts`**

```ts
import pLimit from 'p-limit';

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const run = pLimit(limit);
  return Promise.all(items.map((item, i) => run(() => fn(item, i))));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pool.ts test/pool.test.ts
git commit -m "feat: add order-preserving concurrency pool"
```

---

### Task 14: Detect URL column

**Files:**
- Create: `src/detectColumn.ts`
- Test: `test/detectColumn.test.ts`

**Interfaces:**
- Consumes: `isFullUrl` (Task 5).
- Produces:
  - `interface Table { header: string[]; rows: string[][] }`
  - `detectUrlColumn(table: Table, override?: string): number` — 0-based column index; throws if none found or override invalid.

- [ ] **Step 1: Write the failing test `test/detectColumn.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { detectUrlColumn, type Table } from '../src/detectColumn';

const table: Table = {
  header: ['Name', 'Notes', 'Link'],
  rows: [
    ['Alpha', 'x', 'https://x.org/a.pdf'],
    ['Beta', 'y', 'https://x.org/b.docx'],
    ['Gamma', 'z', ''],
  ],
};

describe('detectUrlColumn', () => {
  it('auto-detects the column with the most URLs', () => {
    expect(detectUrlColumn(table)).toBe(2);
  });
  it('honors an override by header name (case-insensitive)', () => {
    expect(detectUrlColumn(table, 'link')).toBe(2);
  });
  it('honors an override by 1-based index', () => {
    expect(detectUrlColumn(table, '1')).toBe(0);
  });
  it('throws when no URL column is found', () => {
    expect(() => detectUrlColumn({ header: ['a', 'b'], rows: [['1', '2']] })).toThrow();
  });
  it('throws on an out-of-range index override', () => {
    expect(() => detectUrlColumn(table, '9')).toThrow(/range/);
  });
  it('throws on an unknown name override', () => {
    expect(() => detectUrlColumn(table, 'nope')).toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/detectColumn.test.ts`
Expected: FAIL — cannot find module `../src/detectColumn`.

- [ ] **Step 3: Write `src/detectColumn.ts`**

```ts
import { isFullUrl } from './url';

export interface Table {
  header: string[];
  rows: string[][];
}

export function detectUrlColumn(table: Table, override?: string): number {
  if (override !== undefined && override !== '') {
    const asNum = Number(override);
    if (Number.isInteger(asNum)) {
      const idx = asNum - 1; // 1-based
      if (idx < 0 || idx >= table.header.length) {
        throw new Error(`--column index ${override} is out of range (1..${table.header.length})`);
      }
      return idx;
    }
    const idx = table.header.findIndex(
      (h) => h.trim().toLowerCase() === override.trim().toLowerCase(),
    );
    if (idx === -1) throw new Error(`--column "${override}" not found in header`);
    return idx;
  }

  let best = -1;
  let bestRatio = 0;
  for (let c = 0; c < table.header.length; c++) {
    let nonEmpty = 0;
    let urls = 0;
    for (const row of table.rows) {
      const cell = (row[c] ?? '').trim();
      if (!cell) continue;
      nonEmpty++;
      if (isFullUrl(cell)) urls++;
    }
    const ratio = nonEmpty === 0 ? 0 : urls / nonEmpty;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  if (best === -1 || bestRatio < 0.5) {
    throw new Error('Could not find a URL column; specify one with --column');
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/detectColumn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/detectColumn.ts test/detectColumn.test.ts
git commit -m "feat: add URL column auto-detection with override"
```

---

### Task 15: CSV read/write

**Files:**
- Create: `src/spreadsheet/csv.ts`
- Test: `test/spreadsheet/csv.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readCsv(path: string): Promise<{ header: string[]; rows: string[][] }>`
  - `writeCsv(outPath: string, header: string[], rows: string[][]): Promise<void>`

- [ ] **Step 1: Write the failing test `test/spreadsheet/csv.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readCsv, writeCsv } from '../../src/spreadsheet/csv';
import { writeTemp } from '../helpers/fixtures';

describe('csv read/write', () => {
  it('reads header and rows', async () => {
    const file = await writeTemp('Name,URL\nA,https://x/a.pdf\nB,\n', 'in.csv');
    const { header, rows } = await readCsv(file);
    expect(header).toEqual(['Name', 'URL']);
    expect(rows).toEqual([['A', 'https://x/a.pdf'], ['B', '']]);
  });

  it('round-trips quoted fields', async () => {
    const out = await writeTemp('', 'out.csv');
    await writeCsv(out, ['Name', 'URL'], [['A, Inc.', 'u1']]);
    const text = await readFile(out, 'utf8');
    expect(text).toContain('"A, Inc."');
    const reread = await readCsv(out);
    expect(reread.rows[0]).toEqual(['A, Inc.', 'u1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spreadsheet/csv.test.ts`
Expected: FAIL — cannot find module `../../src/spreadsheet/csv`.

- [ ] **Step 3: Write `src/spreadsheet/csv.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export async function readCsv(path: string): Promise<{ header: string[]; rows: string[][] }> {
  const text = await readFile(path, 'utf8');
  const records = parse(text, { relax_column_count: true }) as string[][];
  const [header = [], ...rows] = records;
  return { header, rows };
}

export async function writeCsv(outPath: string, header: string[], rows: string[][]): Promise<void> {
  const out = stringify([header, ...rows]);
  await writeFile(outPath, out, 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spreadsheet/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spreadsheet/csv.ts test/spreadsheet/csv.test.ts
git commit -m "feat: add CSV read/write"
```

---

### Task 16: XLSX read/write (format-preserving)

**Files:**
- Create: `src/spreadsheet/xlsx.ts`
- Modify: `test/helpers/fixtures.ts` (add `writeXlsxFile`)
- Test: `test/spreadsheet/xlsx.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface XlsxData { header: string[]; rows: string[][]; workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet }`
  - `readXlsx(path: string): Promise<XlsxData>`
  - `writeXlsx(data: Pick<XlsxData, 'workbook' | 'sheet'>, outPath: string, countHeader: string, counts: (number | null)[]): Promise<void>`
  - fixture `writeXlsxFile(path: string, header: string[], rows: (string | number)[][]): Promise<void>`

- [ ] **Step 1: Add `writeXlsxFile` to `test/helpers/fixtures.ts`**

```ts
import ExcelJS from 'exceljs';

export async function writeXlsxFile(
  path: string, header: string[], rows: (string | number)[][],
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(path);
}
```

- [ ] **Step 2: Write the failing test `test/spreadsheet/xlsx.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readXlsx, writeXlsx } from '../../src/spreadsheet/xlsx';
import { writeXlsxFile } from '../helpers/fixtures';

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pc-'));
}

describe('xlsx read/write', () => {
  it('reads header and rows as text', async () => {
    const dir = await tmpDir();
    const file = join(dir, 'in.xlsx');
    await writeXlsxFile(file, ['Name', 'URL'], [['A', 'https://x/a.pdf'], ['B', '']]);
    const data = await readXlsx(file);
    expect(data.header).toEqual(['Name', 'URL']);
    expect(data.rows).toEqual([['A', 'https://x/a.pdf'], ['B', '']]);
  });

  it('appends a PageCount column and preserves existing cells', async () => {
    const dir = await tmpDir();
    const file = join(dir, 'in.xlsx');
    const out = join(dir, 'out.xlsx');
    await writeXlsxFile(file, ['Name', 'URL'], [['A', 'u1'], ['B', 'u2']]);
    const data = await readXlsx(file);
    await writeXlsx(data, out, 'PageCount', [3, null]);
    const reread = await readXlsx(out);
    expect(reread.header).toEqual(['Name', 'URL', 'PageCount']);
    expect(reread.rows[0]).toEqual(['A', 'u1', '3']);
    expect(reread.rows[1]).toEqual(['B', 'u2', '']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/spreadsheet/xlsx.test.ts`
Expected: FAIL — cannot find module `../../src/spreadsheet/xlsx`.

- [ ] **Step 4: Write `src/spreadsheet/xlsx.ts`**

```ts
import ExcelJS from 'exceljs';

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
  countHeader: string,
  counts: (number | null)[],
): Promise<void> {
  const { workbook, sheet } = data;
  const col = sheet.columnCount + 1;
  sheet.getRow(1).getCell(col).value = countHeader;
  for (let i = 0; i < counts.length; i++) {
    const value = counts[i];
    if (value !== null) sheet.getRow(i + 2).getCell(col).value = value;
  }
  await workbook.xlsx.writeFile(outPath);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/spreadsheet/xlsx.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/spreadsheet/xlsx.ts test/spreadsheet/xlsx.test.ts test/helpers/fixtures.ts
git commit -m "feat: add format-preserving XLSX read/write"
```

---

### Task 17: Spreadsheet read dispatch

**Files:**
- Create: `src/spreadsheet/read.ts`
- Test: `test/spreadsheet/read.test.ts`

**Interfaces:**
- Consumes: `readCsv`/`writeCsv` (Task 15); `readXlsx`/`writeXlsx` (Task 16).
- Produces:
  - `interface LoadedSpreadsheet { header: string[]; rows: string[][]; write: (outPath: string, countHeader: string, counts: (number | null)[]) => Promise<void> }`
  - `readSpreadsheet(path: string): Promise<LoadedSpreadsheet>`

- [ ] **Step 1: Write the failing test `test/spreadsheet/read.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpreadsheet } from '../../src/spreadsheet/read';
import { readXlsx } from '../../src/spreadsheet/xlsx';
import { writeTemp, writeXlsxFile } from '../helpers/fixtures';

describe('readSpreadsheet', () => {
  it('reads csv and writes an appended column', async () => {
    const file = await writeTemp('Name,URL\nA,u1\nB,u2\n', 'in.csv');
    const loaded = await readSpreadsheet(file);
    expect(loaded.header).toEqual(['Name', 'URL']);
    const out = await writeTemp('', 'out.csv');
    await loaded.write(out, 'PageCount', [5, null]);
    const text = await readFile(out, 'utf8');
    expect(text).toContain('Name,URL,PageCount');
    expect(text).toContain('A,u1,5');
    expect(text).toContain('B,u2,');
  });

  it('reads xlsx and writes an appended column', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pc-'));
    const file = join(dir, 'in.xlsx');
    await writeXlsxFile(file, ['Name', 'URL'], [['A', 'u1']]);
    const loaded = await readSpreadsheet(file);
    const out = join(dir, 'out.xlsx');
    await loaded.write(out, 'PageCount', [3]);
    const reread = await readXlsx(out);
    expect(reread.header).toEqual(['Name', 'URL', 'PageCount']);
    expect(reread.rows[0]).toEqual(['A', 'u1', '3']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spreadsheet/read.test.ts`
Expected: FAIL — cannot find module `../../src/spreadsheet/read`.

- [ ] **Step 3: Write `src/spreadsheet/read.ts`**

```ts
import { extname } from 'node:path';
import { readCsv, writeCsv } from './csv';
import { readXlsx, writeXlsx } from './xlsx';

export interface LoadedSpreadsheet {
  header: string[];
  rows: string[][];
  write: (outPath: string, countHeader: string, counts: (number | null)[]) => Promise<void>;
}

export async function readSpreadsheet(path: string): Promise<LoadedSpreadsheet> {
  const ext = extname(path).toLowerCase();

  if (ext === '.csv') {
    const { header, rows } = await readCsv(path);
    return {
      header,
      rows,
      write: (outPath, countHeader, counts) =>
        writeCsv(
          outPath,
          [...header, countHeader],
          rows.map((r, i) => [...r, counts[i] != null ? String(counts[i]) : '']),
        ),
    };
  }

  if (ext === '.xlsx') {
    const data = await readXlsx(path);
    return {
      header: data.header,
      rows: data.rows,
      write: (outPath, countHeader, counts) => writeXlsx(data, outPath, countHeader, counts),
    };
  }

  throw new Error(`Unsupported spreadsheet type: ${ext || '(none)'}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spreadsheet/read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spreadsheet/read.ts test/spreadsheet/read.test.ts
git commit -m "feat: add spreadsheet read/write dispatch (csv + xlsx)"
```

---

### Task 18: Counting orchestration (fetch → classify → count)

**Files:**
- Create: `src/counting.ts`
- Test: `test/counting.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 3); `CountOutcome`/`FileType` (Task 2); `fetchToTempFile` (Task 12); `countByType` (Task 11); `typeFromExtension`/`hasUnsupportedExtension`/`typeFromContentType`/`sniffType` (Task 5); `statusFromFetchError` (Task 2).
- Produces:
  - `interface CountResult { type: FileType | null; outcome: CountOutcome }`
  - `countLocalFile(filePath: string, cfg: Config): Promise<CountResult>`
  - `countUrl(url: string, cfg: Config): Promise<CountResult>`

- [ ] **Step 1: Write the failing test `test/counting.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { countUrl, countLocalFile } from '../src/counting';
import { resolveConfig } from '../src/config';
import { pdfBytes, pptxBytes, writeTemp } from './helpers/fixtures';

let server: Server;
let base: string;

beforeAll(async () => {
  const pdf = await pdfBytes(3);
  server = createServer((req, res) => {
    if (req.url === '/a.pdf' || req.url === '/noext') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from(pdf));
    } else if (req.url === '/a.jpg') {
      res.writeHead(200);
      res.end('img');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const cfg = resolveConfig({});

describe('countUrl', () => {
  it('counts a pdf identified by extension', async () => {
    expect(await countUrl(`${base}/a.pdf`, cfg))
      .toMatchObject({ type: 'pdf', outcome: { pageCount: 3, status: 'ok' } });
  });
  it('classifies by content-type when the URL has no extension', async () => {
    expect(await countUrl(`${base}/noext`, cfg))
      .toMatchObject({ type: 'pdf', outcome: { pageCount: 3, status: 'ok' } });
  });
  it('skips clearly-unsupported extensions without fetching', async () => {
    expect(await countUrl(`${base}/a.jpg`, cfg))
      .toMatchObject({ type: null, outcome: { status: 'unsupported' } });
  });
  it('maps fetch failures to a status', async () => {
    expect((await countUrl(`${base}/missing.pdf`, cfg)).outcome.status).toBe('not-found');
  });
});

describe('countLocalFile', () => {
  it('counts a local pptx', async () => {
    const file = await writeTemp(pptxBytes(4), 'deck.pptx');
    expect(await countLocalFile(file, cfg))
      .toMatchObject({ type: 'pptx', outcome: { pageCount: 4, status: 'ok' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/counting.test.ts`
Expected: FAIL — cannot find module `../src/counting`.

- [ ] **Step 3: Write `src/counting.ts`**

```ts
import type { Config } from './config';
import type { CountOutcome, FileType } from './types';
import { fetchToTempFile } from './fetch';
import { countByType } from './counters/index';
import {
  typeFromExtension, hasUnsupportedExtension, typeFromContentType, sniffType,
} from './url';
import { statusFromFetchError } from './errors';

export interface CountResult {
  type: FileType | null;
  outcome: CountOutcome;
}

const UNSUPPORTED: CountResult = { type: null, outcome: { pageCount: null, status: 'unsupported' } };

export async function countLocalFile(filePath: string, cfg: Config): Promise<CountResult> {
  const type = typeFromExtension(filePath) ?? (await sniffType(filePath));
  if (!type) return UNSUPPORTED;
  return { type, outcome: await countByType(type, filePath, cfg) };
}

export async function countUrl(url: string, cfg: Config): Promise<CountResult> {
  if (hasUnsupportedExtension(url)) return UNSUPPORTED;

  let fetched;
  try {
    fetched = await fetchToTempFile(url, cfg);
  } catch (err) {
    return {
      type: null,
      outcome: {
        pageCount: null,
        status: statusFromFetchError(err),
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }

  try {
    const type =
      typeFromExtension(url) ??
      typeFromContentType(fetched.contentType) ??
      (await sniffType(fetched.tempPath));
    if (!type) return UNSUPPORTED;
    return { type, outcome: await countByType(type, fetched.tempPath, cfg) };
  } finally {
    await fetched.cleanup();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/counting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/counting.ts test/counting.test.ts
git commit -m "feat: add counting orchestration for urls and local files"
```

---

### Task 19: Reporting

**Files:**
- Create: `src/report.ts`
- Test: `test/report.test.ts`

**Interfaces:**
- Consumes: `RowResult`/`Summary`/`CountOutcome`/`FileType` (Task 2).
- Produces:
  - `summarize(results: RowResult[]): Summary`
  - `formatSpreadsheetSummary(input: string, outputPath: string, summary: Summary): string`
  - `buildSpreadsheetJson(input: string, outputPath: string, results: RowResult[], summary: Summary): object`
  - `formatDocumentLine(source: string, type: FileType | null, outcome: CountOutcome): string`
  - `buildDocumentJson(source: string, type: FileType | null, outcome: CountOutcome): object`

- [ ] **Step 1: Write the failing test `test/report.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  summarize, formatSpreadsheetSummary, formatDocumentLine, buildDocumentJson,
} from '../src/report';
import type { RowResult } from '../src/types';

const rows: RowResult[] = [
  { row: 2, url: 'u', type: 'pdf', pageCount: 3, status: 'ok' },
  { row: 3, url: null, type: null, pageCount: null, status: 'no-url' },
  { row: 4, url: 'u', type: 'docx', pageCount: null, status: 'timeout', error: 't' },
  { row: 5, url: 'u', type: null, pageCount: null, status: 'unsupported' },
];

describe('summarize', () => {
  it('tallies counts and errors', () => {
    const s = summarize(rows);
    expect(s).toMatchObject({ total: 4, counted: 1, noUrl: 1, failed: 2 });
    expect(s.byError).toEqual({ timeout: 1, unsupported: 1 });
  });
});

describe('formatters', () => {
  it('formats a spreadsheet summary with failure breakdown', () => {
    const txt = formatSpreadsheetSummary('in.csv', 'out.csv', summarize(rows));
    expect(txt).toContain('4 rows · 1 counted · 1 no-url · 2 failed');
    expect(txt).toContain('failed:');
  });
  it('formats a document line (plural / singular / rendered)', () => {
    expect(formatDocumentLine('a.pdf', 'pdf', { pageCount: 2, status: 'ok' }))
      .toBe('a.pdf · pdf · 2 pages');
    expect(formatDocumentLine('a.pdf', 'pdf', { pageCount: 1, status: 'ok' }))
      .toBe('a.pdf · pdf · 1 page');
    expect(formatDocumentLine('a.docx', 'docx', { pageCount: 5, status: 'ok', rendered: true }))
      .toBe('a.docx · docx · 5 pages (rendered)');
  });
  it('builds document json including an error field', () => {
    expect(buildDocumentJson('a.pdf', null, { pageCount: null, status: 'corrupt', error: 'bad' }))
      .toEqual({ file: 'a.pdf', type: null, pageCount: null, status: 'corrupt', error: 'bad' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/report.test.ts`
Expected: FAIL — cannot find module `../src/report`.

- [ ] **Step 3: Write `src/report.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report.ts test/report.test.ts
git commit -m "feat: add summary and report formatting"
```

---

### Task 20: Spreadsheet pipeline

**Files:**
- Create: `src/spreadsheet/process.ts`
- Test: `test/spreadsheet/process.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 3); `RowResult`/`Summary` (Task 2); `readSpreadsheet`/`LoadedSpreadsheet` (Task 17); `detectUrlColumn` (Task 14); `mapWithConcurrency` (Task 13); `countUrl` (Task 18); `isFullUrl` (Task 5); `summarize` (Task 19).
- Produces:
  - `interface ProcessResult { loaded: LoadedSpreadsheet; results: RowResult[]; summary: Summary; counts: (number | null)[] }`
  - `processSpreadsheet(path: string, cfg: Config): Promise<ProcessResult>`

- [ ] **Step 1: Write the failing test `test/spreadsheet/process.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { processSpreadsheet } from '../../src/spreadsheet/process';
import { resolveConfig } from '../../src/config';
import { pdfBytes, writeTemp } from '../helpers/fixtures';

let server: Server;
let base: string;

beforeAll(async () => {
  const pdf = await pdfBytes(3);
  server = createServer((req, res) => {
    if (req.url === '/a.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(Buffer.from(pdf));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('processSpreadsheet', () => {
  it('counts URLs, blanks non-URLs, and summarizes failures', async () => {
    const csv = `Name,Link\nA,${base}/a.pdf\nB,\nC,not-a-url\nD,${base}/missing.pdf\n`;
    const file = await writeTemp(csv, 'in.csv');
    const { results, summary, counts } = await processSpreadsheet(file, resolveConfig({}));
    expect(counts).toEqual([3, null, null, null]);
    expect(results.map((r) => r.status)).toEqual(['ok', 'no-url', 'no-url', 'not-found']);
    expect(results[0].row).toBe(2);
    expect(summary).toMatchObject({ total: 4, counted: 1, noUrl: 2, failed: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/spreadsheet/process.test.ts`
Expected: FAIL — cannot find module `../../src/spreadsheet/process`.

- [ ] **Step 3: Write `src/spreadsheet/process.ts`**

```ts
import type { Config } from '../config';
import type { RowResult, Summary } from '../types';
import { readSpreadsheet, type LoadedSpreadsheet } from './read';
import { detectUrlColumn } from '../detectColumn';
import { mapWithConcurrency } from '../pool';
import { countUrl } from '../counting';
import { isFullUrl } from '../url';
import { summarize } from '../report';

export interface ProcessResult {
  loaded: LoadedSpreadsheet;
  results: RowResult[];
  summary: Summary;
  counts: (number | null)[];
}

export async function processSpreadsheet(path: string, cfg: Config): Promise<ProcessResult> {
  const loaded = await readSpreadsheet(path);
  const col = detectUrlColumn({ header: loaded.header, rows: loaded.rows }, cfg.column);

  const results = await mapWithConcurrency(
    loaded.rows,
    cfg.concurrency,
    async (row, i): Promise<RowResult> => {
      const cell = (row[col] ?? '').trim();
      const rowNumber = i + 2; // row 1 is the header
      if (!isFullUrl(cell)) {
        return { row: rowNumber, url: cell || null, type: null, pageCount: null, status: 'no-url' };
      }
      const { type, outcome } = await countUrl(cell, cfg);
      return {
        row: rowNumber,
        url: cell,
        type,
        pageCount: outcome.pageCount,
        status: outcome.status,
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    },
  );

  return { loaded, results, summary: summarize(results), counts: results.map((r) => r.pageCount) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/spreadsheet/process.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/spreadsheet/process.ts test/spreadsheet/process.test.ts
git commit -m "feat: add concurrent spreadsheet counting pipeline"
```

---

### Task 21: Document mode

**Files:**
- Create: `src/document.ts`
- Test: `test/document.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 3); `countLocalFile`/`countUrl`/`CountResult` (Task 18).
- Produces: `countDocument(source: string, remote: boolean, cfg: Config): Promise<CountResult>`

- [ ] **Step 1: Write the failing test `test/document.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { countDocument } from '../src/document';
import { resolveConfig } from '../src/config';
import { pdfBytes, writeTemp } from './helpers/fixtures';

describe('countDocument', () => {
  it('counts a local document', async () => {
    const file = await writeTemp(await pdfBytes(2), 'a.pdf');
    expect(await countDocument(file, false, resolveConfig({})))
      .toMatchObject({ type: 'pdf', outcome: { pageCount: 2, status: 'ok' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/document.test.ts`
Expected: FAIL — cannot find module `../src/document`.

- [ ] **Step 3: Write `src/document.ts`**

```ts
import type { Config } from './config';
import { countLocalFile, countUrl, type CountResult } from './counting';

export function countDocument(source: string, remote: boolean, cfg: Config): Promise<CountResult> {
  return remote ? countUrl(source, cfg) : countLocalFile(source, cfg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/document.ts test/document.test.ts
git commit -m "feat: add single-document mode"
```

---

### Task 22: Run orchestrator

**Files:**
- Create: `src/run.ts`
- Test: `test/run.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 3); `classifyInput` (Task 6); `processSpreadsheet` (Task 20); `countDocument` (Task 21); report formatters (Task 19).
- Produces:
  - `outputPathFor(inputPath: string, cfg: Config): string`
  - `run(inputs: string[], cfg: Config): Promise<number>` — returns the process exit code.

- [ ] **Step 1: Write the failing test `test/run.test.ts`**

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { stat, readFile } from 'node:fs/promises';
import { run, outputPathFor } from '../src/run';
import { resolveConfig } from '../src/config';
import { pdfBytes, writeTemp } from './helpers/fixtures';

describe('outputPathFor', () => {
  it('places output in .pagecount-output beside the file with a suffix', () => {
    expect(outputPathFor('/data/in.csv', resolveConfig({})))
      .toBe('/data/.pagecount-output/in-pagecount.csv');
  });
  it('honors --output and an empty --suffix', () => {
    expect(outputPathFor('/data/in.csv', resolveConfig({ output: '/out', suffix: '' })))
      .toBe('/out/in.csv');
  });
});

describe('run — document mode', () => {
  it('prints a line and returns 0 for a local pdf', async () => {
    const file = await writeTemp(await pdfBytes(2), 'a.pdf');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run([file], resolveConfig({}));
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(' ')).toContain('pdf');
    log.mockRestore();
  });
  it('returns 1 for an unsupported input', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run(['notes.txt'], resolveConfig({}))).toBe(1);
    err.mockRestore();
  });
});

describe('run — spreadsheet mode (end-to-end)', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const pdf = await pdfBytes(4);
    server = createServer((req, res) => {
      if (req.url === '/a.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(Buffer.from(pdf));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('writes an output csv with a PageCount column', async () => {
    const file = await writeTemp(`Name,Link\nA,${base}/a.pdf\nB,\n`, 'data.csv');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run([file], resolveConfig({}));
    expect(code).toBe(0);
    const outPath = outputPathFor(file, resolveConfig({}));
    await stat(outPath); // throws if missing
    const text = await readFile(outPath, 'utf8');
    expect(text).toContain('Name,Link,PageCount');
    expect(text).toContain(',4');
    expect(text.trim().split('\n')[2]).toBe('B,,');
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/run.test.ts`
Expected: FAIL — cannot find module `../src/run`.

- [ ] **Step 3: Write `src/run.ts`**

```ts
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
  const outPath = outputPathFor(path, cfg);
  await mkdir(dirname(outPath), { recursive: true });
  await loaded.write(outPath, cfg.countColumn, counts);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/run.test.ts`
Expected: PASS — all run-mode tests green.

- [ ] **Step 5: Commit**

```bash
git add src/run.ts test/run.test.ts
git commit -m "feat: add run orchestrator with output paths and exit codes"
```

---

### Task 23: CLI entry & full verification

**Files:**
- Create: `src/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `resolveConfig` (Task 3); `run` (Task 22); `commander`.
- Produces: `buildProgram(): Command`; `main(argv: string[]): Promise<void>`. Auto-runs only when executed directly (guarded), so tests can import it safely.

- [ ] **Step 1: Write the failing test `test/cli.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildProgram, main } from '../src/cli';
import { pdfBytes, writeTemp } from './helpers/fixtures';

describe('buildProgram', () => {
  it('parses inputs and options', () => {
    const p = buildProgram().exitOverride();
    p.parse(['node', 'pagecount', 'a.csv', 'b.pdf', '--concurrency', '4', '--json']);
    expect(p.args).toEqual(['a.csv', 'b.pdf']);
    expect(p.opts()).toMatchObject({ concurrency: '4', json: true });
  });
});

describe('main', () => {
  it('counts a local pdf and sets exit code 0', async () => {
    const file = await writeTemp(await pdfBytes(2), 'a.pdf');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['node', 'pagecount', file]);
    expect(process.exitCode).toBe(0);
    expect(log.mock.calls.flat().join(' ')).toContain('pdf');
    log.mockRestore();
    process.exitCode = 0;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — cannot find module `../src/cli`.

- [ ] **Step 3: Write `src/cli.ts`**

```ts
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { resolveConfig } from './config';
import { run } from './run';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('pagecount')
    .description('Add page counts to a spreadsheet of document URLs, or count a single document.')
    .argument('<input...>', 'spreadsheets (.csv/.xlsx) and/or documents (.pdf/.docx/.pptx or a URL)')
    .option('-o, --output <dir>', 'force one shared output dir (default: .pagecount-output beside each file)')
    .option('-c, --column <name|index>', 'URL column: header name or 1-based index (default: auto-detect)')
    .option('--count-column <name>', 'name of the added column (default: PageCount)')
    .option('--suffix <text>', 'output filename suffix (default: pagecount)')
    .option('--json', 'emit JSON (sidecar in spreadsheet mode; stdout in document mode)')
    .option('-q, --quiet', 'document mode: print only the page number')
    .option('--concurrency <n>', 'parallel downloads per spreadsheet (default: 8)')
    .option('--timeout <sec>', 'per-URL fetch timeout (default: 30)')
    .option('--max-size <mb>', 'skip files larger than this (default: 100)')
    .option('--docx-render', 'force LibreOffice render for docx')
    .version('0.1.0');
  return program;
}

export async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  program.parse(argv);
  const opts = program.opts();
  const cfg = resolveConfig({
    output: opts.output,
    column: opts.column,
    countColumn: opts.countColumn,
    suffix: opts.suffix,
    json: opts.json,
    quiet: opts.quiet,
    concurrency: opts.concurrency,
    timeout: opts.timeout,
    maxSize: opts.maxSize,
    docxRender: opts.docxRender,
  });
  process.exitCode = await run(program.args, cfg);
}

function isDirectRun(): boolean {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && realpathSync(entry as string) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and type-check**

Run: `npm test`
Expected: PASS — every suite green.

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 6: Build and smoke-test the binary**

Run: `npm run build`
Expected: `dist/cli.js` is produced with a `#!/usr/bin/env node` shebang.

Run: `node dist/cli.js --help`
Expected: usage text listing all options.

Then generate a quick local PDF and count it:

```bash
node -e "import('pdf-lib').then(async ({PDFDocument}) => {const d=await PDFDocument.create();d.addPage();d.addPage();const fs=await import('node:fs/promises');await fs.writeFile('sample.pdf', await d.save());})"
node dist/cli.js sample.pdf
```
Expected: `sample.pdf · pdf · 2 pages`

- [ ] **Step 7: Link and verify the global command (optional)**

Run: `npm link && pagecount sample.pdf`
Expected: `sample.pdf · pdf · 2 pages` (then `rm sample.pdf`).

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: add commander CLI entry and wire up the binary"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

| Spec section | Implemented by |
|---|---|
| §4 CLI surface / flags | Task 23 (cli) |
| §5 mode dispatch | Task 6 (input), Task 22 (run) |
| §5 spreadsheet flow | Tasks 14, 15, 16, 17, 18, 20 |
| §5 output-path resolution | Task 22 (`outputPathFor`) |
| §5 header assumption | Tasks 15/16 (row 1 = header), Task 20 (`row = i+2`) |
| §5 document flow | Tasks 18, 21, 22 |
| §6 PDF / PPTX / DOCX counters | Tasks 7, 8, 9, 10, 11 |
| §7 URL & file classification | Task 5 (url), Task 18 (compose chain) |
| §8 status taxonomy | Task 2; surfaced by counters/fetch (Tasks 7–12) |
| §8 summary + exit codes | Task 19 (summary), Task 22 (exit codes) |
| §9 csv / xlsx / json / stdout output | Tasks 15, 16, 17, 19, 22, 23 |
| §10 module architecture | all tasks (one module each) |
| §11 dependencies | Task 1 |
| §12 testing strategy | each task's test suite |
| §13 distribution | Task 1 (`bin`, tsup); `publish.sh` already in repo |

No gaps found.

**2. Placeholder scan** — no `TBD`/`TODO`/"add error handling"/"similar to Task N". Every code step shows complete code; every test step shows real assertions.

**3. Type consistency** — names verified across tasks: `Config`/`resolveConfig`, `CountOutcome`/`CountResult`/`RowResult`/`Summary`/`Status`/`FileType`, `countByType`/`countPdf`/`countPptx`/`countDocx`/`countUrl`/`countLocalFile`/`countDocument`, `LoadedSpreadsheet.write(outPath, countHeader, counts)`, `processSpreadsheet`→`{ loaded, results, summary, counts }`, `outputPathFor`, `detectUrlColumn`, `summarize`, `formatSpreadsheetSummary`/`buildSpreadsheetJson`/`formatDocumentLine`/`buildDocumentJson`, `fetchToTempFile`→`{ tempPath, contentType, cleanup }`, `mapWithConcurrency`, `loadZip`/`entryText`/`sniffType`. Signatures match between producers and consumers.

## Notes for the implementer

- Already committed to the repo (don't recreate): the design spec, `README.md`, `LICENSE`, `.gitignore`, `.nvmrc`, and `publish.sh`. This plan builds `src/` + `test/` + the build config.
- The npm **package name** in `package.json` (`@icjia/pagecount`) is provisional — confirm with the maintainer before the first publish (the repo is `icjia-pagecount`). The **bin name** `pagecount` is fixed.
- Run tasks in order; each ends green and committed. Push when convenient (`origin/main` is set up).
- LibreOffice is optional; the DOCX render path is covered by injected fakes (Task 10), so the suite passes without it.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-22-pagecount-cli.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

