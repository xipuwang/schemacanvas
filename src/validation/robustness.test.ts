/**
 * Validation must tolerate every SOFT state of model/invariants.ts without throwing. These tests corrupt the pharmacy
 * models in the ways the ops/loader permit (dangling ids, empty FKs, cycles, missing owners ...) and check that
 * validation neither throws nor emits malformed issues.
 */
import { describe, expect, it } from 'vitest';
import { createBareProject } from '@/model/defaults';
import { refResolves, withDiagram } from '@/model/diagramSync';
import type { ErModel, Project, RelationalModel } from '@/model/types';
import { deepFreeze } from '@/test/deepFreeze';
import { compareIssues, validateProject } from './index';
import { pharmacyEr, pharmacyRel } from './fixtures';

/** mulberry32: tiny seeded PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: T[]): T | undefined => xs[Math.floor(r() * xs.length)];

function corruptEr(m: ErModel, r: () => number): void {
  const ents = Object.values(m.entities);
  const rels = Object.values(m.relationships);
  const attrs = Object.values(m.attributes);
  switch (Math.floor(r() * 12)) {
    case 0: { const e = pick(r, ents); if (e) delete m.entities[e.id]; break; } // dangling participants + attribute owners
    case 1: { const x = pick(r, rels); if (x) delete m.relationships[x.id]; break; }
    case 2: { const x = pick(r, rels); if (x) x.participants.length = Math.floor(r() * x.participants.length); break; }
    case 3: { const x = pick(r, rels); if (x) x.keyParticipantIds = ['par_ghost']; break; }
    case 4: { const e = pick(r, ents); if (e) e.associativeOf = r() < 0.5 ? 'rel_ghost' : pick(r, rels)?.id; break; }
    case 5: { const e = pick(r, ents); if (e) e.weak = !e.weak; break; }
    case 6: { const x = pick(r, rels); if (x) x.identifying = !x.identifying; break; }
    case 7: { const a = pick(r, attrs); const b = pick(r, attrs); if (a && b) a.owner = { kind: 'attribute', id: b.id }; break; } // may form owner cycles
    case 8: { const a = pick(r, attrs); if (a) { a.key = pick(r, ['none', 'primary', 'partial'] as const)!; a.derived = r() < 0.5; a.multivalued = r() < 0.5; } break; }
    case 9: { const x = pick(r, rels); if (x?.participants[0]) x.participants[0].entityId = 'ent_ghost'; break; }
    case 10: { const x = pick(r, rels); if (x?.participants.length) x.participants.push({ ...x.participants[0]!, id: `par_dup${Math.floor(r() * 1000)}` }); break; }
    default: { const a = pick(r, attrs); if (a) delete m.attributes[a.id]; }
  }
}

function corruptRel(m: RelationalModel, r: () => number): void {
  const rels = Object.values(m.relations);
  const fks = Object.values(m.foreignKeys);
  switch (Math.floor(r() * 10)) {
    case 0: { const x = pick(r, rels); if (x) x.columns.splice(Math.floor(r() * x.columns.length), 1); break; } // PK/FK now dangle
    case 1: { const x = pick(r, rels); if (x) delete m.relations[x.id]; break; }
    case 2: { const f = pick(r, fks); if (f) f.columns = []; break; }
    case 3: { const f = pick(r, fks); if (f?.columns[0]) f.columns[0].sourceColumnId = pick(r, rels)?.columns[0]?.id ?? 'col_x'; break; }
    case 4: { const f = pick(r, fks); if (f?.columns[0]) f.columns[0].targetColumnId = 'col_ghost'; break; }
    case 5: { const f = pick(r, fks); if (f) f.targetRelationId = f.sourceRelationId; break; }
    case 6: { const x = pick(r, rels); if (x) x.primaryKey = []; break; }
    case 7: { const x = pick(r, rels); const c = x?.columns[0]; if (x && c) x.columns.forEach((cc) => (cc.nullable = r() < 0.5)); break; }
    case 8: { const f = pick(r, fks); if (f) { f.onDelete = 'SET NULL'; f.cardinality = { parentMin: 1 }; } break; }
    default: { const x = pick(r, rels); if (x) x.uniques.push({ id: 'uq_z', columnIds: ['col_ghost'] }); }
  }
}

function buildProject(seed: number, mutations: number): Project {
  const r = rng(seed);
  const er = pharmacyEr().b.build();
  const rel = pharmacyRel().b.build();
  const project = createBareProject('fuzz');
  withDiagram(project, er, 'chen');
  withDiagram(project, rel, 'relational-schema');
  for (let i = 0; i < mutations; i++) {
    corruptEr(er, r);
    corruptRel(rel, r);
  }
  return project;
}

describe('robustness against SOFT states', () => {
  it('never throws and always emits well-formed, sorted, unique issues (300 fuzzed projects)', () => {
    const seenCodes = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const project = deepFreeze(buildProject(seed, 1 + (seed % 7)));
      let issues;
      try {
        issues = validateProject(project);
      } catch (e) {
        throw new Error(`seed ${seed}: ${(e as Error).stack}`);
      }
      const ids = new Set<string>();
      for (const i of issues) seenCodes.add(i.code);
      issues.forEach((i, n) => {
        expect(i.code, `seed ${seed}`).toMatch(/^(er|rel)\./);
        expect(i.title && i.explanation && i.suggestion, `seed ${seed} ${i.code}`).toBeTruthy();
        expect(i.affected.length, `seed ${seed} ${i.code}`).toBeGreaterThan(0);
        for (const ref of i.affected) expect(refResolves(project.models[i.modelId]!, ref), `seed ${seed} ${i.code}`).toBe(true);
        expect(ids.has(i.id), `seed ${seed} duplicate id ${i.id}`).toBe(false);
        ids.add(i.id);
        if (n > 0) expect(compareIssues(issues[n - 1]!, i)).toBeLessThanOrEqual(0);
      });
    }
    // The corruptions must actually exercise many rules, otherwise "never throws" proves little.
    expect(seenCodes.size).toBeGreaterThanOrEqual(20);
  });

  it('handles specific degenerate shapes', () => {
    const er = pharmacyEr();
    // owner cycle between composite attributes + self-owning weak entity + relationship without participants
    const [a, b] = Object.values(er.b.model.attributes);
    a!.owner = { kind: 'attribute', id: b!.id };
    b!.owner = { kind: 'attribute', id: a!.id };
    Object.values(er.b.model.relationships)[0]!.participants = [];
    const rel = pharmacyRel();
    rel.fks.patientDoctor!.columns = [];
    rel.fks.drugCompany!.targetRelationId = rel.fks.drugCompany!.sourceRelationId;
    rel.b.model.relations[rel.doctor.id]!.columns = [];
    const project = createBareProject('deg');
    withDiagram(project, er.b.build(), 'chen');
    withDiagram(project, rel.b.build(), 'relational-schema');
    expect(() => validateProject(deepFreeze(project))).not.toThrow();
  });

  it('an empty project and empty models produce no issues', () => {
    const project = createBareProject('empty');
    expect(validateProject(project)).toEqual([]);
    const er = pharmacyEr();
    er.b.model.entities = {};
    er.b.model.attributes = {};
    er.b.model.relationships = {};
    withDiagram(project, er.b.build(), 'chen');
    expect(validateProject(deepFreeze(project))).toEqual([]);
  });
});
