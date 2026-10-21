/** Browser file helpers (DOM only; guarded so importing this module in Node is safe). */
import { parseProjectFile, serializeProject } from '@/model/io';
import type { LoadResult } from '@/model/io';
import type { Project } from '@/model/types';

export const PROJECT_FILE_EXTENSION = '.schemacanvas.json';

/** `My Project: v2/final?` → `My Project_ v2_final_.schemacanvas.json`; never empty, never a path. */
export function projectFileName(name: string): string {
  const cleaned0 = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // no hidden / relative names
    .trim();
  const cleaned = Array.from(cleaned0).slice(0, 80).join('').replace(/[. ]+$/, '').trim();
  return `${cleaned || 'project'}${PROJECT_FILE_EXTENSION}`;
}

/** Save the project as a `.schemacanvas.json` download. Returns the filename used. */
export function downloadProjectFile(project: Project, savedAt?: string): string {
  if (typeof document === 'undefined') throw new Error('downloadProjectFile requires a browser environment');
  const filename = projectFileName(project.name);
  const blob = new Blob([serializeProject(project, savedAt)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: some browsers start the download asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return filename;
}

function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
}

/** Read and parse a user-selected file. Never rejects: read failures come back as `not-json`. */
export async function openProjectFromFile(file: File): Promise<LoadResult> {
  let text: string;
  try {
    text = await readText(file);
  } catch (e) {
    return { ok: false, error: { code: 'not-json', message: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` } };
  }
  return parseProjectFile(text);
}
