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
