/**
 * Test fixtures for the horizontal schema: built with the model builders and `createDiagramForModel` (never hand-built
 * edges), then positioned by hand. Used by the scene tests and by the visual test in render/horizontal.
 */
import { relationalBuilder, type RelationHandle } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { Diagram, ForeignKey, Id, Project, RelationalModel } from '@/model/types';

export interface Fixture {
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

/** Place each relation's node; `positions` maps relation NAME → [x, y]. */
export function place(f: Pick<Fixture, 'diagram' | 'rel'>, positions: Record<string, [number, number]>): void {
  for (const [name, [x, y]] of Object.entries(positions)) {
    const node = f.diagram.nodes[nodeIdOf(f.diagram, f.rel[name]!.id)]!;
    node.x = x;
    node.y = y;
  }
}

function finish(b: ReturnType<typeof relationalBuilder>, rel: Fixture['rel'], fks: Fixture['fks']): Fixture {
  const project = createBareProject('fixture');
  const model = b.build();
  const diagram = withDiagram(project, model, 'relational-schema');
  return { project, model, diagram, rel, fks };
}

export function studentFixture(): Fixture {
  const b = relationalBuilder('Student');
  const student = b.relation('Student', ['SID', 'FirstName', 'LastName', 'GPA', 'DOB'], { pk: ['SID'] });
  const f = finish(b, { Student: student }, {});
  place(f, { Student: [40, 40] });
  return f;
}

export function pharmacyFixture(): Fixture {
  const b = relationalBuilder('Pharmacy');
  const doctor = b.relation('Doctor', ['SSN', 'Name', 'Specialty', 'YearsOfExperience'], { pk: ['SSN'] });
  const patient = b.relation('Patient', ['SSN', 'Name', 'Address', 'Age', 'DoctorSSN'], { pk: ['SSN'] });
  const pharmacy = b.relation('Pharmacy', ['Name', 'Address', 'Phone'], { pk: ['Name'] });
  const company = b.relation('Company', ['Name', 'Address'], { pk: ['Name'] });
  const drug = b.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const sell = b.relation('Sell', ['PharmacyName', 'CompanyName', 'DrugTradeName', 'Price'], {
    pk: ['PharmacyName', 'CompanyName', 'DrugTradeName'],
  });
  const contact = b.relation('Contact', ['PharmacyName', 'CompanyName', 'Supervisor', 'StartDate', 'EndDate'], {
    pk: ['PharmacyName', 'CompanyName'],
  });
  const prescription = b.relation('Prescription', ['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date', 'Quantity'], {
    pk: ['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName'],
  });
  const fks: Fixture['fks'] = {
    patientDoctor: b.fk(patient, ['DoctorSSN'], doctor, ['SSN']),
    drugCompany: b.fk(drug, ['CompanyName'], company, ['Name']),
    sellPharmacy: b.fk(sell, ['PharmacyName'], pharmacy, ['Name']),
    sellDrug: b.fk(sell, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']),
    contactPharmacy: b.fk(contact, ['PharmacyName'], pharmacy, ['Name']),
    contactCompany: b.fk(contact, ['CompanyName'], company, ['Name']),
    prescriptionDoctor: b.fk(prescription, ['DoctorSSN'], doctor, ['SSN']),
    prescriptionPatient: b.fk(prescription, ['PatientSSN'], patient, ['SSN']),
    prescriptionDrug: b.fk(prescription, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']),
  };
  const f = finish(b, { Doctor: doctor, Patient: patient, Pharmacy: pharmacy, Company: company, Drug: drug, Sell: sell, Contact: contact, Prescription: prescription }, fks);
  place(f, {
    Doctor: [40, 40],
    Patient: [460, 40],
    Prescription: [40, 220],
    Drug: [40, 420],
    Company: [520, 420],
    Sell: [40, 620],
    Contact: [120, 800],
    Pharmacy: [760, 800],
  });
  return f;
}

/** PreReq(Cid, Req_Cid): BOTH columns reference Course.Cid (two single-column FKs into the same cell). */
export function prereqFixture(): Fixture {
  const b = relationalBuilder('Courses');
  const course = b.relation('Course', ['Cid', 'Name'], { pk: ['Cid'] });
  const prereq = b.relation('PreReq', ['Cid', 'Req_Cid'], { pk: ['Cid', 'Req_Cid'] });
  const fks = { cid: b.fk(prereq, ['Cid'], course, ['Cid']), req: b.fk(prereq, ['Req_Cid'], course, ['Cid']) };
  const f = finish(b, { Course: course, PreReq: prereq }, fks);
  place(f, { Course: [60, 40], PreReq: [40, 200] });
  return f;
}

/** Employee.ManagerEid -> Employee.Eid. */
export function employeeFixture(): Fixture {
  const b = relationalBuilder('Company');
  const employee = b.relation('Employee', ['Eid', 'Name', 'Salary', 'ManagerEid'], { pk: ['Eid'] });
  const fks = { manager: b.fk(employee, ['ManagerEid'], employee, ['Eid']) };
  const f = finish(b, { Employee: employee }, fks);
  place(f, { Employee: [60, 60] });
  return f;
}

/** A -> C with B sitting between them: the connector must route around B. */
export function detourFixture(): Fixture {
  const b = relationalBuilder('Detour');
  const a = b.relation('Order', ['Oid', 'CustomerId', 'Total'], { pk: ['Oid'] });
  const mid = b.relation('Invoice', ['Iid', 'Amount', 'Currency', 'IssuedOn', 'DueOn'], { pk: ['Iid'] });
  const c = b.relation('Customer', ['CustomerId', 'Name'], { pk: ['CustomerId'] });
  const fks = { orderCustomer: b.fk(a, ['CustomerId'], c, ['CustomerId']) };
  const f = finish(b, { Order: a, Invoice: mid, Customer: c }, fks);
  place(f, { Order: [60, 40], Invoice: [40, 160], Customer: [60, 300] });
  return f;
}

/** Typed columns for the data-type annotation rendering. */
export function typedFixture(): Fixture {
  const b = relationalBuilder('Typed');
  const student = b.relation(
    'Student',
    [
      { name: 'SID', type: 'INTEGER' },
      { name: 'FirstName', type: 'VARCHAR(50)' },
      { name: 'LastName', type: 'VARCHAR(50)' },
      { name: 'GPA', type: 'DECIMAL(3,2)' },
      { name: 'DOB', type: 'DATE' },
      { name: 'AdvisorId', type: 'INTEGER' },
    ],
    { pk: ['SID'] },
  );
  const advisor = b.relation('Advisor', [{ name: 'AdvisorId', type: 'INTEGER' }, { name: 'Name', type: 'VARCHAR(80)' }], { pk: ['AdvisorId'] });
  const fks = { advisor: b.fk(student, ['AdvisorId'], advisor, ['AdvisorId']) };
  const f = finish(b, { Student: student, Advisor: advisor }, fks);
  f.diagram.options.relational!.showDataTypes = true;
  place(f, { Student: [40, 40], Advisor: [120, 220] });
  return f;
}

/** Composite FK whose pair order is the REVERSE of the target key's left-to-right order (and contiguous cells). */
export function outOfOrderFixture(): Fixture {
  const b = relationalBuilder('OutOfOrder');
  const drug = b.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const rx = b.relation('Rx', ['RxId', 'DrugTradeName', 'DrugCompany'], { pk: ['RxId'] });
  // pair 0: DrugTradeName -> TradeName (target cell 1); pair 1: DrugCompany -> CompanyName (target cell 0)
  const fks = { rx: b.fk(rx, ['DrugTradeName', 'DrugCompany'], drug, ['TradeName', 'CompanyName']) };
  const f = finish(b, { Drug: drug, Rx: rx }, fks);
  place(f, { Drug: [300, 220], Rx: [40, 40] });
  return f;
}

/** Composite FK with contiguous, ordered cells on both sides (bracket-eligible). */
export function bracketFixture(style: 'branches' | 'bracket'): Fixture {
  const b = relationalBuilder('Bracket');
  const drug = b.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const rx = b.relation('Prescription', ['PatientSSN', 'CompanyName', 'DrugTradeName', 'Quantity'], { pk: ['PatientSSN', 'CompanyName', 'DrugTradeName'] });
  const fks = { rx: b.fk(rx, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']) };
  const f = finish(b, { Drug: drug, Prescription: rx }, fks);
  f.diagram.options.relational!.compositeFkStyle = style;
  place(f, { Prescription: [40, 40], Drug: [120, 220] });
  return f;
}

/**
 * Tangled: two composite FKs (from opposite sides, plus a third table above) into the same composite-keyed table,
 * and a single FK passing through the same corridor. Used by the crossing-count regression test.
 */
export function tangledFixture(): Fixture {
  const b = relationalBuilder('Tangled');
  const hub = b.relation('Hub', ['KeyA', 'KeyB', 'KeyC', 'Payload'], { pk: ['KeyA', 'KeyB', 'KeyC'] });
  const left = b.relation('Left', ['Id', 'HubA', 'HubB', 'Note'], { pk: ['Id'] });
  const right = b.relation('Right', ['Id', 'HubB', 'HubC', 'Note'], { pk: ['Id'] });
  const low = b.relation('Low', ['Id', 'HubA', 'HubB', 'HubC', 'Ref'], { pk: ['Id'] });
  const other = b.relation('Other', ['Ref', 'Name'], { pk: ['Ref'] });
  const fks: Fixture['fks'] = {
    left: b.fk(left, ['HubA', 'HubB'], hub, ['KeyA', 'KeyB']),
    right: b.fk(right, ['HubB', 'HubC'], hub, ['KeyB', 'KeyC']),
    low: b.fk(low, ['HubA', 'HubB', 'HubC'], hub, ['KeyA', 'KeyB', 'KeyC']),
    lowOther: b.fk(low, ['Ref'], other, ['Ref']),
  };
  const f = finish(b, { Hub: hub, Left: left, Right: right, Low: low, Other: other }, fks);
  place(f, { Other: [20, 40], Hub: [220, 40], Left: [40, 260], Right: [420, 260], Low: [200, 440] });
  return f;
}
