/**
 * Insertable fragments for the library sidebar. Each template is a tiny model + diagram with frozen centre positions,
 * packaged as a ClipboardPayload so inserting goes through the SAME code path as paste (every id is remapped).
 */
import { erBuilder, relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import { extractClipboard, pasteClipboard, type ClipboardPayload } from '@/model/ops/clipboard';
import type { DiagramType, ErModel, Id, Point, Project, RelationalModel } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { deterministically } from './build';
import { nodeIdsByKey } from './nodeKeys';
import type { TemplateDefinition } from './types';

type Centres = Record<string, [number, number]>;

interface TemplateSource {
  id: string;
  modelKind: 'er' | 'relational';
  make(): ErModel | RelationalModel;
  /** Centre of each node keyed by element name path (nodeKeys.ts). */
  centres: Centres;
}

const weakEntity = (): ErModel => {
  const b = erBuilder('Weak entity pattern');
  const owner = b.entity('Owner').key('OwnerId', { dataType: 'INT' }).attr('Name', { dataType: 'VARCHAR(60)' });
  const weak = b.entity('WeakEntity', { weak: true }).partialKey('Number', { dataType: 'INT' }).attr('Description', { dataType: 'VARCHAR(120)' });
  b.relate('Identifies', owner, weak, '1:N', { identifying: true, rightTotal: true });
  return b.build();
};

const manyToMany = (): ErModel => {
  const b = erBuilder('M:N pattern');
  const a = b.entity('Student').key('StudentId', { dataType: 'INT' });
  const c = b.entity('Course').key('CourseId', { dataType: 'VARCHAR(10)' });
  b.relate('Enrolls', a, c, 'M:N').attr('Grade', { dataType: 'CHAR(2)', optional: true });
  return b.build();
};

const recursive = (): ErModel => {
  const b = erBuilder('Recursive 1:N pattern');
  const e = b.entity('Employee').key('Eid', { dataType: 'INT' });
  b.relate('Manages', e, e, '1:N', { leftRole: 'manager', rightRole: 'subordinate' });
  return b.build();
};

const ternary = (): ErModel => {
  const b = erBuilder('Ternary pattern');
  const s = b.entity('Supplier').key('SupplierId', { dataType: 'INT' });
  const p = b.entity('Part').key('PartId', { dataType: 'INT' });
  const j = b.entity('Project').key('ProjectId', { dataType: 'INT' });
  b.relationship('Supplies', [{ entity: s }, { entity: p }, { entity: j }]).attr('Quantity', { dataType: 'INT' });
  return b.build();
};

const attributePattern = (): ErModel => {
  const b = erBuilder('Attribute pattern');
  const p = b.entity('Person').key('PersonId', { dataType: 'INT' });
  p.composite('Name', [{ name: 'First', dataType: 'VARCHAR(40)' }, { name: 'Last', dataType: 'VARCHAR(40)' }]).multivalued('Phone', {
    dataType: 'VARCHAR(20)',
  });
  p.attr('BirthDate', { dataType: 'DATE' });
  const birth = Object.values(b.model.attributes).find((a) => a.name === 'BirthDate')!;
  p.derived('Age', { dataType: 'INT', derivedFrom: [birth.id] });
  return b.build();
};

const parentChild = (): RelationalModel => {
  const b = relationalBuilder('Parent-child pattern');
  const parent = b.relation('Parent', [{ name: 'ParentId', type: 'INT' }, { name: 'Name', type: 'VARCHAR(60)' }], { pk: ['ParentId'] });
  const child = b.relation(
    'Child',
    [{ name: 'ChildId', type: 'INT' }, { name: 'Name', type: 'VARCHAR(60)' }, { name: 'ParentId', type: 'INT' }],
    { pk: ['ChildId'] },
  );
  b.fk(child, ['ParentId'], parent, ['ParentId']);
  return b.build();
};

const linkTable = (): RelationalModel => {
  const b = relationalBuilder('Link table pattern');
  const left = b.relation('Left', [{ name: 'LeftId', type: 'INT' }, { name: 'Name', type: 'VARCHAR(60)' }], { pk: ['LeftId'] });
  const right = b.relation('Right', [{ name: 'RightId', type: 'INT' }, { name: 'Name', type: 'VARCHAR(60)' }], { pk: ['RightId'] });
  const link = b.relation(
    'LeftRight',
    [{ name: 'LeftId', type: 'INT' }, { name: 'RightId', type: 'INT' }, { name: 'Since', type: 'DATE', nullable: true }],
    { pk: ['LeftId', 'RightId'] },
  );
  b.fk(link, ['LeftId'], left, ['LeftId']);
  b.fk(link, ['RightId'], right, ['RightId']);
  return b.build();
};

const SOURCES: TemplateSource[] = [
  {
    id: 'weak-entity',
    modelKind: 'er',
    make: weakEntity,
    centres: {
      Owner: [140, 170], 'Owner.OwnerId': [90, 70], 'Owner.Name': [200, 60],
      Identifies: [390, 170],
      WeakEntity: [660, 170], 'WeakEntity.Number': [600, 70], 'WeakEntity.Description': [730, 70],
    },
  },
  {
    id: 'many-to-many',
    modelKind: 'er',
    make: manyToMany,
    centres: {
      Student: [140, 170], 'Student.StudentId': [140, 70],
      Enrolls: [380, 170], 'Enrolls.Grade': [380, 70],
      Course: [620, 170], 'Course.CourseId': [620, 70],
    },
  },
  {
    id: 'recursive-1n',
    modelKind: 'er',
    make: recursive,
    centres: { Employee: [140, 210], 'Employee.Eid': [140, 310], Manages: [140, 70] },
  },
  {
    id: 'ternary',
    modelKind: 'er',
    make: ternary,
    centres: {
      Supplier: [120, 110], 'Supplier.SupplierId': [120, 20],
      Part: [120, 330], 'Part.PartId': [120, 420],
      Supplies: [360, 220], 'Supplies.Quantity': [360, 340],
      Project: [600, 220], 'Project.ProjectId': [600, 130],
    },
  },
  {
    id: 'composite-multivalued',
    modelKind: 'er',
    make: attributePattern,
    centres: {
      Person: [340, 260],
      'Person.PersonId': [340, 380],
      'Person.Name': [180, 190], 'Person.Name.First': [60, 120], 'Person.Name.Last': [90, 260],
      'Person.Phone': [520, 130],
      'Person.BirthDate': [520, 390],
      'Person.Age': [430, 440],
    },
  },
  {
    id: 'parent-child',
    modelKind: 'relational',
    make: parentChild,
    centres: { Parent: [130, 60], Child: [170, 220] },
  },
  {
    id: 'link-table',
    modelKind: 'relational',
    make: linkTable,
    centres: { Left: [110, 60], Right: [400, 60], LeftRight: [260, 220] },
  },
];

const DIAGRAM_TYPE: Record<'er' | 'relational', DiagramType> = { er: 'chen', relational: 'relational-schema' };

function buildPayload(src: TemplateSource): ClipboardPayload {
  return deterministically(() => {
    const project: Project = createBareProject(src.id);
    const model = src.make();
    const diagram = withDiagram(project, model, DIAGRAM_TYPE[src.modelKind], { name: src.id });
    // Centres -> top-left through the derived text-fitted sizes (pure and deterministic; no layout engine).
    const scene = buildScene(project, diagram.id);
    const ids = nodeIdsByKey(model, diagram);
    for (const [key, id] of Object.entries(ids)) {
      const c = src.centres[key];
      if (!c) throw new Error(`template ${src.id}: no position for "${key}"`);
      const b = scene.nodes[id]!.bounds;
      diagram.nodes[id]!.x = Math.round(c[0] - b.w / 2);
      diagram.nodes[id]!.y = Math.round(c[1] - b.h / 2);
    }
    return extractClipboard(project, diagram.id, Object.keys(diagram.nodes));
  });
}

export const TEMPLATES: TemplateDefinition[] = SOURCES.map((s) => ({
  id: s.id,
  titleKey: `examples.template.${s.id}.title`,
  descriptionKey: `examples.template.${s.id}.description`,
  modelKind: s.modelKind,
  build: () => buildPayload(s),
}));

/**
 * Paste template `templateId` into `diagramId` of `draft` with its top-left corner at `at` (world units), through
 * `ops.pasteClipboard`, so every id is fresh. Throws OpError('paste-kind-mismatch') when the diagram views the other
 * kind of model (the UI only offers matching templates).
 */
export function insertTemplate(draft: Project, diagramId: Id, templateId: string, at: Point): { nodeIds: Id[] } {
  const def = TEMPLATES.find((t) => t.id === templateId);
  if (!def) throw new Error(`Unknown template "${templateId}"`);
  const payload = def.build();
  const minX = Math.min(...payload.nodes.map((n) => n.x));
  const minY = Math.min(...payload.nodes.map((n) => n.y));
  const { nodeIds } = pasteClipboard(draft, diagramId, payload, { x: at.x - minX, y: at.y - minY });
  return { nodeIds };
}
