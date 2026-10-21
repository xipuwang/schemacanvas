// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@/i18n';
import * as ops from '@/model/ops';
import { editorStore, settingsStore } from '@/store';
import { SheetTabs } from './SheetTabs';

beforeEach(() => {
  editorStore.getState().newProject('Test');
  settingsStore.getState().setLocale('en');
});
afterEach(() => {
  cleanup();
  settingsStore.getState().setLocale('en');
});

describe('default sheet names in the tab strip', () => {
  it('an untouched default follows the language; the stored name does not change; a renamed sheet stays as typed', () => {
    render(<SheetTabs />);
    const id = editorStore.getState().project.diagramOrder[0]!;
    expect(screen.getByRole('tab', { name: 'ER Diagram' })).toBeTruthy();
    act(() => settingsStore.getState().setLocale('zh'));
    expect(screen.getByRole('tab', { name: 'ER 图' })).toBeTruthy();
    expect(editorStore.getState().project.diagrams[id]!.name).toBe('ER Diagram');
    act(() => editorStore.getState().commit('rename', (d) => ops.renameDiagram(d, id, 'Pharmacy ER')));
    expect(screen.getByRole('tab', { name: 'Pharmacy ER' })).toBeTruthy();
    act(() => settingsStore.getState().setLocale('en'));
    expect(screen.getByRole('tab', { name: 'Pharmacy ER' })).toBeTruthy();
  });
});
