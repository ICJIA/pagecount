import type { Config } from './config';
import { countLocalFile, countUrl, type CountResult } from './counting';

export function countDocument(source: string, remote: boolean, cfg: Config): Promise<CountResult> {
  return remote ? countUrl(source, cfg) : countLocalFile(source, cfg);
}
