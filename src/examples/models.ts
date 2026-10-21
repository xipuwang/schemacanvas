/**
 * The ER models of the examples (product specification section 8 A-E plus two teaching examples). Built with the fluent builders;
 * ids come from the caller's (deterministic) generator. Each spec also carries the ConversionOptions that give the
 * textbook column names (`columnPrefixes` are keyed by participant id, so they can only be computed here).
 */
import { erBuilder, type ErBuilder, type RelationshipHandle } from '@/model/builders';
import type { ErSpec } from './types';

const part = (r: RelationshipHandle, i: number): string => r.relationship.participants[i]!.id;
const prefixes = (...pairs: Array<[string, string]>): Record<string, string> => Object.fromEntries(pairs);

function derivedFrom(b: ErBuilder, ownerName: string, attrName: string): string[] {
  const entity = Object.values(b.model.entities).find((e) => e.name === ownerName)!;
  const a = Object.values(b.model.attributes).find((x) => x.owner.kind === 'entity' && x.owner.id === entity.id && x.name === attrName)!;
  return [a.id];
}

/** A: composite, multivalued and derived attributes. */
export function specA(): ErSpec {
  const b = erBuilder('Composite and multivalued attributes');
  const student = b.entity('Student').key('SID', { dataType: 'INT' });
  student
    .composite('Name', [
      { name: 'First', dataType: 'VARCHAR(40)' },
      { name: 'Middle', dataType: 'VARCHAR(40)', optional: true },
      { name: 'Last', dataType: 'VARCHAR(40)' },
    ])
    .composite('Address', [
      { name: 'Street', dataType: 'VARCHAR(80)' },
      { name: 'City', dataType: 'VARCHAR(40)' },
      { name: 'ZipCode', dataType: 'CHAR(5)' },
    ])
    .multivalued('ProgrammingLanguages', { dataType: 'VARCHAR(30)' })
    .multivalued('Preference', { dataType: 'VARCHAR(40)' })
    .attr('DOB', { dataType: 'DATE' });
  student.derived('Age', { dataType: 'INT', derivedFrom: derivedFrom(b, 'Student', 'DOB') });
  return { er: b.build(), renames: [['Student_ProgrammingLanguages', 'StudentSID', 'SID'], ['Student_Preference', 'StudentSID', 'SID']] };
}

/** B: weak entity Drug identified by Company through the identifying relationship Makes. */
export function specB(): ErSpec {
  const b = erBuilder('Weak entity');
  const company = b.entity('Company').key('name', { dataType: 'VARCHAR(60)' }).attr('address', { dataType: 'VARCHAR(120)' });
  const drug = b
    .entity('Drug', { weak: true })
    .partialKey('TradeName', { dataType: 'VARCHAR(60)' })
    .attr('Formula', { dataType: 'VARCHAR(120)' });
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  return { er: b.build() };
}

/** C: Employee manages Employee (recursive 1:N). */
export function specC(): ErSpec {
  const b = erBuilder('Recursive 1:N');
  const emp = b.entity('Employee').key('Eid', { dataType: 'INT' }).attr('Name', { dataType: 'VARCHAR(60)' });
  b.relate('Manages', emp, emp, '1:N', { leftRole: 'manager', rightRole: 'subordinate' });
  return { er: b.build() };
}

/** D: Course has prerequisite Course (recursive M:N); PreReq(Cid, Req_Cid) via literal column prefixes. */
export function specD(): ErSpec {
  const b = erBuilder('Recursive M:N');
  const course = b.entity('Course').key('Cid', { dataType: 'INT' }).attr('Name', { dataType: 'VARCHAR(80)' });
  const r = b.relate('PreReq', course, course, 'M:N', { leftRole: 'course', rightRole: 'requires' });
  return { er: b.build(), options: { columnPrefixes: prefixes([part(r, 0), ''], [part(r, 1), 'Req_']) } };
}

/** E: the complete pharmacy system. */
export function specE(): ErSpec {
  const b = erBuilder('Pharmacy system');
  const doctor = b
    .entity('Doctor')
    .key('SSN', { dataType: 'CHAR(9)' })
    .attr('Name', { dataType: 'VARCHAR(60)' })
    .attr('Specialty', { dataType: 'VARCHAR(40)' })
    .attr('YearsOfExperience', { dataType: 'INT' });
  const patient = b
    .entity('Patient')
    .key('SSN', { dataType: 'CHAR(9)' })
    .attr('Name', { dataType: 'VARCHAR(60)' })
    .attr('Address', { dataType: 'VARCHAR(120)' })
    .attr('Age', { dataType: 'INT' });
  const pharmacy = b
    .entity('Pharmacy')
    .key('Name', { dataType: 'VARCHAR(60)' })
    .attr('Address', { dataType: 'VARCHAR(120)' })
    .attr('Phone', { dataType: 'VARCHAR(20)' });
  const company = b.entity('Company').key('name', { dataType: 'VARCHAR(60)' }).attr('phone', { dataType: 'VARCHAR(20)' });
  const drug = b
    .entity('Drug', { weak: true })
    .partialKey('TradeName', { dataType: 'VARCHAR(60)' })
    .attr('Formula', { dataType: 'VARCHAR(120)' });
  b.relate('PrimaryPhysician', doctor, patient, '1:N', { rightTotal: true });
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  b.relate('Sell', drug, pharmacy, 'M:N').attr('Price', { dataType: 'DECIMAL(8,2)' });
  b.relate('Contact', company, pharmacy, 'M:N')
    .attr('StartDate', { dataType: 'DATE' })
    .attr('EndDate', { dataType: 'DATE', optional: true })
    .attr('Supervisor', { dataType: 'VARCHAR(60)' });
  b.relationship('Prescription', [{ entity: doctor }, { entity: patient }, { entity: drug }])
    .key('Date', { dataType: 'DATE' })
    .attr('Quantity', { dataType: 'INT' });
  return { er: b.build() };
}

/** F: University with an associative entity Enrollment carrying Grade. */
export function specUniversity(): ErSpec {
  const b = erBuilder('University');
  const dept = b
    .entity('Department')
    .key('DeptId', { dataType: 'INT' })
    .attr('Name', { dataType: 'VARCHAR(60)' })
    .attr('Building', { dataType: 'VARCHAR(40)' });
  const student = b
    .entity('Student')
    .key('StudentId', { dataType: 'INT' })
    .attr('Name', { dataType: 'VARCHAR(60)' })
    .attr('Email', { dataType: 'VARCHAR(80)' });
  const instructor = b
    .entity('Instructor')
    .key('InstructorId', { dataType: 'INT' })
    .attr('Name', { dataType: 'VARCHAR(60)' })
    .attr('Office', { dataType: 'VARCHAR(20)' });
  const course = b
    .entity('Course')
    .key('CourseId', { dataType: 'VARCHAR(10)' })
    .attr('Title', { dataType: 'VARCHAR(80)' })
    .attr('Credits', { dataType: 'INT' });
  const offers = b.relate('Offers', dept, course, '1:N', { rightTotal: true });
  const employs = b.relate('Employs', dept, instructor, '1:N', { rightTotal: true });
  const teaches = b.relate('Teaches', instructor, course, '1:N');
  const majors = b.relate('MajorsIn', dept, student, '1:N');
  const enrolls = b.relate('Enrolls', student, course, 'M:N');
  b.associativeEntity('Enrollment', enrolls).attr('Grade', { dataType: 'CHAR(2)', optional: true });
  return {
    er: b.build(),
    options: {
      // FK columns keep the referenced key's own name (DeptId, not DepartmentDeptId).
      columnPrefixes: prefixes(
        [part(offers, 0), ''],
        [part(employs, 0), ''],
        [part(teaches, 0), ''],
        [part(majors, 0), ''],
        [part(enrolls, 0), ''],
        [part(enrolls, 1), ''],
      ),
    },
    renames: [],
  };
}

/** G: the classic Company database in the style of Elmasri and Navathe. */
export function specCompany(): ErSpec {
  const b = erBuilder('Company database');
  const employee = b.entity('Employee').key('Ssn', { dataType: 'CHAR(9)' });
  employee
    .composite('Name', [
      { name: 'Fname', dataType: 'VARCHAR(30)' },
      { name: 'Minit', dataType: 'CHAR(1)', optional: true },
      { name: 'Lname', dataType: 'VARCHAR(30)' },
    ])
    .attr('Bdate', { dataType: 'DATE' })
    .attr('Address', { dataType: 'VARCHAR(120)' })
    .attr('Sex', { dataType: 'CHAR(1)' })
    .attr('Salary', { dataType: 'DECIMAL(10,2)' });
  const department = b
    .entity('Department')
    .key('Dnumber', { dataType: 'INT' })
    .attr('Dname', { dataType: 'VARCHAR(40)' })
    .multivalued('Locations', { dataType: 'VARCHAR(40)' });
  const project = b
    .entity('Project')
    .key('Pnumber', { dataType: 'INT' })
    .attr('Pname', { dataType: 'VARCHAR(40)' })
    .attr('Plocation', { dataType: 'VARCHAR(40)' });
  const dependent = b
    .entity('Dependent', { weak: true })
    .partialKey('DependentName', { dataType: 'VARCHAR(40)' })
    .attr('Sex', { dataType: 'CHAR(1)' })
    .attr('Bdate', { dataType: 'DATE' })
    .attr('Relationship', { dataType: 'VARCHAR(20)' });
  // Employee participation is partial: with Manages total on Department both FKs would be NOT NULL (a circular dependency).
  const worksFor = b.relate('WorksFor', department, employee, '1:N');
  const manages = b.relate('Manages', employee, department, '1:1', { rightTotal: true }).attr('StartDate', { dataType: 'DATE' });
  const controls = b.relate('Controls', department, project, '1:N', { rightTotal: true });
  const supervision = b.relate('Supervision', employee, employee, '1:N', { leftRole: 'supervisor', rightRole: 'supervisee' });
  const worksOn = b.relate('WorksOn', employee, project, 'M:N', { leftTotal: true, rightTotal: true }).attr('Hours', { dataType: 'DECIMAL(4,1)' });
  const dependents = b.relate('DependentsOf', employee, dependent, '1:N', { identifying: true, rightTotal: true });
  return {
    er: b.build(),
    renames: [['Department_Locations', 'DepartmentDnumber', 'Dnumber']],
    options: {
      columnPrefixes: prefixes(
        [part(worksFor, 0), ''], // Employee.Dnumber
        [part(manages, 0), 'Mgr_'], // Department.Mgr_Ssn
        [part(controls, 0), ''], // Project.Dnumber
        [part(supervision, 0), 'Super_'], // Employee.Super_Ssn
        [part(worksOn, 0), ''], // WorksOn.Ssn
        [part(worksOn, 1), ''], // WorksOn.Pnumber
        [part(dependents, 0), ''], // Dependent.Ssn
      ),
    },
  };
}
