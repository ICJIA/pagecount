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
