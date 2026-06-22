// Prefix a leading formula-trigger char with a single quote so spreadsheet apps
// treat the cell as text, not a live formula (CSV/Excel injection defense).
export function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
