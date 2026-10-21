/**
 * Large deterministic projects for the drag-performance measurements (unit regression test, Playwright spec, harness).
 * Nothing here is used by the app itself.
 */
import { convertErToRelational } from '@/conversion';
import { autoLayout } from '@/layout';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import type { ErModel, Id, Project } from '@/model/types';
import { buildScene } from '@/scene/registry';

export type BigKind = 'rel40' | 'rel87' | 'chen60';

export interface BigProject {
  project: Project;
  diagramId: Id;
}

/** 60 entities / ~150 attributes / 80 relationships (same recipe as src/integration/p6-scale). */
export function bigEr(): ErModel {
  let seed = 42;
  const rnd = (n: number): number => Math.floor(((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * n);
  const b = erBuilder('Big');
  const ents = [];
  for (let i = 0; i < 60; i++) {
    const weak = i % 15 === 14;
    const e = b.entity(`E${i}`, { weak });
    if (weak) e.partialKey(`pk${i}`);
    else e.key(`id${i}`);
    ents.push(e);
  }
  for (let k = 0; k < 90; k++) {
    const e = ents[k % 60]!;
    if (k % 9 === 0) e.multivalued(`mv${k}`);
    else if (k % 11 === 0) e.derived(`dv${k}`);
    else e.attr(`a${k}`, { dataType: 'VARCHAR(40)' });
  }
  for (let r = 0; r < 80; r++) {
    const i = rnd(60);
    let j = rnd(60);
    if (r % 20 === 0) j = i;
    else while (j === i) j = rnd(60);
    const card = (['1:N', 'M:N', '1:N', '1:1'] as const)[r % 4]!;
    if (r % 16 === 5) {
      let k2 = rnd(60);
      while (k2 === i || k2 === j) k2 = rnd(60);
      b.relationship(`R${r}`, [{ entity: ents[i]! }, { entity: ents[j]! }, { entity: ents[k2]! }]);
    } else if (r % 10 === 7) {
      const weakIdx = 14 + 15 * (((r - 7) / 10) % 4);
      let owner = rnd(60);
      while (owner === weakIdx || owner % 15 === 14) owner = rnd(60);
      b.relate(`Own${r}`, ents[owner]!, ents[weakIdx]!, '1:N', { identifying: true, rightTotal: true });
    } else {
      b.relate(`R${r}`, ents[i]!, ents[j]!, card);
    }
  }
  return b.build();
}

/** 40 tables, 60 foreign keys (10 composite), deterministic. */
export function rel40Model() {
  let seed = 7;
  const rnd = (n: number): number => Math.floor(((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * n);
  const b = relationalBuilder('Rel40');
  const tables = [];
  for (let i = 0; i < 40; i++) {
    const cols = [{ name: `Id${i}`, type: 'INT' }, { name: `Code${i}`, type: 'INT' }, { name: `Name${i}`, type: 'VARCHAR(40)' }, { name: `Note${i}`, type: 'TEXT' }];
    const refs = Array.from({ length: 3 }, (_, k) => ({ name: `Ref${k}`, type: 'INT' }));
    tables.push(b.relation(`T${i}`, [...cols, ...refs], { pk: i % 4 === 0 ? [`Id${i}`, `Code${i}`] : [`Id${i}`] }));
  }
  let made = 0;
  let guard = 0;
  const used = new Array<number>(40).fill(0);
  while (made < 60 && guard++ < 5000) {
    const s = 1 + rnd(39);
    const t = rnd(s);
    const composite = made % 6 === 5 && t % 4 === 0 && used[s] === 0;
    const need = composite ? 2 : 1;
    if (used[s]! + need > 3) continue;
    if (composite) b.fk(tables[s]!, ['Ref0', 'Ref1'], tables[t]!, [`Id${t}`, `Code${t}`]);
    else b.fk(tables[s]!, [`Ref${used[s]}`], tables[t]!, [`Id${t}`]);
    used[s] = used[s]! + need;
    made++;
  }
  return b.build();
}

export async function buildBigProject(kind: BigKind): Promise<BigProject> {
  const project = createBareProject(kind);
  if (kind === 'rel40') {
    const d = withDiagram(project, rel40Model(), 'relational-schema', { name: kind });
    const pos = await autoLayout(buildScene(project, d.id), project, d.id);
    ops.setNodePositions(project as never, d.id, pos);
    return { project, diagramId: d.id };
  }
  const er = bigEr();
  const chen = withDiagram(project, er, 'chen', { name: 'chen60' });
  const chenPos = await autoLayout(buildScene(project, chen.id), project, chen.id);
  ops.setNodePositions(project as never, chen.id, chenPos);
  if (kind === 'chen60') return { project, diagramId: chen.id };
  const result = convertErToRelational(project, er.id);
  const temp: Project = { ...project, models: { ...project.models, [result.relationalModel.id]: result.relationalModel }, diagrams: { ...project.diagrams, [result.diagram.id]: result.diagram } };
  const pos = await autoLayout(buildScene(temp, result.diagram.id), temp, result.diagram.id);
  ops.applyConversionResult(project as never, result, { positions: pos });
  const relId = Object.values(project.diagrams).find((d) => d.type === 'relational-schema')!.id;
  return { project, diagramId: relId };
}
