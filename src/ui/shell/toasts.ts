/**
 * Toast hygiene: a transient confirmation names things ("Created relationship Relationship1 ..."). When the user
 * renames something afterwards the text is stale, so transient toasts are dismissed as soon as any name in the project
 * changes after the toast appeared.
 */
import { editorStore } from '@/store';
import type { Project } from '@/model/types';
import { isTransientToast, uiStore } from '../uiStore';

/** All `name` strings of the project (models, diagrams, project) joined: changes when anything is renamed. */
export function namesSignature(project: Project): string {
  const out: string[] = [project.name];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'name' && typeof x === 'string') out.push(x);
      else if (k !== 'nodes' && k !== 'edges' && k !== 'viewport') walk(x, depth + 1);
    }
  };
  walk(project.models, 0);
  for (const d of Object.values(project.diagrams)) out.push(d.name);
  return out.join('\u0001');
}

const GUARD_MS = 150;

export function startToastHygiene(): () => void {
  const seen = new Map<number, { sig: string; at: number }>();
  const offUi = uiStore.subscribe((s) => {
    const live = new Set(s.toasts.map((x) => x.id));
    for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id);
    for (const x of s.toasts) if (!seen.has(x.id) && isTransientToast(x)) seen.set(x.id, { sig: namesSignature(editorStore.getState().project), at: Date.now() });
  });
  let lastProject = editorStore.getState().project;
  const offEditor = editorStore.subscribe((s) => {
    if (s.project === lastProject || seen.size === 0) {
      lastProject = s.project;
      return;
    }
    lastProject = s.project;
    const sig = namesSignature(s.project);
    const now = Date.now();
    for (const [id, rec] of seen) {
      if (sig === rec.sig) continue;
      if (now - rec.at < GUARD_MS) rec.sig = sig; // the commit that produced the toast
      else uiStore.getState().dismissToast(id);
    }
  });
  return () => {
    offUi();
    offEditor();
  };
}
