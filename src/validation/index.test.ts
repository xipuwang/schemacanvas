import { describe, expect, it } from 'vitest';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import { issueId } from '@/model/issues';
import { deepFreeze } from '@/test/deepFreeze';
import { compareIssues, RULES, summarizeIssues, groupByAffected, issuesForRef, validateModel, validateProject, worstSeverity } from './index';
import { codesOf, pharmacyEr, pharmacyRel } from './fixtures';

function twoModelProject(mutate?: (er: ReturnType<typeof pharmacyEr>, rel: ReturnType<typeof pharmacyRel>) => void) {
  const er = pharmacyEr();
  const rel = pharmacyRel();
  mutate?.(er, rel);
  const project = createBareProject('pharmacy');
  const erModel = er.b.build();
  const relModel = rel.b.build();
  withDiagram(project, erModel, 'chen');
  withDiagram(project, relModel, 'relational-schema');
  return { project: deepFreeze(project), erModel, relModel };
}

describe('rule registry', () => {
  it('has unique er.* / rel.* codes with documentation', () => {
    const seen = new Set<string>();
    for (const r of RULES) {
      expect(seen.has(r.code), r.code).toBe(false);
      seen.add(r.code);
      expect(r.code).toMatch(r.appliesTo === 'er' ? /^er\./ : /^rel\./);
      expect(r.description.length).toBeGreaterThan(10);
      expect(['error', 'warning', 'info']).toContain(r.severity);
    }
    expect(RULES.length).toBeGreaterThanOrEqual(40);
  });

  it('every issue carries its rule code and severity', () => {
    const { project } = twoModelProject((er, rel) => {
      er.doctor.entity.name = 'patient';
      rel.drug.relation.primaryKey = [];
    });
    const byCode = new Map(RULES.map((r) => [r.code, r]));
    const issues = validateProject(project);
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(byCode.get(i.code)?.severity).toBe(i.severity);
      expect(i.title && i.explanation && i.suggestion).toBeTruthy();
      expect(i.id).toBe(issueId(i.code, i.affected));
    }
  });
});

describe('validateProject', () => {
  it('the pharmacy example (ER and relational) has zero errors and zero warnings', () => {
    const { project } = twoModelProject();
    const issues = validateProject(project);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('validates all models, or one via modelId; unknown model gives nothing', () => {
    const { project, erModel, relModel } = twoModelProject((er, rel) => {
      er.doctor.entity.name = 'patient';
      rel.drug.relation.primaryKey = [];
    });
    const all = validateProject(project);
    expect(new Set(all.map((i) => i.modelId))).toEqual(new Set([erModel.id, relModel.id]));
    expect(validateProject(project, { modelId: erModel.id }).every((i) => i.modelId === erModel.id)).toBe(true);
    expect(codesOf(validateProject(project, { modelId: relModel.id }))).toEqual(['rel.fk-target-not-key', 'rel.no-primary-key']);
    expect(validateProject(project, { modelId: 'mdl_nope' })).toEqual([]);
    expect(validateModel(project.models[erModel.id]!, project)).toEqual(validateProject(project, { modelId: erModel.id }));
  });

  it('filters by severity', () => {
    const { project } = twoModelProject((er, rel) => {
      er.doctor.entity.name = 'patient'; // error
      er.makes.relationship.name = 'sell'; // warning
      er.doctor.derived('Age'); // info
      rel.drug.relation.primaryKey = [];
    });
    const sevs = (s: Array<'error' | 'warning' | 'info'>) => new Set(validateProject(project, { severities: s }).map((i) => i.severity));
    expect(sevs(['error'])).toEqual(new Set(['error']));
    expect(sevs(['warning', 'info'])).toEqual(new Set(['warning', 'info']));
    expect(validateProject(project, { severities: [] })).toEqual([]);
  });

  it('is sorted: severity (error>warning>info), then model, code, affected', () => {
    const { project } = twoModelProject((er, rel) => {
      er.doctor.entity.name = 'patient';
      er.makes.relationship.name = 'sell';
      er.doctor.derived('Age');
      rel.drug.relation.primaryKey = [];
      rel.b.fk(rel.patient, ['DoctorSSN'], rel.doctor, ['SSN']); // duplicate (info)
    });
    const issues = validateProject(project);
    const rank = { error: 0, warning: 1, info: 2 };
    for (let i = 1; i < issues.length; i++) {
      expect(compareIssues(issues[i - 1]!, issues[i]!)).toBeLessThanOrEqual(0);
      expect(rank[issues[i - 1]!.severity]).toBeLessThanOrEqual(rank[issues[i]!.severity]);
    }
    expect(issues[0]!.severity).toBe('error');
    expect(issues.at(-1)!.severity).toBe('info');
  });

  it('is deterministic and independent of object key order', () => {
    const { project } = twoModelProject((er, rel) => {
      er.doctor.entity.name = 'patient';
      rel.drug.relation.primaryKey = [];
    });
    const first = validateProject(project);
    expect(validateProject(project)).toEqual(first);
    const reversed = {
      ...project,
      models: Object.fromEntries(Object.entries(project.models).reverse()),
    };
    expect(validateProject(deepFreeze(structuredClone(reversed)))).toEqual(first);
  });

  it('issue ids are unique within a result', () => {
    const { project } = twoModelProject((er, rel) => {
      rel.b.fk(rel.patient, ['DoctorSSN'], rel.doctor, ['SSN']);
      er.doctor.entity.name = '';
    });
    const ids = validateProject(project).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mutated pharmacy: each mutation yields exactly the expected codes', () => {
  const cases: Array<[string, Parameters<typeof twoModelProject>[0], string[]]> = [
    ['two entities named alike', (er) => { er.doctor.entity.name = 'PATIENT'; }, ['er.entity-name-duplicate']],
    ['Doctor loses its key', (er) => { for (const a of Object.values(er.b.model.attributes)) if (a.owner.id === er.doctor.id) a.key = 'none'; }, ['er.entity-no-key']],
    ['Makes no longer identifying', (er) => { er.makes.relationship.identifying = false; }, ['er.weak-no-owner']],
    ['weak side partial', (er) => { er.makes.relationship.participants[1]!.participation = 'partial'; }, ['er.identifying-partial']],
    ['Prescription key too small', (er) => { er.prescription.relationship.keyParticipantIds = [er.prescription.relationship.participants[0]!.id]; }, ['er.relationship-key-vs-cardinality']],
    ['Drug PK emptied', (_er, rel) => { rel.drug.relation.primaryKey = []; }, ['rel.fk-target-not-key', 'rel.no-primary-key']],
    ['Sell -> Drug FK shortened', (_er, rel) => { rel.fks.sellDrug!.columns = [rel.fks.sellDrug!.columns[0]!]; }, ['rel.fk-target-not-key']],
    ['Prescription FK to a deleted column', (_er, rel) => { rel.fks.prescDrug!.columns[1]!.targetColumnId = 'col_gone'; }, ['rel.fk-column-missing']],
    ['Patient.DoctorSSN type changed', (_er, rel) => { rel.patient.relation.columns.find((c) => c.name === 'DoctorSSN')!.dataType = 'DATE'; }, ['rel.fk-type-mismatch']],
    ['Doctor.SSN nullable', (_er, rel) => { rel.doctor.relation.columns.find((c) => c.name === 'SSN')!.nullable = true; }, ['rel.pk-nullable']],
    ['both problems at once', (er, rel) => { er.makes.relationship.identifying = false; rel.drug.relation.primaryKey = []; }, ['er.weak-no-owner', 'rel.fk-target-not-key', 'rel.no-primary-key']],
  ];
  for (const [name, mutate, expected] of cases) {
    it(name, () => {
      const { project } = twoModelProject(mutate);
      expect(codesOf(validateProject(project))).toEqual(expected);
    });
  }
});

describe('summary helpers', () => {
  const { project } = twoModelProject((er, rel) => {
    er.doctor.entity.name = 'patient';
    er.doctor.derived('Age');
    rel.drug.relation.primaryKey = [];
  });
  const issues = validateProject(project);

  it('summarizeIssues counts by severity', () => {
    const s = summarizeIssues(issues);
    expect(s.total).toBe(issues.length);
    expect(s.error + s.warning + s.info).toBe(s.total);
    expect(s.error).toBe(issues.filter((i) => i.severity === 'error').length);
    expect(summarizeIssues([])).toEqual({ error: 0, warning: 0, info: 0, total: 0 });
  });

  it('worstSeverity', () => {
    expect(worstSeverity(issues)).toBe('error');
    expect(worstSeverity(issues.filter((i) => i.severity === 'info'))).toBe('info');
    expect(worstSeverity([])).toBeUndefined();
  });

  it('groupByAffected files an issue under each affected ref; rollUp adds parents', () => {
    const grouped = groupByAffected(issues);
    const dup = issues.find((i) => i.code === 'er.entity-name-duplicate')!;
    for (const ref of dup.affected) expect(grouped[`${ref.kind}:${ref.id}`]).toContain(dup);
    const noPk = issues.find((i) => i.code === 'rel.no-primary-key')!;
    expect(noPk.affected[0]!.kind).toBe('relation');
    // a column-level issue shows up on its relation node only with rollUp
    const withCol = issues.find((i) => i.affected.some((r) => r.kind === 'column'));
    expect(withCol).toBeDefined();
    const colRef = withCol!.affected.find((r) => r.kind === 'column')!;
    // Isolate the column ref: FK-structure issues also name their relations, which would mask the roll-up.
    const colOnly = { ...withCol!, affected: [colRef] };
    if (colRef.kind === 'column') {
      expect(groupByAffected([colOnly])[`relation:${colRef.relationId}`]).toBeUndefined();
      expect(groupByAffected([colOnly], { rollUp: true })[`relation:${colRef.relationId}`]).toEqual([colOnly]);
    }
  });

  it('issuesForRef returns issues naming exactly that ref', () => {
    const dup = issues.find((i) => i.code === 'er.entity-name-duplicate')!;
    expect(issuesForRef(issues, dup.affected[0]!)).toContain(dup);
    expect(issuesForRef(issues, { kind: 'entity', id: 'ent_nope' })).toEqual([]);
  });
});
