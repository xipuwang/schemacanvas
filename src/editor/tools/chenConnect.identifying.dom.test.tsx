// @vitest-environment jsdom
/** Connecting participants to an identifying relationship applies the identification defaults in ONE undoable step. */
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { validateProject } from '@/validation';
import type { ErModel, Id } from '@/model/types';
import { makeStore } from '../testFixtures';
import { connectParticipant } from './chenConnect';

function setup() {
  const { store, diagramId } = makeStore('chen');
  const st = store.getState();
  const model = st.project.models[st.project.diagrams[diagramId]!.modelId] as ErModel;
  const id = (n: string): Id => Object.values(model.entities).find((e) => e.name === n)!.id;
  const makes = Object.values(model.relationships).find((r) => r.name === 'Makes')!;
  // strip Makes down to an empty identifying relationship
  st.commit('strip', (d) => {
    (d.models[model.id] as ErModel).relationships[makes.id]!.participants = [];
  });
  st.clearHistory();
  const rel = (): ErModel['relationships'][string] => (store.getState().project.models[model.id] as ErModel).relationships[makes.id]!;
  return { store, diagramId, id, rel, modelId: model.id, relId: makes.id };
}

describe('connect tool: identifying relationship defaults', () => {
  it('owner then weak: weak is total, owner becomes one, no identifying issues, one undo step each', () => {
    const s = setup();
    const depth = () => s.store.getState().undoStack.length;
    expect(connectParticipant(s.store, s.diagramId, s.relId, s.id('Company')).ok).toBe(true);
    expect(s.rel().participants[0]).toMatchObject({ max: 'many', participation: 'partial' }); // no weak side yet: nothing to decide
    expect(connectParticipant(s.store, s.diagramId, s.relId, s.id('Drug')).ok).toBe(true);
    const [owner, weak] = s.rel().participants;
    expect(owner).toMatchObject({ max: 'one' });
    expect(weak).toMatchObject({ participation: 'total' });
    const ids = validateProject(s.store.getState().project).map((i) => i.code);
    expect(ids).not.toContain('er.identifying-partial');
    expect(ids).not.toContain('er.identifying-owner-many');
    expect(depth()).toBe(2);
    s.store.getState().undo();
    expect(s.rel().participants).toHaveLength(1);
  });

  it('weak then owner works too, and explicit values on existing participants survive', () => {
    const s = setup();
    connectParticipant(s.store, s.diagramId, s.relId, s.id('Drug'));
    // a lone weak participant could be the owner of a weak chain: nothing is guessed yet
    expect(s.rel().participants[0]).toMatchObject({ max: 'many', participation: 'partial' });
    connectParticipant(s.store, s.diagramId, s.relId, s.id('Company'));
    expect(s.rel().participants[0]).toMatchObject({ participation: 'total' });
    expect(s.rel().participants[1]).toMatchObject({ max: 'one' });
    // an explicitly customised owner (many + total) is not overridden when another weak side is added
    const s2 = setup();
    connectParticipant(s2.store, s2.diagramId, s2.relId, s2.id('Company'));
    s2.store.getState().commit('user', (d) => {
      const p = ((d.models[s2.modelId] as ErModel).relationships[s2.relId]!.participants[0]!);
      p.max = 'many';
      p.participation = 'total';
    });
    connectParticipant(s2.store, s2.diagramId, s2.relId, s2.id('Drug'));
    expect(s2.rel().participants[0]).toMatchObject({ max: 'many', participation: 'total' });
  });

  it('weak owner of a weak chain: with two weak participants and no flag, nothing is guessed', () => {
    const s = setup();
    // Company becomes weak too (owner of a weak chain), so both participants are weak and the identified side is ambiguous
    s.store.getState().commit('weak owner', (d) => {
      (d.models[s.modelId] as ErModel).entities[s.id('Company')]!.weak = true;
    });
    connectParticipant(s.store, s.diagramId, s.relId, s.id('Company'));
    connectParticipant(s.store, s.diagramId, s.relId, s.id('Drug'));
    for (const p of s.rel().participants) expect(p).toMatchObject({ max: 'many', participation: 'partial' });
  });
});
