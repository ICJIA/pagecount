# PageCount CLI — Design Spec

- **Date:** 2026-06-22
- **Status:** Approved design, pre-implementation
- **Stack:** Node.js 20+, TypeScript

## 1. Summary

`pagecount` is a command-line tool with **two modes**, chosen automatically by the
kind of input it's given:

- **Spreadsheet mode** — given a CSV or XLSX containing a column of **public**
  document URLs (PDF, DOCX, PPTX), it determines each document's page count and
  writes a copy of the spreadsheet with an added `PageCount` column.
- **Document mode** — given a single document (a local `.pdf` / `.docx` / `.pptx`,
  or one URL to one), it prints the page count to the terminal and writes nothing.
  This is the quick "how many pages is this file?" path.

```
pagecount data.csv
# reads ./data.csv
# writes ./.pagecount-output/data-pagecount.csv

pagecount myfile.pdf
# myfile.pdf · pdf · 12 pages          (nothing written)
```

In spreadsheet mode, output goes to a `.pagecount-output` directory **beside the
input file**, with a `-pagecount` suffix on the filename. Rows that lack a full URL
— or whose document cannot be counted — get a **blank** `PageCount` cell. A terminal
summary reports what happened; an optional JSON sidecar carries the per-row detail.

## 2. Goals

- One command, runs anywhere on macOS/Linux: `pagecount file.csv`.
- Accept CSV and XLSX; preserve the original data/formatting and append one column.
- Double as a quick single-document checker: `pagecount file.pdf` prints the page
  count and exits, writing nothing.
- Exact counts for PDF and PPTX; best-available for DOCX (see §6).
- Accept multiple inputs (shell globs); each spreadsheet writes beside itself.
- Resilient: in spreadsheet mode a bad or failed URL never crashes the run — it
  becomes a blank cell plus a recorded status.
- Clear terminal output; optional machine-readable JSON.

## 3. Non-goals (v1)

- No resume / checkpointing — datasets are ≤ ~3k URLs and fit comfortably in memory.
- No authentication, cookies, or private URLs — inputs are public links.
- No formats beyond PDF / DOCX / PPTX (no legacy `.doc` / `.ppt`, no `.odt` / `.pages`).
- No recursive directory crawl — inputs are explicit file paths (globs handled by the shell).
- No GUI, daemon, or watch mode.

## 4. CLI surface

```
pagecount <input...>               # spreadsheets (.csv/.xlsx) and/or documents
                                   # (.pdf/.docx/.pptx or a URL); globs OK

  -o, --output <dir>              # spreadsheet mode: force ONE shared output dir
                                  #   (default: .pagecount-output beside each file)
  -c, --column <name|index>       # spreadsheet mode: URL column, by header name or
                                  #   1-based index (default: auto-detect)
      --count-column <name>       # spreadsheet mode: new column header (default: PageCount)
      --suffix <text>             # spreadsheet mode: filename suffix
                                  #   (default: pagecount; "" to disable)
      --json                      # emit JSON: a sidecar file (spreadsheet mode)
                                  #   or to stdout (document mode)
  -q, --quiet                     # document mode: print only the bare integer
      --concurrency <n>           # parallel downloads per file (default: 8)
      --timeout <sec>             # per-URL fetch timeout (default: 30)
      --max-size <mb>             # skip files larger than this (default: 100)
      --docx-render               # force LibreOffice render for docx
                                  #   (default: auto-render only when metadata is absent
                                  #    AND LibreOffice is on PATH)
  -h, --help
      --version
```

### Modes

Each input argument is classified independently (see §5). Spreadsheet inputs are
processed and written; document inputs are counted and printed. The two can be
mixed in one invocation. Spreadsheet-only flags are ignored for document inputs and
vice versa.

### Examples

```
pagecount survey.csv                          # spreadsheet → writes output
pagecount *.csv                               # many spreadsheets
pagecount data.csv ../reports/q3.xlsx --json  # + JSON sidecars
pagecount big.xlsx --column "Document Link" --concurrency 16

pagecount myfile.pdf                          # document → prints "myfile.pdf · pdf · 12 pages"
pagecount slides.pptx report.pdf              # one printed line per document
pagecount https://example.org/a.pdf           # remote document → fetch + print
pagecount myfile.pdf -q                        # prints just "12"
pagecount myfile.pdf --json                    # prints a JSON object to stdout
```

## 5. Modes & dispatch

Each input argument is classified into a **kind**:

- **spreadsheet** — a local file ending in `.csv` or `.xlsx` → spreadsheet mode.
- **document** — a local file ending in `.pdf` / `.docx` / `.pptx`, **or** an
  `http(s)://` URL → document mode.
- **otherwise** — error; the input is reported and the process exits non-zero.

Inputs of different kinds may be mixed; each is handled per its kind.

### Spreadsheet mode — data flow

```
read spreadsheet ─▶ Table {header, rows}  (+ bound writer)
        │
detect URL column ─▶ columnIndex
        │
┌──────── per data row · concurrency 8 ───────────────┐
│  cell ─▶ isFullUrl? ──no──▶ status: no-url          │
│     │ yes                                           │
│  classify type  (extension ▶ Content-Type ▶ magic)  │
│     │                                               │
│  fetch ─▶ temp file  (timeout, size cap, redirects) │
│     │                                               │
│  count pages  (pdf │ pptx │ docx→meta/​render)        │
│     │                                               │
│  RowResult { pageCount | null, status, error? }     │
└────────────────────┬────────────────────────────────┘
        │
write counts into table ─▶ <dir>/.pagecount-output/<name>-pagecount.<ext>
        │
report ─▶ per-file terminal summary  (+ optional JSON sidecar)
```

When multiple spreadsheets are given, a combined total line is printed at the end.

#### Output path resolution

For a spreadsheet input `F`:

- `baseDir = dirname(resolve(F))` (unless `--output <dir>` is given, which replaces
  the per-file `.pagecount-output` with that single shared dir).
- `outDir = baseDir + "/.pagecount-output"`; created with `mkdir -p` semantics
  (created if missing, silently reused if present).
- `outName = basename(F, ext) + "-" + suffix + ext`  (suffix default `pagecount`).
- Output spreadsheet → `outDir/outName`. Optional JSON → same name with `.json`.
- The output is a derived artifact and is overwritten freely on re-run.
- With `--output`, two inputs that share a basename resolve to the same output file
  and the later one overwrites the earlier. (Per-file `.pagecount-output` never collides.)

#### Header assumption

Row 1 of each spreadsheet is the **header row**; data starts at row 2. Column
auto-detection and counting operate on data rows only. (`--no-header` is a possible
future addition; out of scope for v1.)

### Document mode — data flow

```
input is local path ─▶ use directly (no network), classify by extension + magic bytes
input is URL ────────▶ fetch ─▶ temp file (timeout, size cap), classify
        │
count pages  (shared counters: pdf │ pptx │ docx→meta/render)
        │
print result to stdout (§9)   —   write nothing
        │
exit 0 on success; non-zero if the count failed (reason on stderr)
```

Multiple document inputs print one line each; the process exits non-zero if **any**
failed. Document mode never writes a file.

## 6. Page counting by file type

A common interface; one counter per type, **shared by both modes**. Each receives a
file path (a temp file for fetched URLs, or the original path for local documents)
and returns `{ pageCount, status, error? }`.

### PDF — exact

- Load bytes with `pdf-lib`: `PDFDocument.load(bytes, { ignoreEncryption: true })`,
  then `.getPageCount()`.
- If load throws: a message indicating encryption → status `encrypted`; otherwise
  `corrupt`. Cell blank (spreadsheet mode) / error exit (document mode).

### PPTX — exact (slide count)

- A `.pptx` is a ZIP. Read `ppt/presentation.xml` and count `<p:sldId>` entries
  under `<p:sldIdLst>` — the authoritative, ordered slide list.
- Fallback if `presentation.xml` is unreadable: count `ppt/slides/slide*.xml`
  entries, or read `<Slides>` from `docProps/app.xml`.

### DOCX — hybrid (metadata, optional render)

A `.docx` has **no intrinsic page count**; pagination only exists once rendered.

1. **Metadata (default):** open the ZIP, read `docProps/app.xml`, parse the
   `<Pages>` element. If present and a positive integer → use it, status `ok`.
2. **Render fallback:** if `<Pages>` is absent/zero **and** rendering is enabled
   (auto when `soffice`/`libreoffice` is on PATH, or forced by `--docx-render`),
   convert the docx to PDF via headless LibreOffice into a temp dir, then count the
   resulting PDF with the PDF counter. Status `ok` (noted as rendered).
3. **Otherwise:** status `no-page-data`; cell blank / error exit.

`--docx-render` forces a true rendered count even when cached metadata exists
(metadata can be stale; render is authoritative).

## 7. URL & file classification

- **`isFullUrl(cell)`** (spreadsheet mode) — true only for an absolute `http://` or
  `https://` URL. Empty cells, relative paths, bare filenames, and other schemes are
  **not** full URLs → status `no-url`, cell blank.
- **`classifyType(...)`** — a fallback chain so inputs without a clean extension still work:
  1. Path extension (`.pdf` / `.docx` / `.pptx`), ignoring query/fragment.
  2. (Fetched inputs only) HTTP `Content-Type`
     (`application/pdf`; `…wordprocessingml.document`; `…presentationml.presentation`).
  3. Magic-byte sniff of the file: `%PDF` → pdf; `PK\x03\x04` → inspect the ZIP for
     `word/` vs `ppt/` parts → docx/pptx.
  - In spreadsheet mode, if a present extension is clearly unsupported (e.g. `.jpg`,
    `.zip`), mark `unsupported` **without** fetching; otherwise fetch then classify.
  - Local documents classify by extension + magic bytes (no `Content-Type`).
  - If still unresolved → status `unsupported`.

## 8. Status taxonomy

Every counted item resolves to exactly one status. Only `ok` produces a number.

| Status         | Meaning                                            | Spreadsheet bucket |
|----------------|----------------------------------------------------|--------------------|
| `ok`           | Counted; `pageCount` is an integer                 | counted            |
| `no-url`       | Empty cell or not an absolute http(s) URL          | no-url             |
| `unsupported`  | Recognized but not pdf/docx/pptx                   | failed             |
| `not-found`    | HTTP 404 / 410                                      | failed             |
| `http-error`   | Other non-2xx response                             | failed             |
| `timeout`      | Fetch exceeded `--timeout`                          | failed             |
| `network-error`| DNS / connection failure                           | failed             |
| `too-large`    | Exceeded `--max-size`                               | failed             |
| `corrupt`      | File could not be parsed by its counter            | failed             |
| `encrypted`    | PDF unreadable even with `ignoreEncryption`        | failed             |
| `no-page-data` | DOCX with no `<Pages>` and no render available      | failed             |

- **Spreadsheet mode:** every non-`ok` status yields a blank cell and is tallied in
  the summary; the run always finishes (exit 0 unless the spreadsheet can't be read
  or no URL column can be found).
- **Document mode:** a non-`ok` status prints its reason to stderr and exits non-zero.

### Terminal summary — spreadsheet mode (example)

```
data.csv  →  .pagecount-output/data-pagecount.csv
  150 rows · 142 counted · 3 no-url · 5 failed
    failed: 2 timeout · 1 not-found · 2 unsupported
```

## 9. Output formats

### Spreadsheet mode → file

- The `PageCount` column (renamable via `--count-column`) is **appended as the last
  column**. Its header goes in row 1; each data row gets the integer or an empty cell.
- **CSV:** re-emit header + rows via `csv-stringify`.
- **XLSX:** reopen the original workbook with `exceljs`, append the column to the
  first worksheet, and write to the output path — preserving formatting, formulas,
  and any additional sheets. (The reader hands the pipeline a neutral `Table` plus a
  writer closure bound to the source; the pipeline stays format-agnostic.)
- **JSON sidecar (`--json`)** beside the output:

```json
{
  "input": "data.csv",
  "output": ".pagecount-output/data-pagecount.csv",
  "summary": {
    "total": 150, "counted": 142, "noUrl": 3, "failed": 5,
    "byError": { "timeout": 2, "notFound": 1, "unsupported": 2 }
  },
  "rows": [
    { "row": 2, "url": "https://…/a.pdf",  "type": "pdf",  "pageCount": 12,   "status": "ok" },
    { "row": 3, "url": "",                  "type": null,   "pageCount": null, "status": "no-url" },
    { "row": 4, "url": "https://…/b.docx", "type": "docx", "pageCount": null, "status": "timeout",
      "error": "fetch exceeded 30s" }
  ]
}
```

`row` is the 1-based source spreadsheet row (row 1 = header, data begins at 2).

### Document mode → stdout

- **Default:** `<input> · <type> · <N> pages` — e.g. `myfile.pdf · pdf · 12 pages`
  (singular `1 page`; ` (rendered)` appended when a DOCX was counted via LibreOffice).
- **`--quiet` / `-q`:** just the bare integer (`12`), pipe-friendly. On failure:
  nothing on stdout, reason on stderr, non-zero exit.
- **`--json`:** a JSON object to stdout (no file written):

```json
{ "file": "myfile.pdf", "type": "pdf", "pageCount": 12, "status": "ok" }
```

  On failure: `"pageCount": null` with the `status`/`error`, plus a non-zero exit.

### Exit codes

- **0** — all inputs handled. (Spreadsheet rows that failed are data, not errors.)
- **non-zero** — a document-mode count failed, an input couldn't be read/parsed, no
  URL column could be found, or an input was an unsupported kind.

## 10. Module architecture

```
src/
  cli.ts            # parse argv (commander) → Config; invoke run()
  config.ts         # Config type, defaults, resolution
  types.ts          # Table, Row, RowResult, FileType, Status, InputKind
  input.ts          # classify each arg: spreadsheet | document(local|url) | error
  run.ts            # orchestrator: dispatch each input to the right mode
  spreadsheet/
    read.ts         # readTable(path) → { table, write }   (csv | xlsx dispatch)
    write.ts        # csv re-emit  /  xlsx workbook-preserving append
    process.ts      # detect column · per-row pipeline · fill counts · summary
  document.ts       # single-document mode: classify · count · print · exit code
  detectColumn.ts   # pick URL column by http(s) match ratio (+ --column override)
  url.ts            # isFullUrl(); classifyType() fallback chain
  fetch.ts          # download to temp file: timeout, size cap, redirects, User-Agent
  counters/
    index.ts        # dispatch by FileType → counter (shared by both modes)
    pdf.ts          # pdf-lib → getPageCount
    pptx.ts         # zip → presentation.xml sldIdLst count
    docx.ts         # zip → app.xml <Pages>; else render fallback / no-page-data
  render/
    libreoffice.ts  # detect soffice; docx→pdf convert (only when rendering)
  pool.ts           # concurrency-limited map (p-limit)
  report.ts         # terminal summaries (spreadsheet & document) + JSON builders
  errors.ts         # status/error taxonomy + mapping helpers
test/
  fixtures/         # 3-page.pdf, 5-slide.pptx, with-meta.docx, no-meta.docx, *.csv, *.xlsx
  *.test.ts
```

### Key interfaces (sketch)

```ts
type FileType = 'pdf' | 'docx' | 'pptx';
type InputKind =
  | { kind: 'spreadsheet'; path: string }
  | { kind: 'document'; source: string; remote: boolean }
  | { kind: 'unsupported'; arg: string };

type Status =
  | 'ok' | 'no-url' | 'unsupported' | 'not-found' | 'http-error'
  | 'timeout' | 'network-error' | 'too-large' | 'corrupt'
  | 'encrypted' | 'no-page-data';

interface RowResult {
  row: number;                 // 1-based source row
  url: string | null;
  type: FileType | null;
  pageCount: number | null;
  status: Status;
  error?: string;
}

interface CountOutcome { pageCount: number | null; status: Status; error?: string; rendered?: boolean; }
type PageCounter = (filePath: string, cfg: Config) => Promise<CountOutcome>;

interface LoadedSpreadsheet {
  table: { header: string[]; rows: string[][] };
  write: (outPath: string, counts: (number | null)[], countHeader: string) => Promise<void>;
}
```

## 11. Dependencies

| Concern | Pick | Why |
|---|---|---|
| CLI args / help | `commander` | mature, clean `--help` |
| CSV read/write | `csv-parse` + `csv-stringify` | streaming, robust quoting |
| XLSX read/write | `exceljs` | reads *and* rewrites preserving formatting/sheets |
| PDF count | `pdf-lib` | one-call page count, pure JS |
| ZIP (docx/pptx) | `fflate` | tiny, pure-JS, no native build step |
| XML parse | `fast-xml-parser` | for `app.xml` / `presentation.xml` |
| Concurrency | `p-limit` | simple N-wide pool |
| Polish (optional) | `picocolors`, `cli-progress` | colored output, progress for 2–3k rows |
| Build | `tsup` (esbuild) | bundle to a single `dist/cli.js` |
| Test | `vitest` | fast, TS-native |

## 12. Testing strategy

Test-first (TDD). One suite per module:

- **input** — classify args into spreadsheet / document(local|url) / unsupported.
- **detectColumn** — URL column in varying positions; mixed/empty cells; override.
- **url** — `isFullUrl` edge cases; `classifyType` across extension / Content-Type / magic-byte paths.
- **counters** — real fixtures with known counts: a 3-page PDF, a 5-slide PPTX, a
  DOCX *with* `<Pages>` metadata and one *without*; encrypted/corrupt PDF cases.
- **fetch** — against a local HTTP server fixture: success, 404, redirect, timeout, oversize.
- **spreadsheet** — round-trip CSV and XLSX; confirm XLSX formatting/extra sheets survive.
- **document mode** — local PDF prints expected line; `--quiet` prints bare integer;
  `--json` shape; failure → stderr + non-zero exit code.
- **end-to-end** — a small CSV (and XLSX) run through `run()` against the local server;
  assert the output column values and the printed summary.

## 13. Distribution

- **Runtime:** Node 20+ (stable native `fetch`; no HTTP-client dependency).
- **Build:** TypeScript → `tsup` → `dist/cli.js` with a `#!/usr/bin/env node` shebang.
- **`package.json`:** `"type": "module"`, `"bin": { "pagecount": "dist/cli.js" }`.
- **Dev:** `npm link` exposes `pagecount` on PATH locally.
- **Install:** `npm i -g .` (or publish to npm). A Homebrew tap is an easy later add.

## 14. Future / possible extensions (not v1)

- Resume/checkpoint for very large or flaky runs.
- `--no-header`, `--sheet <name>` selection for XLSX.
- Per-URL retry with backoff; on-disk cache keyed by URL.
- Additional formats (`.odt`, `.doc`, images as 1 page, etc.).
- Concurrency across files, not just within a file.
