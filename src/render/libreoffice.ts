import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const CANDIDATES = [
  process.env.PAGECOUNT_SOFFICE,
  'soffice',
  'libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter((c): c is string => Boolean(c));

export function findLibreOffice(): string | null {
  for (const cmd of CANDIDATES) {
    if (cmd.includes('/')) {
      if (existsSync(cmd)) return cmd;
      continue;
    }
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (r.status === 0) return cmd;
  }
  return null;
}

export interface RenderedPdf {
  pdfPath: string;
  cleanup: () => Promise<void>;
}

export async function renderDocxToPdf(
  filePath: string,
  soffice: string | null = findLibreOffice(),
): Promise<RenderedPdf> {
  if (!soffice) throw new Error('LibreOffice not found');
  const outDir = await mkdtemp(join(tmpdir(), 'pc-render-'));
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      soffice,
      ['--headless', `-env:UserInstallation=file://${outDir}`, '--convert-to', 'pdf', '--outdir', outDir, filePath],
      { stdio: 'ignore', timeout: 60_000 },
    );
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`soffice exited with code ${code}`))));
  });
  return {
    pdfPath: join(outDir, basename(filePath).replace(/\.[^.]+$/, '') + '.pdf'),
    cleanup: () => rm(outDir, { recursive: true, force: true }),
  };
}
