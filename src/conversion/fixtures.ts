/** ER fixtures shared by the conversion suites (spec examples A and E, plus a model that uses every rule). */
import { erBuilder } from '@/model/builders';
import type { ErModel } from '@/model/types';

/** Spec example A: composite, multivalued and derived attributes. */
export function exampleA(): ErModel {
  const b = erBuilder('A');
  const student = b.entity('Student').key('SID', { dataType: 'INT' });
  student
    .composite('Name', ['FirstName', 'LastName'])
    .composite('Address', ['Street', 'City', 'ZipCode'])
    .multivalued('ProgrammingLanguages', { dataType: 'VARCHAR(30)' })
    .multivalued('Preference')
    .attr('DOB', { dataType: 'DATE' });
  const dob = Object.values(b.model.attributes).find((a) => a.name === 'DOB')!;
  student.derived('Age', { derivedFrom: [dob.id] });
  return b.build();
}

/** Spec example E: the complete pharmacy system. */
export function exampleE(): ErModel {
  const b = erBuilder('Pharmacy');
  const doctor = b.entity('Doctor').key('SSN', { dataType: 'CHAR(9)' }).attr('Name').attr('Specialty').attr('YearsOfExperience', { dataType: 'INT' });
  const patient = b.entity('Patient').key('SSN', { dataType: 'CHAR(9)' }).attr('Name').attr('Address').attr('Age', { dataType: 'INT' });
  const pharmacy = b.entity('Pharmacy').key('Name').attr('Address').attr('Phone');
  const company = b.entity('Company').key('name').attr('phone');
  const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
  b.relate('PrimaryPhysician', doctor, patient, '1:N', { rightTotal: true });
  b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
  b.relate('Sell', pharmacy, drug, 'M:N').attr('Price', { dataType: 'DECIMAL(8,2)' });
  b.relate('Contract', pharmacy, company, 'M:N').attr('StartDate').attr('EndDate', { optional: true });
  b.relationship('Prescription', [{ entity: doctor }, { entity: patient }, { entity: drug }])
    .key('Date')
    .attr('Quantity', { dataType: 'INT' });
  return b.build();
}


/** Everything at once: strong/weak/associative/merge/1:1/ternary/composite/multivalued/derived/recursive. */
export function kitchenSink(): ErModel {
  const b = erBuilder('Sink');
  const person = b.entity('Person').key('Pid').composite('Name', ['First', 'Last']).multivalued('Phone').derived('Age');
  const passport = b.entity('Passport').key('No');
  const emp = b.entity('Employee').key('Eid');
  const course = b.entity('Course').key('Cid');
  const dept = b.entity('Dept').key('Did');
  const dep = b.entity('Dependent', { weak: true }).partialKey('Dn').composite('Addr', ['City']);
  b.relate('Holds', person, passport, '1:1', { leftTotal: true }).attr('Issued');
  b.relate('Manages', emp, emp, '1:N', { leftRole: 'boss', rightRole: 'report' });
  b.relate('Works', dept, emp, '1:N', { leftTotal: true }).attr('Since');
  b.relate('Has', emp, dep, '1:N', { identifying: true, rightTotal: true }).attr('Rel');
  const teaches = b.relate('Teaches', emp, course, 'M:N');
  teaches.key('Term').multivalued('Rooms');
  b.associativeEntity('Offering', teaches).key('Oid');
  b.relationship('Tri', [{ entity: person, max: 'one' }, { entity: course }, { entity: dept }]);
  return b.build();
}

