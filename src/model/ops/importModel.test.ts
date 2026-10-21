import { describe, expect, it } from 'vitest';
import { relationalBuilder, erBuilder } from '../builders';
import { createBareProject } from '../defaults';
import { checkInvariants } from '../invariants';
import { addModel } from './importModel';
import { OpError } from './common';
import { run } from './testUtils';

describe('addModel', () => {
  it('adds a relational model with a complete diagram (nodes + FK edges) and honours positions', () => {
    const rb = relationalBuilder('Imported');
    const a = rb.relation('A', ['id'], { pk: ['id'] });
    const b = rb.relation('B', ['id', 'aid'], { pk: ['id'] });
    rb.fk(b, ['aid'], a, ['id']);
    const model = rb.build();
    const { project, result } = run(createBareProject(), (d) => addModel(d, model, { positions: { [a.id]: { x: 100, y: 200 } } }));
    expect(checkInvariants(project)).toEqual([]);
    const d = project.diagrams[result.diagramIds[0]!]!;
    expect(d.type).toBe('relational-schema');
    expect(Object.keys(d.nodes)).toHaveLength(2);
    expect(Object.keys(d.edges)).toHaveLength(1);
    const nodeA = Object.values(d.nodes).find((n) => n.ref.id === a.id)!;
    expect([nodeA.x, nodeA.y]).toEqual([100, 200]);
    expect(project.diagramOrder).toEqual(result.diagramIds);
  });

  it('can create several diagram types for one model, refuses a wrong-kind type and id collisions', () => {
    const er = erBuilder('E');
    er.entity('X').key('k');
    const { project, result } = run(createBareProject(), (d) => addModel(d, er.build()));
    expect(project.diagrams[result.diagramIds[0]!]!.type).toBe('chen');
    expect(() => run(createBareProject(), (d) => addModel(d, er.build(), { diagramTypes: ['crows-foot'] }))).toThrow(OpError);
    // adding the SAME model twice collides on ids
    expect(() => run(project, (d) => addModel(d, er.build()))).toThrow(/already in use/);
  });
});
