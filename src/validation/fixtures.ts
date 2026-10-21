/** Test fixtures (spec Example E, pharmacy) built only with model/builders + diagramSync. Not part of the public API. */
import { erBuilder, relationalBuilder, type ErBuilder, type EntityHandle, type RelationHandle } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { resolveRefsInDiagram, withDiagram } from '@/model/diagramSync';
import type { Diagram, ErModel, Issue, Project, RelationalModel } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { deepFreeze } from '@/test/deepFreeze';
import { validateProject } from './index';

export interface PharmacyEr {
  b: ErBuilder;
  doctor: EntityHandle;
  patient: EntityHandle;
  pharmacy: EntityHandle;
  company: EntityHandle;
  drug: EntityHandle;
  makes: ReturnType<ErBuilder['relate']>;
  prescription: ReturnType<ErBuilder['relationship']>;
}

export function pharmacyEr(): PharmacyEr {
  const b = erBuilder('Pharmacy');
  const doctor = b.entity('Doctor').key('SSN').attr('Name').attr('Specialty').attr('YearsExperience');
  const patient = b.entity('Patient').key('SSN').attr('Name').attr('Address').attr('Age');
  const pharmacy = b.entity('Pharmacy').key('Name').attr('Address').attr('Phone');
  const company = b.entity('Company').key('name').attr('Phone');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('Primary_physician', doctor, patient, '1:N', { rightTotal: true });
  const makes = b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  b.relate('Sell', pharmacy, drug, 'M:N').attr('Price');
  b.relate('Contact', pharmacy, company, 'M:N').attr('StartDate');
  const prescription = b.relationship('Prescription', [{ entity: doctor }, { entity: patient }, { entity: drug }]);
  prescription.key('Date').attr('Quantity');
  return { b, doctor, patient, pharmacy, company, drug, makes, prescription };
}

export interface PharmacyRel {
  b: ReturnType<typeof relationalBuilder>;
  doctor: RelationHandle;
  patient: RelationHandle;
  pharmacy: RelationHandle;
  company: RelationHandle;
  drug: RelationHandle;
  sell: RelationHandle;
  contact: RelationHandle;
  prescription: RelationHandle;
  fks: Record<string, ReturnType<ReturnType<typeof relationalBuilder>['fk']>>;
}

export function pharmacyRel(): PharmacyRel {
  const b = relationalBuilder('Pharmacy schema');
  const v = (n: string) => ({ name: n, type: 'VARCHAR(30)' });
  const doctor = b.relation('Doctor', [v('SSN'), v('Name'), v('Specialty'), { name: 'YearsExperience', type: 'INT' }], { pk: ['SSN'] });
  const patient = b.relation('Patient', [v('SSN'), v('Name'), v('Address'), { name: 'Age', type: 'INT' }, { ...v('DoctorSSN'), nullable: false }], { pk: ['SSN'] });
  const pharmacy = b.relation('Pharmacy', [v('Name'), v('Address'), v('Phone')], { pk: ['Name'] });
  const company = b.relation('Company', [v('Name'), v('Phone')], { pk: ['Name'] });
  const drug = b.relation('Drug', [v('CompanyName'), v('TradeName'), v('Formula')], { pk: ['CompanyName', 'TradeName'] });
  const sell = b.relation(
    'Sell',
    [v('PharmacyName'), v('CompanyName'), v('TradeName'), { name: 'Price', type: 'DECIMAL(8,2)' }],
    { pk: ['PharmacyName', 'CompanyName', 'TradeName'] },
  );
  const contact = b.relation('Contact', [v('PharmacyName'), v('CompanyName'), { name: 'StartDate', type: 'DATE' }], { pk: ['PharmacyName', 'CompanyName'] });
  const prescription = b.relation(
    'Prescription',
    [v('DoctorSSN'), v('PatientSSN'), v('CompanyName'), v('DrugTradeName'), { name: 'Date', type: 'DATE' }, { name: 'Quantity', type: 'INT' }],
    { pk: ['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date'] },
  );
  const fks = {
    patientDoctor: b.fk(patient, ['DoctorSSN'], doctor, ['SSN']),
    drugCompany: b.fk(drug, ['CompanyName'], company, ['Name']),
    sellPharmacy: b.fk(sell, ['PharmacyName'], pharmacy, ['Name']),
    sellDrug: b.fk(sell, ['CompanyName', 'TradeName'], drug, ['CompanyName', 'TradeName']),
    contactPharmacy: b.fk(contact, ['PharmacyName'], pharmacy, ['Name']),
    contactCompany: b.fk(contact, ['CompanyName'], company, ['Name']),
    prescDoctor: b.fk(prescription, ['DoctorSSN'], doctor, ['SSN']),
    prescPatient: b.fk(prescription, ['PatientSSN'], patient, ['SSN']),
    prescDrug: b.fk(prescription, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']),
  };
  return { b, doctor, patient, pharmacy, company, drug, sell, contact, prescription, fks };
}

/** Frozen single-model project (of a COPY of `model`) with a complete diagram (chen for ER, relational-schema otherwise). */
export function projectOf(model: ErModel | RelationalModel): { project: Project; diagram: Diagram } {
  const project = createBareProject('fixture');
  // Freeze a copy so a test can keep mutating its builder model and re-validate.
  const diagram = withDiagram(project, structuredClone(model), model.kind === 'er' ? 'chen' : 'relational-schema');
  return { project: deepFreeze(project), diagram };
}

export const codesOf = (issues: readonly Issue[]): string[] => [...new Set(issues.map((i) => i.code))].sort();

/**
 * Validate a model inside a frozen one-model project and assert every issue is well-formed AND clickable:
 * affected refs are non-empty and `resolveRefsInDiagram` finds something to highlight on the model's diagram.
 */
export function check(model: ErModel | RelationalModel): { issues: Issue[]; project: Project; diagram: Diagram } {
  const { project, diagram } = projectOf(model);
  const issues = validateProject(project);
  const scene = buildScene(project, diagram.id);
  for (const issue of issues) {
    if (issue.affected.length === 0) throw new Error(`${issue.code}: empty affected`);
    const hit = resolveRefsInDiagram(project, diagram, issue.affected);
    // An edge counts only when the scene really draws it (a dangling FK edge is skipped: `dangling-fk-edge:<id>`).
    const drawn = hit.edgeIds.filter((id) => !!scene.edges[id]);
    if (hit.nodeIds.length + drawn.length + hit.columnIds.length === 0) {
      throw new Error(`${issue.code}: affected refs do not resolve to anything on the diagram`);
    }
  }
  return { issues, project, diagram };
}
