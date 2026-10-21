import { describe, expect, it } from 'vitest';
import '@/i18n';
import { hasMessage } from '@/i18n';
import { describeFocus, describeSelection } from './announce';
import { explainEdge, explainNode, pluralName } from './explain';
import { makeStore, nodeNamed } from './testFixtures';

const edgeOf = (s: ReturnType<typeof makeStore>, rel: string, entity: string): string => {
  const p = s.store.getState().project;
  const d = p.diagrams[s.diagramId]!;
  const m = p.models[d.modelId]! as import('@/model/types').ErModel;
  const r = Object.values(m.relationships).find((x) => x.name === rel)!;
  const part = r.participants.find((x) => m.entities[x.entityId]!.name === entity)!;
  return Object.entries(d.edges).find(([, e]) => e.ref.kind === 'participant' && e.ref.participantId === part.id)![0];
};

describe('SA-09 / UX-7: symbol explanations come from the semantic model', () => {
  it('pluralises English entity names for the cardinality sentence', () => {
    expect(pluralName('Drug')).toBe('Drugs');
    expect(pluralName('Address')).toBe('Addresses');
    expect(pluralName('Company')).toBe('Companies');
  });

  it('double line = total participation, naming the entity and the relationship', () => {
    const s = makeStore('chen');
    const p = s.store.getState().project;
    const d = p.diagrams[s.diagramId]!;
    const text = explainEdge(p, d, edgeOf(s, 'Makes', 'Drug'))!;
    expect(text).toContain('Total participation (double line): every Drug must take part in Makes.');
  });

  it('cardinality labels explain look-across semantics in words', () => {
    const s = makeStore('chen');
    const p = s.store.getState().project;
    const d = p.diagrams[s.diagramId]!;
    expect(explainEdge(p, d, edgeOf(s, 'Makes', 'Drug'), 'cardinality')).toMatch(/^N: One Company relates to many Drugs\.$/);
    expect(explainEdge(p, d, edgeOf(s, 'Makes', 'Company'), 'cardinality')).toMatch(/^1: One Drug relates to at most one Company\.$/);
  });

  it('weak entity / identifying relationship / attribute kinds are explained', () => {
    const s = makeStore('chen');
    const p = s.store.getState().project;
    const d = p.diagrams[s.diagramId]!;
    expect(explainNode(p, d, nodeNamed(p, s.diagramId, 'Drug'))).toMatch(/Weak entity \(double rectangle\)/);
    expect(explainNode(p, d, nodeNamed(p, s.diagramId, 'Company'))).toMatch(/Strong entity \(single rectangle\)/);
    expect(explainNode(p, d, nodeNamed(p, s.diagramId, 'Makes'))).toMatch(/Identifying relationship \(double diamond\)/);
  });

  it('horizontal tables: PK / FK / PK+FK marks and the foreign-key connector name the real columns', () => {
    const s = makeStore('rel');
    const p = s.store.getState().project;
    const d = p.diagrams[s.diagramId]!;
    const m = p.models[d.modelId] as import('@/model/types').RelationalModel;
    const patient = Object.values(m.relations).find((r) => r.name === 'Patient')!;
    const doctorSsn = patient.columns.find((c) => c.name === 'DoctorSSN')!;
    const node = nodeNamed(p, s.diagramId, 'Patient');
    expect(explainNode(p, d, node, doctorSsn.id)).toMatch(/Foreign key \(italic, blue\): Patient\.DoctorSSN references Doctor\.SSN\./);
    const drug = Object.values(m.relations).find((r) => r.name === 'Drug')!;
    const companyName = drug.columns.find((c) => c.name === 'CompanyName')!;
    expect(explainNode(p, d, nodeNamed(p, s.diagramId, 'Drug'), companyName.id)).toMatch(/Primary key and foreign key \(split shading\): CompanyName .* references Company\.Name/);
    const fkEdge = Object.entries(d.edges).find(([, e]) => e.ref.kind === 'foreignKey')![0];
    expect(explainEdge(p, d, fkEdge)).toMatch(/^Foreign key .+ → .+\. Every value must exist/);
  });

  it('every tip / focus / outline key exists in both languages', () => {
    const keys = ['editor.tip.entity.weak', 'editor.tip.card.many', 'editor.tip.col.pkfk', 'editor.tip.port.add-attribute', 'editor.outline.title', 'editor.focus.item', 'editor.live.deleted'];
    for (const k of keys) {
      expect(hasMessage(k, 'en')).toBe(true);
      expect(hasMessage(k, 'zh')).toBe(true);
    }
  });
});

describe('A11Y-12 / A11Y-05: announcements carry cardinality, participation and keys, and never claim focus is selection', () => {
  it('a relationship announces its participants; focus text does not say "selected"', () => {
    const s = makeStore('chen');
    const p = s.store.getState().project;
    const makes = nodeNamed(p, s.diagramId, 'Makes');
    const sel = describeSelection(p, s.diagramId, { ids: [makes] });
    expect(sel).toMatch(/^Identifying relationship Makes selected/);
    expect(sel).toMatch(/Company \(1, partial\)/);
    expect(sel).toMatch(/Drug \(N, total\)/);
    const foc = describeFocus(p, s.diagramId)(makes);
    expect(foc).toMatch(/^Identifying relationship Makes, /);
    expect(foc).not.toMatch(/selected,/);
    expect(foc).toMatch(/Press Space or Enter to select it\.$/);
  });

  it('a participation line announces entity, relationship, cardinality and participation', () => {
    const s = makeStore('chen');
    const p = s.store.getState().project;
    const line = edgeOf(s, 'Makes', 'Drug');
    expect(describeSelection(p, s.diagramId, { ids: [line] })).toBe('Participation line selected: Drug in Makes, cardinality N, total participation');
  });
});
