/** Test fixtures shared by the src/sql tests (not exported from the barrel). */
import { relationalBuilder } from '@/model/builders';
import type { RelationalModel, SqlDialect } from '@/model/types';

/** Horizontal Pharmacy schema of product specification example E: composite PK (Drug) and composite FK (Prescription -> Drug). */
export function pharmacy(dialect: SqlDialect = 'generic'): RelationalModel {
  const b = relationalBuilder('Pharmacy', dialect);
  const doctor = b.relation(
    'Doctor',
    [
      { name: 'SSN', type: 'CHAR(9)' },
      { name: 'Name', type: 'VARCHAR(80)' },
      { name: 'Speciality', type: 'VARCHAR(60)' },
      { name: 'YearsOfExperience', type: 'INTEGER', nullable: true },
    ],
    { pk: ['SSN'] },
  );
  const patient = b.relation(
    'Patient',
    [
      { name: 'SSN', type: 'CHAR(9)' },
      { name: 'Name', type: 'VARCHAR(80)' },
      { name: 'Address', type: 'VARCHAR(200)' },
      { name: 'Age', type: 'INTEGER' },
      { name: 'DoctorSSN', type: 'CHAR(9)', nullable: false },
    ],
    { pk: ['SSN'] },
  );
  const pharmacyR = b.relation(
    'Pharmacy',
    [
      { name: 'Name', type: 'VARCHAR(80)' },
      { name: 'Address', type: 'VARCHAR(200)' },
      { name: 'Phone', type: 'VARCHAR(20)' },
    ],
    { pk: ['Name'] },
  );
  const company = b.relation(
    'Company',
    [
      { name: 'Name', type: 'VARCHAR(80)' },
      { name: 'Phone', type: 'VARCHAR(20)' },
    ],
    { pk: ['Name'] },
  );
  const drug = b.relation(
    'Drug',
    [
      { name: 'CompanyName', type: 'VARCHAR(80)' },
      { name: 'TradeName', type: 'VARCHAR(80)' },
      { name: 'Formula', type: 'VARCHAR(200)' },
    ],
    { pk: ['CompanyName', 'TradeName'] },
  );
  const contract = b.relation(
    'Contact',
    [
      { name: 'PharmacyName', type: 'VARCHAR(80)' },
      { name: 'CompanyName', type: 'VARCHAR(80)' },
      { name: 'StartDate', type: 'DATE', nullable: true },
      { name: 'EndDate', type: 'DATE', nullable: true },
    ],
    { pk: ['PharmacyName', 'CompanyName'] },
  );
  const sell = b.relation(
    'Sell',
    [
      { name: 'PharmacyName', type: 'VARCHAR(80)' },
      { name: 'CompanyName', type: 'VARCHAR(80)' },
      { name: 'TradeName', type: 'VARCHAR(80)' },
      { name: 'Price', type: 'NUMERIC(10,2)', nullable: true },
    ],
    { pk: ['PharmacyName', 'CompanyName', 'TradeName'] },
  );
  const rx = b.relation(
    'Prescription',
    [
      { name: 'DoctorSSN', type: 'CHAR(9)' },
      { name: 'PatientSSN', type: 'CHAR(9)' },
      { name: 'CompanyName', type: 'VARCHAR(80)' },
      { name: 'DrugTradeName', type: 'VARCHAR(80)' },
      { name: 'Date', type: 'DATE' },
      { name: 'Quantity', type: 'INTEGER', nullable: true },
    ],
    { pk: ['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date'] },
  );
  b.fk(patient, ['DoctorSSN'], doctor, ['SSN'], { name: 'fk_patient_doctor' });
  b.fk(drug, ['CompanyName'], company, ['Name'], { onDelete: 'CASCADE' });
  b.fk(contract, ['PharmacyName'], pharmacyR, ['Name']);
  b.fk(contract, ['CompanyName'], company, ['Name']);
  b.fk(sell, ['PharmacyName'], pharmacyR, ['Name']);
  b.fk(sell, ['CompanyName', 'TradeName'], drug, ['CompanyName', 'TradeName'], { name: 'fk_sell_drug', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
  b.fk(rx, ['DoctorSSN'], doctor, ['SSN']);
  b.fk(rx, ['PatientSSN'], patient, ['SSN']);
  // Composite FK: Prescription.(CompanyName, DrugTradeName) -> Drug.(CompanyName, TradeName)
  b.fk(rx, ['CompanyName', 'DrugTradeName'], drug, ['CompanyName', 'TradeName'], { name: 'fk_rx_drug' });
  return b.build();
}

/** Employee.ManagerEid -> Employee.Eid plus an auto-increment key. */
export function selfRef(dialect: SqlDialect = 'generic'): RelationalModel {
  const b = relationalBuilder('Org', dialect);
  const emp = b.relation(
    'Employee',
    [
      { name: 'Eid', type: 'INTEGER', autoIncrement: true },
      { name: 'Name', type: 'VARCHAR(50)', nullable: false },
      { name: 'ManagerEid', type: 'INTEGER', nullable: true },
    ],
    { pk: ['Eid'] },
  );
  b.fk(emp, ['ManagerEid'], emp, ['Eid'], { onDelete: 'SET NULL' });
  return b.build();
}

/** A <-> B mutual foreign keys (an FK cycle) plus a leaf table. */
export function cycle(dialect: SqlDialect = 'generic'): RelationalModel {
  const b = relationalBuilder('Cycle', dialect);
  const a = b.relation('A', [{ name: 'id', type: 'INTEGER' }, { name: 'b_id', type: 'INTEGER', nullable: true }], { pk: ['id'] });
  const bb = b.relation('B', [{ name: 'id', type: 'INTEGER' }, { name: 'a_id', type: 'INTEGER', nullable: true }], { pk: ['id'] });
  const leaf = b.relation('Leaf', [{ name: 'id', type: 'INTEGER' }, { name: 'a_id', type: 'INTEGER' }], { pk: ['id'] });
  b.fk(a, ['b_id'], bb, ['id'], { name: 'fk_a_b' });
  b.fk(bb, ['a_id'], a, ['id'], { name: 'fk_b_a' });
  b.fk(leaf, ['a_id'], a, ['id']);
  return b.build();
}

/** Everything the DDL supports in one model: defaults, uniques, indexes, checks, composite keys. */
export function kitchenSink(dialect: SqlDialect = 'generic'): RelationalModel {
  const b = relationalBuilder('Kitchen Sink', dialect);
  const user = b.relation(
    'users',
    [
      { name: 'id', type: 'BIGINT', autoIncrement: true },
      { name: 'email', type: 'VARCHAR(255)', nullable: false, unique: true },
      { name: 'status', type: 'VARCHAR(20)', nullable: false, default: "'active'" },
      { name: 'score', type: 'NUMERIC(8,2)', nullable: true, default: '0' },
      { name: 'created', type: 'TIMESTAMP', nullable: false, default: 'CURRENT_TIMESTAMP' },
    ],
    { pk: ['id'] },
  );
  user.index('idx_users_status', ['status']);
  user.index('idx_users_created', ['created'], false);
  user.relation.indexes[1]!.descendingColumnIds = [user.col('created')];
  user.relation.checks = [{ id: 'chk_1', name: 'ck_score', expression: 'score >= 0' }];
  const order = b.relation(
    'order',
    [
      { name: 'user id', type: 'BIGINT', nullable: false },
      { name: 'No', type: 'INTEGER' },
      { name: 'note', type: 'TEXT', nullable: true },
    ],
    { pk: ['user id', 'No'] },
  );
  b.fk(order, ['user id'], user, ['id'], { onDelete: 'CASCADE', onUpdate: 'NO ACTION' });
  return b.build();
}
