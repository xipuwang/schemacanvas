import { convertErToRelational } from '@/conversion';
import { nowIso, useFixedClock } from '@/model/clock';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import { useDeterministicIds } from '@/model/ids';
import { applyConversionResult } from '@/model/ops/conversion';
import type { ErModel, Project, RelationalSchemaOptions } from '@/model/types';
import { applyFrozenPositions } from './nodeKeys';
import type { ErSpec, FrozenLayout } from './types';

/** Every example and template is stamped with this instant; the real clock is restored afterwards. */
export const EXAMPLE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/** Run `fn` with sequential ids and a fixed clock, restoring both in `finally` so user-created ids stay random. */
export function deterministically<T>(fn: () => T): T {
  const restoreIds = useDeterministicIds();
  const restoreClock = useFixedClock(EXAMPLE_TIMESTAMP);
  try {
    return fn();
  } finally {
    restoreClock();
    restoreIds();
  }
}

export interface BuildOptions {
  /** Apply the frozen coordinates (default true). Only the layout dev tool passes false. */
  frozen?: boolean;
}

export interface ExampleSource {
  id: string;
  /** English project name / description (the gallery shows the i18n texts; these are what lands in the project). */
  name: string;
  description: string;
  spec: () => ErSpec;
  layout: FrozenLayout;
  relationalOptions?: Partial<RelationalSchemaOptions>;
  /** Presentation-only touch-ups after layout (e.g. an anchor side) on the finished project. */
  tweak?: (project: Project, relDiagramId: string) => void;
}

/** Complete project: ER model + Chen diagram, relational model from the REAL converter + its diagram + the record. */
export function buildProject(src: ExampleSource, opts: BuildOptions = {}): Project {
  return deterministically(() => {
    const spec = src.spec();
    const project = createBareProject(src.name);
    project.description = src.description;
    project.createdAt = EXAMPLE_TIMESTAMP;
    project.updatedAt = EXAMPLE_TIMESTAMP;
    const er: ErModel = spec.er;
    const erDiagram = withDiagram(project, er, 'chen', { name: 'ER diagram' });
    let options = spec.options;
    if (spec.renames?.length) {
      const probe = convertErToRelational(project, er.id, options, { now: nowIso() });
      const columnNames: Record<string, string> = { ...options?.columnNames };
      for (const [relName, colName, to] of spec.renames) {
        const rel = Object.values(probe.relationalModel.relations).find((r) => r.name === relName);
        const col = rel?.columns.find((c) => c.name === colName);
        if (!col?.origin?.key) throw new Error(`examples: cannot rename ${relName}.${colName}`);
        columnNames[col.origin.key] = to;
      }
      options = { ...options, columnNames };
    }
    const result = convertErToRelational(project, er.id, options, { now: nowIso() });
    const report = applyConversionResult(project, result);
    const relDiagram = project.diagrams[report.diagramId!]!;
    relDiagram.name = 'Relational schema';
    if (src.relationalOptions) Object.assign(relDiagram.options.relational!, src.relationalOptions);
    if (opts.frozen !== false) {
      // Unplaced nodes keep their provisional position; the examples tests assert that none exist.
      applyFrozenPositions(er, erDiagram, src.layout.er);
      applyFrozenPositions(project.models[result.relationalModel.id]!, relDiagram, src.layout.rel);
    }
    src.tweak?.(project, relDiagram.id);
    return project;
  });
}
