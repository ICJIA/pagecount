# Changelog

All notable changes to `pagecount` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

## [0.2.2] — 2026-06-23

### Changed

- Dev tooling only: pinned `.nvmrc` to **Node 20.19** (minimum for the vite 8 / vitest 4
  test stack) and documented it in the README. No runtime or CLI change — the published
  CLI still requires only **Node 20+** (`engines` unchanged); runtime dependencies need
  at most Node 18.

## [0.2.1] — 2026-06-23

### Changed

- Updated **`fast-xml-parser` 4 → 5.7.0** (runtime dependency used to read PPTX/DOCX
  XML). No behavior change for `pagecount`'s usage; the PPTX/DOCX page-count paths and the
  full test suite (136 tests) pass.
- Dev tooling only (not shipped in the package): **`vitest` 2 → 4** and **`vite` 5 → 8**.

## [0.2.0] — 2026-06-23

### Added

- **Row filtering** — spreadsheet mode now counts only rows whose **`Recommendation`**
  column equals **`remediate`** (case-insensitive) by default, so the TOTAL reflects just
  the pages marked for remediation. Override with `--filter-column <name|index>` and
  `--filter-value <a,b,c>` (exact, case-insensitive, comma-separated alternatives).
  Non-matching rows keep a blank count with `skipped (filtered out)` in the notes column
  and are never downloaded.
- `--no-filter` to count every row regardless of the default filter.
- The terminal summary now reports the `filtered` row count and `total pages`.

### Changed

- **Behavior change:** spreadsheets containing a `Recommendation` column now auto-filter
  to `remediate` rows by default. Sheets without that column are unaffected (every row is
  counted, with a one-line notice); pass `--no-filter` to count all rows even when the
  column is present.

## [0.1.1] — 2026-06-22

### Added

- A **TOTAL row** at the bottom of each output spreadsheet (CSV and XLSX) that sums
  `programmatic_page_count` under that column, labelled `TOTAL` in the first column.

## [0.1.0] — 2026-06-22

Initial release.

### Added

- **Spreadsheet mode** — read a CSV/XLSX column of public document URLs (PDF/DOCX/PPTX),
  count each file's pages, and write the result with two appended columns,
  `programmatic_page_count` and `programmatic_page_count_notes`, as **both** a `.csv`
  and an `.xlsx`.
- **Document mode** — count a single local file or URL and print the result; exits
  non-zero on failure.
- **Page counting** — exact for PDF (via `pdf-lib`, with a `pdfinfo`/poppler fallback
  for encrypted or structurally unusual PDFs) and PPTX (slide count). DOCX uses cached
  `<Pages>` metadata or an optional LibreOffice render fallback, and is flagged as an
  estimate in the notes column (pagination depends on fonts/margins).
- **Smart URL-column auto-detection** that prefers columns linking to actual documents
  over columns of page/reference URLs; override with `--column`.
- Concurrency (default 8), per-URL timeout (default 30s), and a max-size cap (100MB).
- Output written to a `.pagecount-output/` directory beside each input, overwriting
  prior results (no versioned files); stale JSON sidecars are pruned.
- Optional JSON sidecar (`--json`) with full per-row detail.
- The `programmatic_page_count_notes` column records why a row is blank
  (`no-url`, `unsupported`, `not-found`, `timeout`, `corrupt`, …) and flags DOCX
  estimates.

### Security

- **SSRF protection** — refuses URLs (and every redirect hop) that resolve to
  loopback, private, link-local, or CGNAT addresses, using value-based IPv6 detection
  including IPv4-mapped, NAT64 (`64:ff9b::/96`), and 6to4 (`2002::/16`) forms that
  embed a private IPv4. Non-http(s) schemes are rejected. Opt out with
  `--allow-private-hosts`.
- **Decompression-bomb caps** — DOCX/PPTX archives are bounded (50 MB per entry,
  200 MB total uncompressed, and a 4096-entry cap).
- **Formula-injection neutralization** — output cells beginning with `=`, `+`, `-`,
  `@`, TAB, or CR are prefixed with `'` in both CSV and XLSX writers so spreadsheet
  apps treat them as text, not live formulas.
- **LibreOffice render hardening** — DOCX-render temp directories are now always
  cleaned up after use, the `soffice` conversion runs under a 60-second timeout, and
  it uses an isolated per-render user profile.
- **`--suffix` traversal rejection** — a suffix containing a path separator or `..`
  is refused so output paths can't escape the intended directory.
- **`--concurrency` clamp** — concurrency is capped at 64 to bound resource use.
- **Safer local-path handling** — local file paths are resolved to absolute before
  being passed to external tools, so a leading-dash filename can't be read as an
  option.

[0.2.2]: https://github.com/ICJIA/pagecount/releases/tag/v0.2.2
[0.2.1]: https://github.com/ICJIA/pagecount/releases/tag/v0.2.1
[0.2.0]: https://github.com/ICJIA/pagecount/releases/tag/v0.2.0
[0.1.1]: https://github.com/ICJIA/pagecount/releases/tag/v0.1.1
[0.1.0]: https://github.com/ICJIA/pagecount/releases/tag/v0.1.0
