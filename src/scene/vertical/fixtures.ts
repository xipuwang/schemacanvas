/**
 * Test / visual fixtures for the vertical family: relational models built with the model builders and
 * `withDiagram` (never hand-built edges), then positioned by hand.
 */
import { relationalBuilder, type RelationHandle } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { Diagram, ForeignKey, Id, Project, RelationalModel } from '@/model/types';

export type VType = 'crows-foot' | 'physical';

export interface VFixture {
  project: Project;
  model: RelationalModel;
  diagram: Diagram;
  rel: Record<string, RelationHandle>;
  fks: Record<string, ForeignKey>;
}

export function nodeIdOf(diagram: Diagram, relationId: Id): Id {
  const n = Object.values(diagram.nodes).find((x) => x.ref.kind === 'relation' && x.ref.id === relationId);
  if (!n) throw new Error('no node for relation');
  return n.id;
}

export function place(f: Pick<VFixture, 'diagram' | 'rel'>, positions: Record<string, [number, number]>): void {
  for (const [name, [x, y]] of Object.entries(positions)) {
    const node = f.diagram.nodes[nodeIdOf(f.diagram, f.rel[name]!.id)]!;
    node.x = x;
    node.y = y;
  }
}

type Built = { b: ReturnType<typeof relationalBuilder>; rel: VFixture['rel']; fks: VFixture['fks'] };

function finish(built: Built, type: VType, positions: Record<string, [number, number]>, orientation?: 'vertical' | 'horizontal'): VFixture {
  const project = createBareProject('fixture');
  const model = built.b.build();
  const diagram = withDiagram(project, model, type);
  if (orientation && diagram.options.crowsFoot) diagram.options.crowsFoot.orientation = orientation;
  const f: VFixture = { project, model, diagram, rel: built.rel, fks: built.fks };
  place(f, positions);
  return f;
}

function pharmacyBuilt(typed: boolean): Built {
  const b = relationalBuilder('Pharmacy', 'postgresql');
  const t = (type: string) => (typed ? { type } : {});
  const col = (name: string, type: string, extra: Record<string, unknown> = {}) => ({ name, ...t(type), ...extra });
  const doctor = b.relation('Doctor', [col('SSN', 'CHAR(11)'), col('Name', 'VARCHAR(80)', { nullable: false }), col('Specialty', 'VARCHAR(40)'), col('YearsOfExperience', 'INT')], { pk: ['SSN'] });
  const patient = b.relation('Patient', [col('SSN', 'CHAR(11)'), col('Name', 'VARCHAR(80)', { nullable: false }), col('Address', 'VARCHAR(120)'), col('Age', 'INT'), col('DoctorSSN', 'CHAR(11)')], { pk: ['SSN'] });
  const pharmacy = b.relation('Pharmacy', [col('Name', 'VARCHAR(60)'), col('Address', 'VARCHAR(120)'), col('Phone', 'VARCHAR(20)', { unique: true })], { pk: ['Name'] });
  const company = b.relation('Company', [col('Name', 'VARCHAR(60)'), col('Address', 'VARCHAR(120)')], { pk: ['Name'] });
  const drug = b.relation('Drug', [col('CompanyName', 'VARCHAR(60)'), col('TradeName', 'VARCHAR(60)'), col('Formula', 'TEXT')], { pk: ['CompanyName', 'TradeName'] });
  const sell = b.relation('Sell', [col('PharmacyName', 'VARCHAR(60)'), col('CompanyName', 'VARCHAR(60)'), col('DrugTradeName', 'VARCHAR(60)'), col('Price', 'NUMERIC(8,2)', { nullable: false, default: '0' })], { pk: ['PharmacyName', 'CompanyName', 'DrugTradeName'] });
  const contact = b.relation('Contact', [col('PharmacyName', 'VARCHAR(60)'), col('CompanyName', 'VARCHAR(60)'), col('Supervisor', 'VARCHAR(80)'), col('StartDate', 'DATE'), col('EndDate', 'DATE')], { pk: ['PharmacyName', 'CompanyName'] });
  const prescription = b.relation('Prescription', [col('DoctorSSN', 'CHAR(11)'), col('PatientSSN', 'CHAR(11)'), col('CompanyName', 'VARCHAR(60)'), col('DrugTradeName', 'VARCHAR(60)'), col('Date', 'DATE'), col('Quantity', 'INT')], { pk: ['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName'] });
  const fks: VFixture['fks'] = {
    patientDoctor: b.fk(patient, ['DoctorSSN'], doctor, ['SSN']),
    drugCompany: b.fk(drug, ['CompanyName'], company, ['Name'], { onDelete: 'CASCADE' }),
    sellPharmacy: b.fk(sell, ['PharmacyName'], pharmacy, ['Name']),
    sellDrug: b.fk(sell, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']),
    contactPharmacy: b.fk(contact, ['PharmacyName'], pharmacy, ['Name']),
    contactCompany: b.fk(contact, ['CompanyName'], company, ['Name']),
    prescriptionDoctor: b.fk(prescription, ['DoctorSSN'], doctor, ['SSN']),
    prescriptionPatient: b.fk(prescription, ['PatientSSN'], patient, ['SSN']),
    prescriptionDrug: b.fk(prescription, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName'], { onDelete: 'RESTRICT', onUpdate: 'CASCADE' }),
  };
  return { b, rel: { Doctor: doctor, Patient: patient, Pharmacy: pharmacy, Company: company, Drug: drug, Sell: sell, Contact: contact, Prescription: prescription }, fks };
}

export function pharmacyVFixture(type: VType = 'crows-foot', orientation: 'vertical' | 'horizontal' = 'vertical', typed = true): VFixture {
  const horizontal = orientation === 'horizontal' && type === 'crows-foot';
  const positions: Record<string, [number, number]> = horizontal
    ? { Doctor: [40, 40], Patient: [560, 40], Prescription: [40, 220], Drug: [40, 420], Company: [560, 420], Sell: [40, 600], Pharmacy: [560, 600], Contact: [960, 220] }
    : { Doctor: [40, 40], Patient: [520, 40], Prescription: [280, 320], Company: [40, 640], Drug: [400, 660], Pharmacy: [900, 660], Sell: [560, 900], Contact: [900, 320] };
  const f = finish(pharmacyBuilt(typed), type, positions, orientation);
  if (type === 'physical') {
    // Physical extras: an index and a CHECK so the sections have content.
    f.rel.Patient!.index('ix_patient_doctor', ['DoctorSSN']);
    f.rel.Patient!.index('ux_patient_name', ['Name'], true);
    f.model.relations[f.rel.Patient!.id]!.checks = [{ id: 'chk_age', expression: 'Age >= 0 AND Age < 150' }];
    f.model.relations[f.rel.Pharmacy!.id]!.schemaName = 'retail';
    f.model.relations[f.rel.Doctor!.id]!.columns[0]!.autoIncrement = false;
  }
  return f;
}

/** 1:1 (unique FK -> `||`/`o|` at the child), optional FK (nullable -> `o|` at the parent), mandatory FK, self FK, composite FK. */
export function cardinalityFixture(type: VType = 'crows-foot', orientation: 'vertical' | 'horizontal' = 'vertical'): VFixture {
  const b = relationalBuilder('Cardinality');
  const person = b.relation('Person', [{ name: 'Id', type: 'INT', autoIncrement: true }, { name: 'Name', type: 'TEXT', nullable: false }, { name: 'ManagerId', type: 'INT' }], { pk: ['Id'] });
  const passport = b.relation('Passport', [{ name: 'PersonId', type: 'INT', nullable: false, unique: true }, { name: 'Number', type: 'VARCHAR(20)', nullable: false }], { pk: ['Number'] });
  const profile = b.relation('Profile', [{ name: 'PersonId', type: 'INT' }, { name: 'Bio', type: 'TEXT' }], { pk: ['PersonId'] });
  const post = b.relation('Post', [{ name: 'Id', type: 'INT' }, { name: 'AuthorId', type: 'INT', nullable: false }, { name: 'EditorId', type: 'INT' }], { pk: ['Id'] });
  const orgA = b.relation('Org', [{ name: 'Region', type: 'CHAR(2)' }, { name: 'Code', type: 'CHAR(4)' }], { pk: ['Region', 'Code'] });
  const unit = b.relation('Unit', [{ name: 'Id', type: 'INT' }, { name: 'OrgRegion', type: 'CHAR(2)', nullable: false }, { name: 'OrgCode', type: 'CHAR(4)', nullable: false }], { pk: ['Id'] });
  const fks: VFixture['fks'] = {
    manager: b.fk(person, ['ManagerId'], person, ['Id']),
    passport: b.fk(passport, ['PersonId'], person, ['Id']),
    profile: b.fk(profile, ['PersonId'], person, ['Id']),
    author: b.fk(post, ['AuthorId'], person, ['Id']),
    editor: b.fk(post, ['EditorId'], person, ['Id']),
    unit: b.fk(unit, ['OrgRegion', 'OrgCode'], orgA, ['Region', 'Code']),
  };
  const horizontal = orientation === 'horizontal' && type === 'crows-foot';
  const positions: Record<string, [number, number]> = horizontal
    ? { Person: [260, 200], Passport: [40, 40], Profile: [320, 40], Post: [40, 380], Org: [40, 560], Unit: [360, 560] }
    : { Person: [320, 120], Passport: [40, 40], Profile: [40, 240], Post: [640, 140], Org: [40, 480], Unit: [320, 480] };
  return finish({ b, rel: { Person: person, Passport: passport, Profile: profile, Post: post, Org: orgA, Unit: unit }, fks }, type, positions, orientation);
}
