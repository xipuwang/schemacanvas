import { describe, expect, it } from 'vitest';
import { createBareProject, createDiagram } from '@/model/defaults';
import type { Scene } from '@/scene/types';
import { assembleScene } from '@/scene/util';
import { registerEdgeView, registerNodeView } from './registry';
import { renderSceneToSvgStringCore } from './standaloneCore';
import { SvgLabel } from './svgText';
import { deepFreeze } from '@/test/deepFreeze';

/** Smoke test: the SVG export path (react-dom/server + the Core + registries) works under vitest in Node. */
describe('renderSceneToSvgStringCore', () => {
  it('renders a hand-built scene: concrete colours, explicit underline line, edge-label layer, bounds with padding', () => {
    const project = createBareProject();
    const diagram = createDiagram('relational-schema', 'mdl_x');
    const font = { family: 'Helvetica', size: 14 };
    const label = { text: 'Hello', x: 60, y: 40, anchor: 'middle' as const, font, width: 35, underline: 'solid' as const };
    diagram.nodes.n1 = { id: 'n1', ref: { kind: 'relation', id: 'r1' }, x: 10, y: 20 };
    diagram.edges.e1 = { id: 'e1', ref: { kind: 'foreignKey', foreignKeyId: 'fk1' }, route: { mode: 'auto', waypoints: [] } };
    const rect = { x: 10, y: 20, w: 100, h: 40 };
    const nodes: Scene['nodes'] = {
      n1: { kind: 'h-table', nodeId: 'n1', ref: { kind: 'relation', id: 'r1' }, bounds: rect, paintBounds: { x: 9, y: 19, w: 102, h: 42 }, outline: { kind: 'rect', rect }, nameLabel: label, row: rect, cells: [] },
    };
    const edges: Scene['edges'] = {
      e1: {
        kind: 'fk', edgeId: 'e1', ref: { kind: 'foreignKey', foreignKeyId: 'fk1' }, sourceNodeId: 'n1', targetNodeId: 'n1',
        paths: [[{ x: 0, y: 0 }, { x: 300, y: 0 }]], bounds: { x: -1, y: -1, w: 302, h: 2 },
        ends: [{ nodeId: 'n1', at: { x: 0, y: 0 }, side: 'left', anchorRect: rect }, { nodeId: 'n1', at: { x: 300, y: 0 }, side: 'right', anchorRect: rect }],
        bendHandles: [], autoWaypoints: [], style: 'branches', branches: [],
        labels: [{ id: 'main', label: { ...label, text: 'Patient.DoctorSSN → Doctor.SSN', x: 150, y: -10, width: 150, backdrop: true } }],
      },
    };
    registerNodeView('h-table', ({ geom, ctx }) => <SvgLabel label={(geom as { nameLabel: typeof label }).nameLabel} color={ctx.palette.text} />);
    registerEdgeView('fk', ({ geom }) => <polyline points={geom.paths[0]!.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" />);
    const scene = deepFreeze(assembleScene(diagram, nodes, edges));
    const svg = renderSceneToSvgStringCore(scene, deepFreeze(project), deepFreeze(diagram), { padding: 10 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('data-node-id="n1"');
    expect(svg).toContain('data-layer="edge-labels"');
    expect(svg).toContain('<line '); // underline is an explicit line, never text-decoration
    expect(svg).not.toContain('text-decoration');
    expect(svg).not.toContain('var(--'); // concrete colours only
    expect(svg).not.toContain('<marker');
    // viewBox covers the union of node paintBounds and edge bounds plus padding
    expect(scene.bounds.x).toBeLessThanOrEqual(-1);
    expect(scene.bounds.x + scene.bounds.w).toBeGreaterThanOrEqual(301);
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(vb[1])).toBeLessThanOrEqual(scene.bounds.x - 10);
  });
});
