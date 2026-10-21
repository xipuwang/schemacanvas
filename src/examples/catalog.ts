import { buildProject, type ExampleSource } from './build';
import { LAYOUTS } from './layouts';
import { specA, specB, specC, specCompany, specD, specE, specUniversity } from './models';
import type { RelationalModel } from '@/model/types';
import type { ExampleDefinition, ExampleLevel } from './types';

interface Entry {
  id: string;
  level: ExampleLevel;
  tags: string[];
  name: string;
  description: string;
  spec: ExampleSource['spec'];
  /** Diagram option overrides for the relational diagram (presentation only). */
  relationalOptions?: ExampleSource['relationalOptions'];
  tweak?: ExampleSource['tweak'];
}

const ENTRIES: Entry[] = [
  {
    id: 'composite-multivalued',
    level: 'basic',
    tags: ['composite', 'multivalued', 'derived'],
    name: 'Student: composite and multivalued attributes',
    description:
      'Name and Address are composite (flattened), ProgrammingLanguages and Preference are multivalued (one relation each), Age is derived (not stored).',
    spec: specA,
  },
  {
    id: 'weak-entity',
    level: 'basic',
    tags: ['weak entity', 'identifying relationship', 'composite key'],
    name: 'Company makes Drug: weak entity',
    description: 'Drug is identified through Company by the identifying relationship Makes: its key is (CompanyName, TradeName).',
    spec: specB,
  },
  {
    id: 'recursive-1n',
    level: 'basic',
    tags: ['recursive', '1:N', 'roles'],
    name: 'Employee manages Employee: recursive 1:N',
    description: 'A recursive one-to-many relationship with the roles manager and subordinate: a self-referencing foreign key.',
    spec: specC,
  },
  {
    id: 'recursive-mn',
    level: 'basic',
    tags: ['recursive', 'M:N', 'roles'],
    name: 'Course prerequisites: recursive M:N',
    description: 'A recursive many-to-many relationship becomes its own relation PreReq(Cid, Req_Cid) with two foreign keys to Course.',
    spec: specD,
  },
  {
    id: 'pharmacy',
    level: 'advanced',
    tags: ['weak entity', 'ternary', 'M:N', '1:N', 'composite foreign key'],
    name: 'Pharmacy system',
    description:
      'Doctor, Patient, Pharmacy, Company and the weak entity Drug, with 1:N, M:N, identifying and ternary relationships and relationship attributes.',
    spec: specE,
    relationalOptions: { compositeFkStyle: 'bracket' },
    tweak: (project, relDiagramId) => {
      // Sell -> Drug leaves the TOP of Sell like every other connector (the automatic choice wraps under the table).
      const d = project.diagrams[relDiagramId]!;
      const model = project.models[d.modelId] as RelationalModel;
      const sell = Object.values(model.relations).find((r) => r.name === 'Sell')!;
      const fk = Object.values(model.foreignKeys).find(
        (f) => f.sourceRelationId === sell.id && model.relations[f.targetRelationId]!.name === 'Drug',
      )!;
      const edge = Object.values(d.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === fk.id)!;
      edge.route.sourceAnchor = { side: 'top' };
    },
  },
  {
    id: 'university',
    level: 'intermediate',
    tags: ['associative entity', '1:N', 'M:N'],
    name: 'University',
    description: 'Students, courses, instructors and departments; the associative entity Enrollment carries the Grade of each student in a course.',
    spec: specUniversity,
  },
  {
    id: 'company',
    level: 'intermediate',
    tags: ['weak entity', 'recursive', '1:1', 'M:N', 'multivalued'],
    name: 'Company database (Elmasri style)',
    description:
      'Employee, Department, Project and the weak entity Dependent, with supervision (recursive), works-on (M:N with Hours) and managing (1:1).',
    spec: specCompany,
  },
];

export const sourceOf = (id: string): ExampleSource & { level: ExampleLevel; tags: string[] } => {
  const e = ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown example "${id}"`);
  return { ...e, layout: LAYOUTS[id]! };
};

export const EXAMPLES: ExampleDefinition[] = ENTRIES.map((e) => ({
  id: e.id,
  titleKey: `examples.${e.id}.title`,
  descriptionKey: `examples.${e.id}.description`,
  level: e.level,
  tags: e.tags,
  build: () => buildProject(sourceOf(e.id)),
}));

export function buildExample(id: string) {
  const def = EXAMPLES.find((x) => x.id === id);
  if (!def) throw new Error(`Unknown example "${id}"`);
  return def.build();
}

/** Layout dev tool only: build without frozen positions. */
export const buildExampleUnplaced = (id: string) => buildProject(sourceOf(id), { frozen: false });
