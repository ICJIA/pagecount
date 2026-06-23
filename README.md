# pagecount

> Add exact page counts to a spreadsheet of document URLs — or check a single file from the command line.

**Status:** Published on npm as [`@icjia/pagecount`](https://www.npmjs.com/package/@icjia/pagecount) —
implemented, tested, and security-hardened (136 passing tests). Built from the
[design spec](docs/superpowers/specs/2026-06-22-pagecount-cli-design.md).

`pagecount` is a command-line tool with two modes, chosen automatically by what you give it:

- **Spreadsheet mode** — given a CSV or XLSX with a column of public document URLs
  (PDF, DOCX, PPTX), it reads each file, counts its pages, and writes the spreadsheet
  with `programmatic_page_count` + `programmatic_page_count_notes` columns appended —
  as both a `.csv` and an `.xlsx`.
- **Document mode** — given a single document (a local file or a URL), it prints the
  page count and exits, writing nothing.

## Requirements

- **Node.js 20+** (uses the built-in `fetch`).
- **LibreOffice** *(optional)* — only needed to compute exact page counts for DOCX
  files that don't carry cached page metadata. See [DOCX page counts](#docx-page-counts).
- **poppler** (`pdfinfo`) *(optional)* — fallback for counting encrypted or unusual
  PDFs the built-in parser can't read. `brew install poppler`.

## Install

**Run without installing:**

```bash
npx @icjia/pagecount data.csv
```

**Install globally:**

```bash
npm i -g @icjia/pagecount
npm i -g github:ICJIA/pagecount            # or straight from GitHub (builds on install)
```

**From a clone (for development):**

```bash
npm install
npm run build
npm link          # puts `pagecount` on your PATH
```

## Usage

### Spreadsheet mode

```bash
pagecount data.csv
```

Reads `./data.csv`, finds the column of document URLs (preferring links to actual
pdf/docx/pptx files), counts pages, and writes:

```
./.pagecount-output/data-pagecount.csv
./.pagecount-output/data-pagecount.xlsx
```

The output is the original spreadsheet with **two columns appended at the far right**:
`programmatic_page_count` (the count) and `programmatic_page_count_notes` (why a row is
blank — e.g. `corrupt`, `unsupported`, `no-url`, `skipped (filtered out)`). They're always added, even if the
sheet already has a "Page Count" column. **Both a `.csv` and an `.xlsx` version are written every run.** The `.pagecount-output` directory is created
beside the input file (and reused if it already exists). The same works for `.xlsx`,
preserving the workbook's formatting and any extra sheets.

Multiple files and globs — each writes to its own `.pagecount-output` beside it:

```bash
pagecount *.csv
pagecount survey.csv ../reports/q3.xlsx
```

See [`samples/example.csv`](samples/example.csv) for the expected input shape — a
column of public document URLs (swap in your own URLs to try it).

### Filtering rows (remediation)

By default, spreadsheet mode counts pages only for rows whose **`Recommendation`** column
equals **`remediate`** (case-insensitive). This gives remediation vendors a single number
per site: the TOTAL row sums just the pages marked for remediation. Non-matching rows are
kept in place with a blank `programmatic_page_count` and `skipped (filtered out)` in the
notes column — and are never downloaded.

```bash
pagecount "samples/ICJIA R&A publications-as of 2026-05-29(DVFR).csv"
```

- Different column or values:
  `pagecount data.csv --filter-column Action --filter-value fix,review`
- Count **every** row (e.g. a sheet with no disposition column, or when you want all of
  them): `pagecount data.csv --no-filter`

If a sheet has no `Recommendation` column and you didn't pass `--filter-column`,
`pagecount` prints a one-line notice and counts every row.

### Document mode

Check a single file without touching a spreadsheet:

```bash
pagecount report.pdf
# report.pdf · pdf · 12 pages

pagecount slides.pptx -q
# 12

pagecount https://example.org/a.pdf --json
# { "file": "https://example.org/a.pdf", "type": "pdf", "pageCount": 8, "status": "ok" }
```

Nothing is written to disk. Exits non-zero if the file can't be counted.

## Options

| Option | Description | Default |
|---|---|---|
| `-o, --output <dir>` | (spreadsheet) force one shared output dir | `.pagecount-output` beside each file |
| `-c, --column <name\|index>` | (spreadsheet) URL column, by header name or 1-based index | auto-detect (prefers document links) |
| `--count-column <name>` | (spreadsheet) count column name (a `<name>_notes` column is added too) | `programmatic_page_count` |
| `--filter-column <name\|index>` | (spreadsheet) only count rows matching `--filter-value`; name or 1-based index | `Recommendation` |
| `--filter-value <values>` | (spreadsheet) comma-separated value(s) to match (exact, case-insensitive) | `remediate` |
| `--no-filter` | (spreadsheet) count every row, ignoring the default filter | off |
| `--suffix <text>` | (spreadsheet) output filename suffix; `""` to disable | `pagecount` |
| `--json` | emit JSON (sidecar file in spreadsheet mode; stdout in document mode) | off |
| `-q, --quiet` | (document) print only the bare page number | off |
| `--concurrency <n>` | parallel downloads per spreadsheet | `8` |
| `--timeout <sec>` | per-URL fetch timeout | `30` |
| `--max-size <mb>` | skip files larger than this | `100` |
| `--docx-render` | force LibreOffice render for DOCX | auto when available |
| `--allow-private-hosts` | allow fetching loopback/private/link-local hosts | off (blocked for SSRF safety) |
| `-h, --help` | show help | |
| `--version` | show version | |

## How page counts are determined

| Type | Method | Exact? |
|---|---|---|
| **PDF** | read from the file (with a `pdfinfo`/poppler fallback for encrypted/unusual PDFs) | ✅ yes |
| **PPTX** | slide count from `presentation.xml` | ✅ yes |
| **DOCX** | see below | ⚠️ depends |

### DOCX page counts

A `.docx` file has **no intrinsic page count** — pagination only exists once the
document is rendered (by Word, LibreOffice, etc.) and depends on fonts, margins, and
page size. `pagecount` handles DOCX in two ways:

1. **Cached metadata (default):** Word and most editors store a `<Pages>` value in the
   file when they save. `pagecount` reads it directly — fast, no extra tools.
2. **Render fallback:** if that value is missing and **LibreOffice** is installed (or
   you pass `--docx-render`), `pagecount` renders the document to PDF and counts the
   pages — the authoritative count.

If a DOCX has no cached value and LibreOffice isn't available, its
`programmatic_page_count` is left blank (spreadsheet mode) or reported as an error
(document mode). Counted DOCX rows are flagged as an estimate in the notes column —
pagination depends on fonts and margins.

## Output & errors (spreadsheet mode)

- Rows without a full `http(s)` URL get a **blank** `programmatic_page_count` and
  `no-url` in `programmatic_page_count_notes`.
- Rows whose URL fails (404, timeout, unsupported/corrupt file, encrypted PDF) also get
  a blank count, with the reason in `programmatic_page_count_notes`; failures are also
  counted in the terminal summary:

  ```
  data.csv  →  .pagecount-output/data-pagecount.csv
    150 rows · 14 counted · 132 filtered · 3 no-url · 1 failed · 318 total pages
      failed: 1 timeout
  ```

- Add `--json` for a sidecar file with the full per-row detail (URL, type, count,
  status, error).

## Security

`pagecount` fetches arbitrary URLs from your spreadsheet, so it includes basic
safeguards for untrusted input:

- **SSRF protection** — URLs (and any redirects they follow) that resolve to loopback,
  private, or link-local addresses are refused. Pass `--allow-private-hosts` if you
  intentionally need to reach an internal server.
- **Zip-bomb caps** — DOCX/PPTX archives are bounded (50 MB per entry, 200 MB total
  uncompressed, 4096 entries) so a malicious file can't exhaust memory.
- **Formula-injection defense** — output cells beginning with `=`, `+`, `-`, `@` are
  prefixed with `'` so they aren't executed as formulas when the report is opened.

These mitigate the common cases; they are not a substitute for fully sandboxing
genuinely hostile input.

**Known limitations** — DNS-rebinding / TOCTOU is *not* mitigated: the address
validated during the SSRF check can differ from the one the socket later connects to,
so don't run `pagecount` as a network-exposed service against untrusted input. DOCX
page counts are estimates (pagination depends on fonts, margins, and page size).

## Development

Requires **Node 20.19+** for the dev toolchain (the vite 8 / vitest 4 test stack); the
published CLI itself runs on **Node 20+**. The repo's `.nvmrc` pins a compatible version.

```bash
npm install
npm run build      # bundle to dist/
npm test           # vitest (136 tests)
```

See the [design spec](docs/superpowers/specs/2026-06-22-pagecount-cli-design.md) for
architecture and implementation details.

## License

[MIT](LICENSE) © 2026 Illinois Criminal Justice Information Authority
