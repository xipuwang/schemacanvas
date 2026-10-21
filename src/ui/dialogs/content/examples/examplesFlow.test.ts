import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '@/examples';
import { createEditorStore } from '@/store';
import { diagramToActivate, filterExamples, openExample } from './examplesFlow';

describe('filterExamples', () => {
  const title = (e: { id: string }): string => e.id.replace(/-/g, ' ');
  it('matches words in the text, tags and level', () => {
    expect(filterExamples(EXAMPLES, '', title)).toHaveLength(EXAMPLES.length);
    expect(filterExamples(EXAMPLES, 'weak', title).map((e) => e.id)).toContain('weak-entity');
    expect(filterExamples(EXAMPLES, 'ADVANCED', title).map((e) => e.id)).toEqual(['pharmacy']);
    expect(filterExamples(EXAMPLES, 'recursive 1:n', title).map((e) => e.id)).toEqual(['recursive-1n']);
    expect(filterExamples(EXAMPLES, 'zzzz', title)).toEqual([]);
  });
});

describe('openExample', () => {
  it('replaces the project and activates the ER or the relational diagram', () => {
    const store = createEditorStore();
    const p = openExample('pharmacy', 'er', store);
    expect(store.getState().project).toBe(p);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().project.diagrams[store.getState().activeDiagramId!]!.type).toBe('chen');
    openExample('pharmacy', 'relational', store);
    expect(store.getState().project.diagrams[store.getState().activeDiagramId!]!.type).toBe('relational-schema');
    expect(diagramToActivate(p, 'relational')).toBe(p.diagramOrder[1]);
  });
});
