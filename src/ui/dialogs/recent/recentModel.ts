/** Pure helpers of the Recent projects dialog (counts, thumbnail, typed load outcome). */
import { localizeLoadError } from '@/i18n';
import { loadRecent, type RecentProject } from '@/persistence';
import type { LoadResult } from '@/model/io';
import type { Project } from '@/model/types';

export interface ProjectCounts {
  entities: number;
  tables: number;
  diagrams: number;
}

export function countProject(p: Readonly<Project>): ProjectCounts {
  let entities = 0;
  let tables = 0;
  for (const m of Object.values(p.models)) {
    if (m.kind === 'er') entities += Object.keys(m.entities).length;
    else tables += Object.keys(m.relations).length;
  }
  return { entities, tables, diagrams: p.diagramOrder.length };
}

/** SVG markup of the first diagram that has content (else the first diagram); undefined when nothing can be drawn. */
export async function thumbnailSvg(p: Readonly<Project>): Promise<string | undefined> {
  const id = p.diagramOrder.find((d) => Object.keys(p.diagrams[d]?.nodes ?? {}).length > 0);
  const diagram = id ? p.diagrams[id] : undefined;
  if (!id || !diagram) return undefined;
  try {
    // dynamic: react-dom/server (the standalone renderer) must not be part of the entry bundle
    const [{ renderSceneToSvgString }, { buildScene }] = await Promise.all([import('@/render/standalone'), import('@/scene/registry')]);
    return renderSceneToSvgString(buildScene(p as Project, id), p as Project, diagram, { padding: 12 });
  } catch {
    return undefined;
  }
}

export type RecentLoad = { status: 'ok'; project: Project; repairs: number } | { status: 'missing' } | { status: 'corrupt'; code: string; message: string };

/** Read one stored project, mapping the persistence result to a UI outcome. */
export async function loadRecentOutcome(id: string): Promise<RecentLoad> {
  const r: LoadResult | null = await loadRecent(id);
  if (!r) return { status: 'missing' };
  if (!r.ok) return { status: 'corrupt', code: r.error.code, message: localizeLoadError(r.error) };
  return { status: 'ok', project: r.project, repairs: r.repairs.length };
}

export type { RecentProject };
