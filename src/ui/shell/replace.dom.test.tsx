// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { closeDb, clear, listRecent, loadRecent } from '@/persistence';
import { sampleProject } from '@/model/io/testFixtures';
import { createProject } from '@/model/defaults';
import { editorStore, settingsStore } from '@/store';
import { ToastHost } from '../components';
import { uiStore } from '../uiStore';
import { DialogHost } from './DialogHost';
import { registerShellDialogs } from './dialogs';
import { projectHasContent, replaceProject } from './replace';

let offDialogs: () => void;
beforeEach(async () => {
  await closeDb();
  await clear();
  settingsStore.getState().setLocale('en');
  editorStore.getState().newProject('Start');
  uiStore.setState({ dialog: null, toasts: [] });
  offDialogs = registerShellDialogs();
});
afterEach(() => {
  cleanup();
  offDialogs();
  (globalThis as { indexedDB?: unknown }).indexedDB = (globalThis as { __idb?: unknown }).__idb ?? (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('projectHasContent', () => {
  it('is false for a fresh project and true once anything is modelled', () => {
    expect(projectHasContent(createProject('x'))).toBe(false);
    expect(projectHasContent(sampleProject())).toBe(true);
  });
});

describe('replaceProject', () => {
  it('replaces an empty project silently: no toast, nothing kept', async () => {
    const next = sampleProject('Next');
    const res = await replaceProject(next, { label: 'Next' });
    expect(res).toEqual({ replaced: true, keptPrevious: false });
    expect(editorStore.getState().project.name).toBe('Next');
    expect(uiStore.getState().toasts).toEqual([]);
    expect(await listRecent()).toEqual([]);
  });

  it('keeps a non-empty project as a recent entry and offers Reopen previous, which restores it exactly', async () => {
    const first = sampleProject('First');
    editorStore.getState().loadProject(first);
    const activeBefore = Object.keys(first.diagrams)[1]!;
    editorStore.getState().setActiveDiagram(activeBefore);

    const res = await replaceProject(sampleProject('Second'), { label: 'Second', activeDiagramId: undefined });
    expect(res).toEqual({ replaced: true, keptPrevious: true });
    expect(editorStore.getState().project.name).toBe('Second');

    const recent = await listRecent();
    expect(recent.map((r) => r.name)).toContain('First');
    const stored = await loadRecent(first.id);
    expect(stored?.ok && stored.project.name).toBe('First');

    const toast = uiStore.getState().toasts.at(-1)!;
    expect(toast.message).toBe('Opened Second. Your previous project is in Recent projects.');
    expect(toast.action?.label).toBe('Reopen previous');

    render(<ToastHost />);
    await userEvent.click(screen.getByRole('button', { name: 'Reopen previous' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const now = editorStore.getState();
    expect(now.project).toEqual(first);
    expect(now.activeDiagramId).toBe(activeBefore);
    expect(now.canUndo).toBe(false);
  });

  it('never lets a replacement with the same project id overwrite the kept copy', async () => {
    const first = sampleProject('Same');
    editorStore.getState().loadProject(first);
    const reloaded = { ...sampleProject('Same again'), id: first.id };
    await replaceProject(reloaded, { label: 'Same again' });
    expect(editorStore.getState().project.id).not.toBe(first.id);
    const stored = await loadRecent(first.id);
    expect(stored?.ok && stored.project.name).toBe('Same');
  });

  it('with unavailable storage and unsaved changes it asks first; cancelling keeps the project', async () => {
    editorStore.getState().loadProject(sampleProject('Precious'));
    editorStore.getState().commit('edit', (d) => void (d.name = 'Precious edited'));
    await closeDb();
    const g = globalThis as { indexedDB?: unknown; __idb?: unknown };
    g.__idb = g.indexedDB;
    g.indexedDB = undefined;
    render(<DialogHost />);
    const pending = replaceProject(sampleProject('Other'), { label: 'Other' });
    const confirm = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(await pending).toEqual({ replaced: false, keptPrevious: false });
    expect(editorStore.getState().project.name).toBe('Precious edited');

    const pending2 = replaceProject(sampleProject('Other'), { label: 'Other' });
    const confirm2 = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await userEvent.click(within(confirm2).getByRole('button', { name: 'Discard changes' }));
    // discarded for real: no "previous project is in Recent" claim
    expect(await pending2).toEqual({ replaced: true, keptPrevious: false });
    expect(uiStore.getState().toasts).toEqual([]);
    expect(editorStore.getState().project.name).toBe('Other');
  });
});
