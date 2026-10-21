import { projectFileName } from '@/persistence/files';

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * One path-safe, Unicode-preserving file name part (NFC, no separators/control chars, <= 80 code points, never empty).
 * Reuses the project-file sanitiser so Save and Export agree.
 */
export function sanitizeFilePart(name: string, fallback: string): string {
  const full = projectFileName((name ?? '').normalize('NFC'));
  let part = full.slice(0, full.length - '.schemacanvas.json'.length);
  if (!part || part === 'project') part = (name ?? '').trim() === 'project' ? 'project' : fallback;
  if (RESERVED.test(part)) part = `_${part}`;
  return part;
}

const EXT_JSON = '.schemacanvas.json';

/**
 * `<project> - <diagram>.<ext>`. For `json` the whole project is exported, so the name is `<project>.schemacanvas.json`.
 * `ext` may be given with or without a leading dot.
 */
export function suggestFilename(
  project: { name: string },
  diagram: { name: string } | undefined,
  ext: string,
): string {
  const e = ext.replace(/^\./, '').toLowerCase();
  const proj = sanitizeFilePart(project.name, 'project');
  if (e === 'json') return `${proj}${EXT_JSON}`;
  const dgm = diagram ? sanitizeFilePart(diagram.name, 'diagram') : '';
  return dgm ? `${proj} - ${dgm}.${e}` : `${proj}.${e}`;
}
