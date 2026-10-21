// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import { checkInvariants } from '@/model/invariants';
import { OpError } from '@/model/ops';
import type { Project } from '@/model/types';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { validateProject } from '@/validation';
import { buildScene } from '@/scene/registry';
import { nodeOverlaps } from '@/integration/helpers';
import '@/i18n';
import { t } from '@/i18n/core';
import { EXAMPLES, TEMPLATES, buildExample, insertTemplate, renderExampleThumbnail } from './index';

function erTarget(): { p: Project; diagramId: string } {
  const p = createBareProject('t');
  const b = erBuilder('Existing');
  b.entity('Zebra').key('ZebraId');
  const d = withDiagram(p, b.build(), 'chen');
  return { p, diagramId: d.id };
}
function relTarget(): { p: Project; diagramId: string } {
  const p = createBareProject('t');
  const b = relationalBuilder('Existing');
  b.relation('Parent', ['ParentId'], { pk: ['ParentId'] });
  const d = withDiagram(p, b.build(), 'relational-schema');
  return { p, diagramId: d.id };
}

describe('templates', () => {
  it('lists five ER and two relational templates with i18n keys that resolve in en and zh', () => {
    expect(TEMPLATES.filter((x) => x.modelKind === 'er')).toHaveLength(5);
    expect(TEMPLATES.filter((x) => x.modelKind === 'relational')).toHaveLength(2);
    for (const tpl of TEMPLATES) for (const key of [tpl.titleKey, tpl.descriptionKey]) {
      expect(t(key, undefined, 'en')).not.toBe(key);
      expect(t(key, undefined, 'zh')).not.toBe(key);
    }
    for (const e of EXAMPLES) for (const key of [e.titleKey, e.descriptionKey, `examples.level.${e.level}`]) {
      expect(t(key, undefined, 'en')).not.toBe(key);
      expect(t(key, undefined, 'zh')).not.toBe(key);
    }
  });

  it('build() is deterministic and self-contained', () => {
    for (const tpl of TEMPLATES) {
      const a = tpl.build();
      expect(tpl.build()).toEqual(a);
      expect(a.format).toBe('schemacanvas-clipboard');
      expect(a.modelKind).toBe(tpl.modelKind);
      expect(a.nodes.length).toBeGreaterThan(1);
    }
  });

  it.each(TEMPLATES.filter((x) => x.modelKind === 'er').map((x) => x.id))('ER template %s inserts with fresh ids and keeps every invariant', (id) => {
    const { p, diagramId } = erTarget();
    const before = Object.keys(p.models[Object.keys(p.models)[0]!]!);
    const payload = TEMPLATES.find((x) => x.id === id)!.build();
    const oldIds = new Set<string>();
    JSON.stringify(payload, (k, v) => { if (typeof v === 'string' && /^[a-z]{2,3}_\d+$/.test(v)) oldIds.add(v); return v; });
    const res = insertTemplate(p, diagramId, id, { x: 400, y: 300 });
    expect(res.nodeIds.length).toBe(payload.nodes.length);
    expect(checkInvariants(p)).toEqual([]);
    // every id the template used was remapped: none of them exists in the project any more
    const text = JSON.stringify(p);
    for (const old of oldIds) expect(text.includes(`"${old}"`)).toBe(false);
    // placed with its top-left corner at `at`
    const d = p.diagrams[diagramId]!;
    const placed = res.nodeIds.map((n) => d.nodes[n]!);
    expect(Math.min(...placed.map((n) => n.x))).toBe(400);
    expect(Math.min(...placed.map((n) => n.y))).toBe(300);
    expect(nodeOverlaps(buildScene(p, diagramId)).filter(([a, b]) => res.nodeIds.includes(a) && res.nodeIds.includes(b))).toEqual([]);
    expect(buildScene(p, diagramId).warnings).toEqual([]);
    expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
    expect(before.length).toBeGreaterThan(0);
  });

  it.each(TEMPLATES.filter((x) => x.modelKind === 'relational').map((x) => x.id))('relational template %s inserts with fresh ids, foreign keys intact', (id) => {
    const { p, diagramId } = relTarget();
    const res = insertTemplate(p, diagramId, id, { x: 40, y: 200 });
    expect(res.nodeIds.length).toBeGreaterThan(1);
    expect(checkInvariants(p)).toEqual([]);
    const model = Object.values(p.models)[0]!;
    if (model.kind !== 'relational') throw new Error('model kind');
    expect(Object.keys(model.foreignKeys).length).toBeGreaterThan(0);
    for (const fk of Object.values(model.foreignKeys)) {
      expect(model.relations[fk.sourceRelationId]).toBeDefined();
      expect(model.relations[fk.targetRelationId]).toBeDefined();
    }
    expect(buildScene(p, diagramId).warnings).toEqual([]);
    expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('inserting twice gives distinct ids', () => {
    const { p, diagramId } = erTarget();
    const a = insertTemplate(p, diagramId, 'ternary', { x: 0, y: 0 });
    const b = insertTemplate(p, diagramId, 'ternary', { x: 0, y: 600 });
    expect(a.nodeIds.filter((n) => b.nodeIds.includes(n))).toEqual([]);
    expect(checkInvariants(p)).toEqual([]);
  });

  it('a name collision is reported by validation, never silently renamed or merged', () => {
    const { p, diagramId } = erTarget();
    insertTemplate(p, diagramId, 'weak-entity', { x: 0, y: 0 });
    insertTemplate(p, diagramId, 'weak-entity', { x: 0, y: 400 });
    expect(checkInvariants(p)).toEqual([]);
    expect(validateProject(p).some((i) => i.code === 'er.entity-name-duplicate')).toBe(true);
  });

  it('refuses the wrong kind of diagram and unknown templates', () => {
    const { p, diagramId } = relTarget();
    expect(() => insertTemplate(p, diagramId, 'ternary', { x: 0, y: 0 })).toThrow(OpError);
    expect(() => insertTemplate(p, diagramId, 'nope', { x: 0, y: 0 })).toThrow(/Unknown template/);
  });
});

describe('thumbnails', () => {
  it.each(EXAMPLES.flatMap((e) => (['er', 'relational'] as const).map((k) => [e.id, k] as const)))('%s %s renders a standalone SVG', (id, kind) => {
    const svg = renderExampleThumbnail(id, kind);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toMatch(/viewBox="/);
    expect(svg).not.toMatch(/var\(--/);
    expect(renderExampleThumbnail(id, kind)).toBe(svg); // cached
  });
  it('shows the right notation', () => {
    expect(renderExampleThumbnail('pharmacy', 'relational')).toContain('PharmacyName');
    expect(renderExampleThumbnail('weak-entity', 'er')).toContain('Makes');
    expect(buildExample('weak-entity')).toBeTruthy();
  });
});
