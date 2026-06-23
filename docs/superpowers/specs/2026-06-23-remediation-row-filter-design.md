# Remediation row filter — design

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Component:** `@icjia/pagecount` CLI

## Goal & context

Remediation vendors need a single number per site: **how many total pages are in the
files marked for remediation.** Audit spreadsheets (e.g. the DVFR sheet) carry a
`Recommendation` column whose cells say `Accessible`, `Remediate`, `Remove`, etc. We want
`programmatic_page_count` (and its `_notes`) computed **only** for the rows marked
`Remediate`, and a TOTAL that sums just those — while still supporting sheets where every
row should be counted.

The current pipeline (`processSpreadsheet` → `mapWithConcurrency` over rows) already
iterates row-by-row, so the filter is a **predicate evaluated before the download**: a
non-matching row short-circuits to a "skipped" result and is never fetched. Filtering is
therefore also a performance win (fewer downloads).

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Match logic | **Exact, case-insensitive**, whitespace-trimmed. Comma-separated alternatives allowed. |
| Skipped rows | **Kept in place**, `programmatic_page_count` blank, `_notes` = `skipped (filtered out)`. |
| CLI shape | **Two flags**: `--filter-column <name\|index>` + `--filter-value <values>` (consistent with `--column` / `--count-column`). |
| Default behavior | **Filter ON by default**: `--filter-column` defaults to `Recommendation`, `--filter-value` defaults to `remediate`. |
| Missing default column | **Count all + notice**: if the *default* column is absent, skip filtering, count every row, and print a one-line notice. An *explicit* `--filter-column` that is absent is an error. `--no-filter` forces all-rows even when the column exists. |

## Design

### 1. CLI surface (`src/cli.ts`)

```
--filter-column <name|index>   column to filter on; header name or 1-based index
                               (default: Recommendation)
--filter-value <values>        comma-separated value(s) to match, exact & case-insensitive
                               (default: remediate)
--no-filter                    count every row, ignoring the default filter
```

`--no-filter` uses Commander's `--no-x` negation: `opts.filter` is `true` by default and
`false` when the flag is passed. `main()` forwards `noFilter: opts.filter === false`.

Bare invocation now performs the remediation count:

```
pagecount "samples/ICJIA R&A publications-as of 2026-05-29(DVFR).csv"
→ programmatic_page_count filled only for Remediate rows; TOTAL = total pages to remediate
```

### 2. Column resolution (`src/detectColumn.ts`)

Extract the existing override logic (current lines 9–23) into reusable helpers:

- `findColumn(table, ref): number | undefined` — resolve a header name (case-insensitive,
  trimmed) or a 1-based index; return `undefined` when not found or index out of range.
- `resolveColumn(table, ref, flagName): number` — `findColumn` or throw a `flagName`-aware
  error (`--filter-column "X" not found in header`, `--filter-column index N is out of range`).

`detectUrlColumn` keeps its auto-detect, but its override branch delegates to
`resolveColumn(..., '--column')`. The filter uses `resolveColumn` for an **explicit**
column and `findColumn` (non-throwing) for the **default** column.

### 3. Config (`src/config.ts`)

```ts
export interface FilterSpec {
  column: string;          // name or index ref, as given/defaulted
  columnExplicit: boolean; // true only if the user passed --filter-column
  values: string[];        // trimmed, lowercased, de-duped, non-empty
}

interface Config {
  // …existing…
  filter: FilterSpec | null; // null only when --no-filter
}
```

`DEFAULTS` gains `filterColumn: 'Recommendation'` and `filterValue: 'remediate'`.
`RawOptions` gains `filterColumn?`, `filterValue?`, `noFilter?`.

`resolveConfig`:
- `noFilter` → `filter = null`.
- else `column = raw.filterColumn ?? DEFAULTS.filterColumn`;
  `columnExplicit = raw.filterColumn != null && raw.filterColumn !== ''`;
  `values = unique(split(raw.filterValue ?? DEFAULTS.filterValue, ',').map(trim+lowercase).filter(Boolean))`;
  throw if `values` is empty.

### 4. Filtering data flow (`src/spreadsheet/process.ts`)

After detecting the URL column, resolve the filter once:

```
let filterCol: number | null = null;
const warnings: string[] = [];
if (cfg.filter) {
  const idx = findColumn(table, cfg.filter.column);
  if (idx !== undefined) filterCol = idx;
  else if (cfg.filter.columnExplicit)
    throw new Error(`--filter-column "${cfg.filter.column}" not found in header`);
  else warnings.push(`No "${cfg.filter.column}" column found; counted all rows.`);
}
const accept = cfg.filter ? new Set(cfg.filter.values) : null;
```

In the per-row worker, **before** URL extraction / fetch:

```
if (filterCol !== null && accept) {
  const v = (row[filterCol] ?? '').trim().toLowerCase();
  if (!accept.has(v))
    return { row: rowNumber, url: null, type: null, pageCount: null, status: 'filtered' };
}
```

`ProcessResult` gains `warnings: string[]`; matched rows proceed exactly as today.

### 5. Status, reporting, summary (`src/types.ts`, `src/report.ts`)

- `Status` gains `'filtered'`.
- `Summary` gains `filtered: number` and `totalPages: number`.
- `summarize`: count `'filtered'` separately (not as `failed`); `totalPages` = sum of
  numeric `pageCount`s.
- `formatSpreadsheetSummary`:
  `N rows · M counted · K filtered · P no-url · F failed · T total pages`.
- `rowNote`: `if (r.status === 'filtered') return 'skipped (filtered out)';` (before the
  generic non-ok branch).
- `runSpreadsheet` prints any `warnings` (the missing-default-column notice) alongside the
  summary.

### 6. TOTAL row — no change (verified)

`buildTotalRow` (`src/spreadsheet/total.ts:10-12`) sums only `typeof v === 'number'`
values. Filtered rows carry `pageCount: null`, so they are excluded and the TOTAL equals
the total remediation page count. No code change; covered by a test.

### 7. Document mode — unaffected

Filter logic lives entirely in `processSpreadsheet`. `pagecount file.pdf` / URL behavior is
unchanged; filter flags are simply not consulted.

## Behavior change & migration

Today `pagecount sheet.csv` counts every row. After this change, a sheet that **has** a
`Recommendation` column auto-filters to `Remediate`. Mitigations: the soft fallback (sheets
without the column are unaffected) and `--no-filter`. Call this out prominently in
CHANGELOG as a behavior change; bump the minor version.

## Edge cases

- `--filter-value ""` or all-empty after splitting → error (empty value list).
- Explicit `--filter-column` absent / index out of range → error.
- Default column absent → notice + count all.
- Filter column cell empty → does not match (empty is never an accepted value).
- `--no-filter` → identical to pre-change behavior (count all rows).
- `--no-filter` takes precedence: if combined with `--filter-column`/`--filter-value`, the
  filter is disabled (count all). No error.
- Custom column with default value: `--filter-column Action` keeps `--filter-value`
  defaulting to `remediate` unless overridden (documented; independent defaults).

## Testing

- `detectColumn.test.ts` — `findColumn` / `resolveColumn`: by name, by index, not-found
  (undefined vs throw), out-of-range.
- `config.test.ts` — defaults applied; `columnExplicit` flag; value split/normalize/dedupe;
  empty-value error; `--no-filter` → `filter: null`.
- `spreadsheet/process.test.ts` — default filter counts only `Remediate`; case-insensitive;
  multi-value; `--no-filter` counts all; explicit-missing-column throws; default-missing-column
  warns + counts all; **filtered rows are never fetched** (assert the counter/fetch is not
  called for them).
- `report.test.ts` — `rowNote('filtered')`; `summarize` filtered + totalPages; summary line.
- `spreadsheet/total.test.ts` — TOTAL equals sum over matched rows only (nulls excluded).

## Docs

- README: new flags; default-filter behavior; DVFR example; `--no-filter` for every-row sheets.
- CHANGELOG: feature entry + the behavior-change callout; `--version` / help text synced.

## Out of scope (YAGNI)

- Auto-detecting which column means "disposition."
- A per-sheet config/mapping file (the flag design doesn't preclude adding it later).
- Substring / regex matching.
- Numeric / range filters.
