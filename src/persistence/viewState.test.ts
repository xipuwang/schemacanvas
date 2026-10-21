// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadViewState, saveViewState } from './viewState';

beforeEach(() => localStorage.clear());

describe('per-project view state', () => {
  it('round-trips the active sheet and dock per project id, merging patches', () => {
    saveViewState('p1', { activeDiagramId: 'd2' });
    saveViewState('p1', { dock: 'sql' });
    saveViewState('p2', { activeDiagramId: 'x' });
    expect(loadViewState('p1')).toEqual({ activeDiagramId: 'd2', dock: 'sql' });
    expect(loadViewState('p2')).toEqual({ activeDiagramId: 'x' });
    expect(loadViewState('nope')).toBeUndefined();
  });
  it('tolerates garbage in storage', () => {
    localStorage.setItem('schemacanvas:viewstate:v1', '[1,2');
    expect(loadViewState('p1')).toBeUndefined();
    saveViewState('p1', { dock: null });
    expect(loadViewState('p1')).toEqual({ dock: null });
  });
});
