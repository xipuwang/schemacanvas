/** Test helpers shared by the ops tests (not exported from index.ts). */
import { produce } from 'immer';
import { expect } from 'vitest';
import { erBuilder, relationalBuilder } from '../builders';
import { createBareProject } from '../defaults';
import { syncDiagram, withDiagram } from '../diagramSync';
import { checkInvariants } from '../invariants';
import type { DiagramType, ErModel, Project, RelationalModel } from '../types';
import { deepFreeze } from '@/test/deepFreeze';

/** Must hold after EVERY op: hard invariants + every diagram is a fixed point of syncDiagram (complete, no strays). */
export function expectConsistent(p: Project): void {
  expect(checkInvariants(p)).toEqual([]);
  const copy: Project = JSON.parse(JSON.stringify(p));
  for (const id of Object.keys(copy.diagrams)) syncDiagram(copy, id);
  expect(copy).toEqual(JSON.parse(JSON.stringify(p)));
}

/** Run an op on a deeply frozen project through immer, check consistency, return the next (frozen) project. */
export function run<T = void>(p: Project, fn: (d: Project) => T): { project: Project; result: T } {
  let result!: T;
  const project = produce(deepFreeze(p), (d) => {
    result = fn(d as Project);
  });
  expectConsistent(project);
  return { project, result };
}

export function projectWith(model: ErModel | RelationalModel, ...types: DiagramType[]): Project {
  const p = createBareProject('t');
  for (const t of types) withDiagram(p, model, t);
  if (types.length === 0) p.models[model.id] = model;
  return p;
}

/** Small ER model: Dept 1—Works_for—N Employee (+ attributes, weak Dependent with identifying relationship). */
export function sampleEr() {
  const b = erBuilder('Company');
  const dept = b.entity('Dept').key('Dnum').attr('Dname');
  const emp = b.entity('Employee').key('Eid').composite('Name', ['First', 'Last']).multivalued('Phone');
  const dep = b.entity('Dependent', { weak: true }).partialKey('DName');
  const works = b.relate('Works_for', dept, emp, '1:N', { rightTotal: true });
  works.attr('since');
  const has = b.relate('Has', emp, dep, '1:N', { identifying: true, rightTotal: true });
  return { b, dept, emp, dep, works, has, model: b.build() };
}

/** Small relational model: Doctor(SSN) <- Patient(PID, DoctorSSN); Drug(Company, Trade) <- Prescription(...composite FK). */
export function sampleRel() {
  const b = relationalBuilder('Pharmacy');
  const doctor = b.relation('Doctor', [{ name: 'SSN', type: 'CHAR(9)' }, 'Name'], { pk: ['SSN'] });
  const patient = b.relation('Patient', ['PID', 'Name', { name: 'DoctorSSN', type: 'CHAR(9)' }], { pk: ['PID'] });
  const drug = b.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const rx = b.relation('Prescription', ['PID', 'CompanyName', 'DrugTradeName', 'Qty'], { pk: ['PID', 'CompanyName', 'DrugTradeName'] });
  const fk1 = b.fk(patient, ['DoctorSSN'], doctor, ['SSN']);
  const fk2 = b.fk(rx, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName']);
  const fk3 = b.fk(rx, ['PID'], patient, ['PID']);
  return { b, doctor, patient, drug, rx, fk1, fk2, fk3, model: b.build() };
}
