// @vitest-environment node
/** P1 MODEL: convert -> applyConversionResult via the REAL store -> invariants -> validation -> undo/redo -> round trip. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import { useFixedClock } from '@/model/clock';
import { checkInvariants } from '@/model/invariants';
import { loadProjectData, parseProjectFile, serializeProject } from '@/model/io';
import { validateProject } from '@/validation';
import { EXAMPLES, EXAMPLE_KEYS, convertInStore, relModelOf, setupEr } from './helpers';

let restore: Array<() => void> = [];
beforeEach(() => {
  restore = [useDeterministicIds(), useFixedClock('2026-01-01T00:00:00.000Z')];
});
afterEach(() => restore.forEach((r) => r()));

const stable = (x: unknown) => JSON.parse(JSON.stringify(x));

describe.each(EXAMPLE_KEYS)('P1 model pipeline: example %s', (key) => {
  it('converts, applies in one commit, keeps invariants, validates clean, undo/redo exact, JSON round trip', async () => {
    const s = setupEr(EXAMPLES[key]());
    const { store } = s;
    const erBefore = stable(store.getState().project.models[s.erModelId]);

    // ER side validates clean before converting
    const erIssues = validateProject(store.getState().project, { modelId: s.erModelId });
    expect(erIssues.filter((i) => i.severity === 'error'), `ER errors: ${JSON.stringify(erIssues.filter((i) => i.severity === 'error').map((i) => i.code))}`).toEqual([]);

    const undoDepth = store.getState().undoStack.length;
    const c = await convertInStore(s);
    const after = store.getState().project;

    // ONE history entry
    expect(store.getState().undoStack.length).toBe(undoDepth + 1);
    expect(checkInvariants(after)).toEqual([]);
    // ER model untouched
    expect(stable(after.models[s.erModelId])).toEqual(erBefore);

    const rel = relModelOf(after, c.relModelId);
    expect(rel.kind).toBe('relational');
    expect(Object.keys(rel.relations).length).toBeGreaterThan(0);
    expect(after.conversions[c.report.conversionId]).toBeDefined();
    expect(after.conversions[c.report.conversionId]!.erModelId).toBe(s.erModelId);

    // validation: zero errors on both models
    const issues = validateProject(after);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.map((e) => `${e.code}:${e.title}`)).toEqual([]);
    // Every issue's affected refs resolve (click-to-highlight)
    for (const i of issues) expect(i.affected.length, i.code).toBeGreaterThan(0);

    // every relation has a PK
    for (const r of Object.values(rel.relations)) expect(r.primaryKey.length, r.name).toBeGreaterThan(0);

    // positions came through: not all nodes at one point
    const d = after.diagrams[c.relDiagramId]!;
    const pts = new Set(Object.values(d.nodes).map((n) => `${n.x},${n.y}`));
    expect(pts.size).toBe(Object.keys(d.nodes).length);

    // undo restores EXACT prior project, redo the result
    const converted = after;
    store.getState().undo();
    expect(store.getState().project).toEqual(c.before);
    expect(checkInvariants(store.getState().project)).toEqual([]);
    store.getState().redo();
    expect(store.getState().project).toEqual(converted);

    // serialisation round trip (positions, FK edges, routes, columnWidths survive)
    const text = serializeProject(converted, '2026-01-01T00:00:00.000Z');
    const loaded = parseProjectFile(text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.repairs).toEqual([]);
    expect(stable(loaded.project)).toEqual(stable(converted));
    const viaData = loadProjectData(JSON.parse(text));
    expect(viaData.ok && stable(viaData.project)).toEqual(stable(converted));
    expect(Object.keys(loaded.project.diagrams[c.relDiagramId]!.edges).length).toBe(Object.keys(d.edges).length);
  });
});

describe('P1 model pipeline: round trip keeps hand-set presentation data', () => {
  it('routes, columnWidths, node sizes and styles survive save/load of a converted project', async () => {
    const { setEdgeRoute, setColumnWidth, setNodeSize, setNodeStyle } = await import('@/model/ops');
    const s = setupEr(EXAMPLES.E());
    const c = await convertInStore(s);
    const d = s.store.getState().project.diagrams[c.relDiagramId]!;
    const edge = Object.values(d.edges)[0]!;
    const node = Object.values(d.nodes).find((n) => n.ref.kind === 'relation')!;
    const rel = relModelOf(s.store.getState().project, c.relModelId);
    const colId = rel.relations[node.ref.id]!.columns[0]!.id;
    s.store.getState().commit('presentation', (dr) => {
      setEdgeRoute(dr, c.relDiagramId, edge.id, { mode: 'manual', waypoints: [{ x: 5, y: 7 }, { x: 5, y: 90 }] });
      setColumnWidth(dr, c.relDiagramId, node.id, colId, 123);
      setNodeSize(dr, c.relDiagramId, node.id, { height: 44 });
      setNodeStyle(dr, c.relDiagramId, node.id, { fill: '#ffeecc' });
    });
    const p = s.store.getState().project;
    const r = parseProjectFile(serializeProject(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stable(r.project)).toEqual(stable(p));
    const dd = r.project.diagrams[c.relDiagramId]!;
    expect(dd.edges[edge.id]!.route.mode).toBe('manual');
    expect(dd.edges[edge.id]!.route.waypoints).toEqual([{ x: 5, y: 7 }, { x: 5, y: 90 }]);
    expect(dd.nodes[node.id]!.columnWidths![colId]).toBe(123);
    expect(dd.nodes[node.id]!.height).toBe(44);
  });
});
