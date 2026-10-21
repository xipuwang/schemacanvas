/**
 * Pure-ish logic of the issues dock: grouping, filtering and click-to-highlight.
 * Selection and fitting go through the editor store and the command registry's canvas handle (never the DOM).
 */
import { commandContext } from '@/editor';
import { resolveRefsInDiagram } from '@/model/diagramSync';
import type { Diagram, Id, Issue, Project, SemanticRef, Severity } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { editorStore } from '@/store';
import { uiStore } from '../../uiStore';

export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Most severe first; ties keep validation order (stable). */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  return issues.map((issue, i) => ({ issue, i })).sort((a, b) => RANK[a.issue.severity] - RANK[b.issue.severity] || a.i - b.i).map((x) => x.issue);
}

export function filterIssues(issues: readonly Issue[], shown: ReadonlySet<Severity>): Issue[] {
  return issues.filter((i) => shown.has(i.severity));
}

export interface IssueTarget {
  nodeIds: Id[];
  edgeIds: Id[];
  /** Selection payload for `store.setSelection(ids, sub)`. */
  ids: Id[];
  sub?: SemanticRef;
}

/** What an issue points at on `diagram` (empty when its refs live in another model). */
export function resolveIssueTarget(project: Project, diagram: Diagram, issue: Pick<Issue, 'affected'>): IssueTarget {
  const r = resolveRefsInDiagram(project, diagram, issue.affected);
  const ids = [...r.nodeIds, ...r.edgeIds];
  let sub: SemanticRef | undefined;
  if (r.columnIds.length > 0) {
    sub = issue.affected.find((a) => a.kind === 'column' && r.columnIds.includes(a.id));
  } else if (r.nodeIds.length === 0 && r.edgeIds.length === 1) {
    sub = issue.affected.find((a) => a.kind === 'foreignKey');
  }
  return { nodeIds: r.nodeIds, edgeIds: r.edgeIds, ids, sub };
}

/** First OTHER diagram (tab order) that shows something this issue is about, preferring one of a different model. */
export function findOtherDiagram(project: Project, activeDiagramId: Id | null, issue: Pick<Issue, 'affected'>): Diagram | undefined {
  const active = activeDiagramId ? project.diagrams[activeDiagramId] : undefined;
  for (const id of project.diagramOrder) {
    const d = project.diagrams[id];
    if (!d || d.id === active?.id || d.modelId === active?.modelId) continue;
    if (resolveIssueTarget(project, d, issue).ids.length > 0) return d;
  }
  return undefined;
}

/** Nodes to fit for a target: its nodes, plus the endpoints of its edges (a FK edge alone has no node of its own). */
function fitNodeIds(project: Project, diagram: Diagram, target: IssueTarget): Id[] {
  if (target.nodeIds.length > 0 || target.edgeIds.length === 0) return target.nodeIds;
  const scene = buildScene(project, diagram.id);
  const out = new Set<Id>();
  for (const e of target.edgeIds) {
    const g = scene.edges[e];
    if (g) {
      out.add(g.sourceNodeId);
      out.add(g.targetNodeId);
    }
  }
  return [...out];
}

export type FocusOutcome = 'selected' | 'other-model' | 'none';

/** Click-to-highlight: mark the issue focused, select what it affects on the active diagram and fit it in view. */
export function focusIssueOnCanvas(issue: Issue): FocusOutcome {
  const { project, activeDiagramId } = editorStore.getState();
  const ui = uiStore.getState();
  ui.focusIssue(issue.id);
  const diagram = activeDiagramId ? project.diagrams[activeDiagramId] : undefined;
  if (!diagram) return 'none';
  const target = resolveIssueTarget(project, diagram, issue);
  if (target.ids.length === 0) return findOtherDiagram(project, activeDiagramId, issue) ? 'other-model' : 'none';
  editorStore.getState().setSelection(target.ids, target.sub);
  const nodes = fitNodeIds(project, diagram, target);
  if (nodes.length > 0) commandContext().canvas?.fitToNodes(nodes);
  return 'selected';
}

/**
 * Switch to `diagramId`, select what `refs` resolve to there and fit it once the new canvas has mounted.
 * Returns false when nothing resolves (the diagram is still activated).
 */
export function selectRefsOnDiagram(diagramId: Id, refs: SemanticRef[]): boolean {
  const store = editorStore.getState();
  const diagram = store.project.diagrams[diagramId];
  if (!diagram) return false;
  store.setActiveDiagram(diagramId);
  const target = resolveIssueTarget(store.project, diagram, { affected: refs });
  if (target.ids.length === 0) return false;
  editorStore.getState().setSelection(target.ids, target.sub);
  const nodes = fitNodeIds(store.project, diagram, target);
  let tries = 0;
  const fit = (): void => {
    const canvas = commandContext().canvas;
    if (canvas && editorStore.getState().activeDiagramId === diagramId) {
      if (nodes.length > 0) canvas.fitToNodes(nodes);
      return;
    }
    if (++tries < 20) setTimeout(fit, 30);
  };
  setTimeout(fit, 30);
  return true;
}

/** Switch to the diagram that shows the issue, then select and fit it. */
export function showIssueInDiagram(issue: Issue, diagramId: Id): void {
  uiStore.getState().focusIssue(issue.id);
  selectRefsOnDiagram(diagramId, issue.affected);
}

export function focusCanvas(): void {
  commandContext().canvas?.focus();
}
