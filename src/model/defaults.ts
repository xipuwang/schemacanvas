import { nowIso } from './clock';
import { newId } from './ids';
import {
  SCHEMA_VERSION,
  type Diagram,
  type DiagramOptions,
  type DiagramType,
  type ErModel,
  type Id,
  type Project,
  type RelationalModel,
  type SqlDialect,
  type ConversionOptions,
} from './types';

/** Canonical diagram font. Helvetica/Arial/Arimo/Liberation Sans share AFM metrics, so measurement is reproducible. */
export const DEFAULT_FONT_FAMILY = "Helvetica, Arial, Arimo, 'Liberation Sans', sans-serif";
/** The ONLY font stacks UI pickers may offer (both have exact metric tables in scene/measure.ts). */
export const FONT_STACKS = {
  sans: DEFAULT_FONT_FAMILY,
  mono: "'Courier New', Courier, 'Liberation Mono', monospace",
} as const;
export const DEFAULT_FONT_SIZE = 14;

export function defaultDiagramOptions(type: DiagramType): DiagramOptions {
  const base: DiagramOptions = {
    grid: { visible: true, size: 20, snap: true },
    typography: { fontFamily: DEFAULT_FONT_FAMILY, fontSize: DEFAULT_FONT_SIZE },
  };
  switch (type) {
    case 'chen':
      return {
        ...base,
        chen: { showRoles: true, showDataTypes: false, cardinalityStyle: 'letters', routing: 'straight' },
      };
    case 'relational-schema':
      return {
        ...base,
        relational: {
          rowHeight: 32,
          cellPaddingX: 12,
          showDataTypes: false,
          nameAbove: true,
          fkLabels: false,
          compositeFkStyle: 'branches',
          routing: 'orthogonal',
        },
      };
    case 'crows-foot':
      return {
        ...base,
        crowsFoot: { orientation: 'vertical', showTypes: true, showNullability: true, routing: 'orthogonal' },
      };
    case 'physical':
      return {
        ...base,
        physical: { showIndexes: true, showConstraints: true, routing: 'orthogonal' },
      };
  }
}

export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
  oneToOne: 'auto',
  relationshipOverrides: {},
  materializeDerived: [],
  carryDataTypes: true,
};

export function createErModel(name = 'ER Model', id: Id = newId('mdl')): ErModel {
  return { id, kind: 'er', name, entities: {}, attributes: {}, relationships: {} };
}

export function createRelationalModel(
  name = 'Relational Schema',
  dialect: SqlDialect = 'generic',
  id: Id = newId('mdl'),
): RelationalModel {
  return { id, kind: 'relational', name, dialect, relations: {}, foreignKeys: {} };
}

export function createDiagram(type: DiagramType, modelId: Id, name?: string, id: Id = newId('dgm')): Diagram {
  return {
    id,
    name: name ?? defaultDiagramName(type),
    type,
    modelId,
    nodes: {},
    edges: {},
    options: defaultDiagramOptions(type),
  };
}

export function defaultDiagramName(type: DiagramType): string {
  switch (type) {
    case 'chen':
      return 'ER Diagram';
    case 'relational-schema':
      return 'Relational Schema';
    case 'crows-foot':
      return "Crow's Foot ERD";
    case 'physical':
      return 'Physical Model';
  }
}

/** Which model kind a diagram type views. */
export function modelKindForDiagramType(type: DiagramType): 'er' | 'relational' {
  return type === 'chen' ? 'er' : 'relational';
}

/** An empty project containing one empty ER model and one empty Chen diagram. */
export function createProject(name = 'Untitled project'): Project {
  const now = nowIso();
  const er = createErModel('ER Model');
  const diagram = createDiagram('chen', er.id);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    models: { [er.id]: er },
    diagrams: { [diagram.id]: diagram },
    diagramOrder: [diagram.id],
    conversions: {},
    settings: { defaultDialect: 'generic' },
  };
}

/** A project with no models or diagrams at all (builders / import use this). */
export function createBareProject(name = 'Untitled project'): Project {
  const p = createProject(name);
  return { ...p, models: {}, diagrams: {}, diagramOrder: [] };
}
