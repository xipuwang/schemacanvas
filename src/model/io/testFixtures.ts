/** Fixtures shared by io/store/persistence tests (not imported by production code). */
import { createBareProject } from '../defaults';
import { erBuilder, relationalBuilder } from '../builders';
import { withDiagram } from '../diagramSync';
import type { Project } from '../types';

/** ER (Company makes Drug, weak) + relational (Doctor/Patient/Prescription) with a composite FK, both diagrammed. */
export function sampleProject(name = 'Sample'): Project {
  const p = createBareProject(name);
  const b = erBuilder('Pharmacy ER');
  const company = b.entity('Company').key('name').attr('address');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  withDiagram(p, b.build(), 'chen', { name: 'ER' });

  const r = relationalBuilder('Pharmacy Schema');
  const doctor = r.relation('Doctor', ['SSN', 'Name'], { pk: ['SSN'] });
  const patient = r.relation('Patient', ['PID', 'DoctorSSN'], { pk: ['PID'] });
  const comp = r.relation('Drug', ['CompanyName', 'TradeName'], { pk: ['CompanyName', 'TradeName'] });
  const presc = r.relation('Prescription', ['PID', 'CompanyName', 'DrugTradeName'], { pk: ['PID', 'CompanyName', 'DrugTradeName'] });
  r.fk(patient, ['DoctorSSN'], doctor, ['SSN']);
  r.fk(presc, ['CompanyName', 'DrugTradeName'], comp, ['CompanyName', 'TradeName']);
  r.fk(presc, ['PID'], patient, ['PID']);
  withDiagram(p, r.build(), 'relational-schema', { name: 'Schema' });
  return p;
}

/** A project with `n` relations (3 columns each) chained by FKs: for round-trip size tests. */
export function largeProject(n: number): Project {
  const p = createBareProject('Large');
  const r = relationalBuilder('Big');
  let prev: ReturnType<typeof r.relation> | undefined;
  for (let i = 0; i < n; i++) {
    const rel = r.relation(`T${i}`, ['id', 'ref', 'payload'], { pk: ['id'] });
    if (prev) r.fk(rel, ['ref'], prev, ['id']);
    prev = rel;
  }
  withDiagram(p, r.build(), 'relational-schema');
  return p;
}
