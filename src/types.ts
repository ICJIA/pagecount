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

export interface AppendColumn {
  header: string;
  values: (string | number | null)[];
}
