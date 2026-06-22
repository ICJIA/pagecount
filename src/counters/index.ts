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
