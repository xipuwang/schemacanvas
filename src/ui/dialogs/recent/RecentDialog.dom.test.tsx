// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { clear, closeDb, saveSnapshot, idbKv } from '@/persistence';
import { sampleProject } from '@/model/io/testFixtures';
import { editorStore, settingsStore } from '@/store';
import { ToastHost } from '../../components';
import { uiStore } from '../../uiStore';
import { DialogHost } from '../../shell/DialogHost';
import { registerShellDialogs } from '../../shell/dialogs';
import { countProject } from './recentModel';

let off: () => void;
beforeEach(async () => {
  await closeDb();
  await clear();
  settingsStore.getState().setLocale('en');
  editorStore.getState().newProject('Current');
  uiStore.setState({ dialog: null, toasts: [] });
  off = registerShellDialogs();
});
afterEach(() => {
  cleanup();
  off();
});

describe('countProject', () => {
  it('counts entities, tables and diagrams across models', () => {
    expect(countProject(sampleProject())).toEqual({ entities: 2, tables: 4, diagrams: 2 });
  });
});

describe('RecentDialog', () => {
  it('shows the empty state when nothing is stored', async () => {
    render(<DialogHost />);
    uiStore.getState().openDialog('recent');
    expect(await screen.findByText('No recent projects yet', {}, { timeout: 10_000 })).toBeTruthy();
  });

  it('lists stored projects with counts, marks the open one and opens another through the replace helper', async () => {
    await saveSnapshot(sampleProject('Stored pharmacy'));
    editorStore.getState().loadProject(sampleProject('Open now project')); // same fixture ids: separate project ids
    render(<DialogHost />);
    render(<ToastHost />);
    uiStore.getState().openDialog('recent');
    // the dialog loads lazily: the loading frame has the same title, so wait for the real content instead of holding the frame
    await screen.findByRole('dialog', { name: 'Recent projects' });
    const row = await screen.findByTestId('recent-row', {}, { timeout: 10_000 });
    expect(within(row).getByText('Stored pharmacy')).toBeTruthy();
    await waitFor(() => expect(row.textContent).toContain('2 entities'));
    expect(row.textContent).toContain('4 tables');
    await userEvent.click(within(row).getByRole('button', { name: 'Open Stored pharmacy' }));
    await waitFor(() => expect(editorStore.getState().project.name).toBe('Stored pharmacy'));
    expect(uiStore.getState().dialog).toBeNull();
  });

  it('a corrupt record raises a typed error toast and keeps the project', async () => {
    const now = new Date().toISOString();
    await idbKv.setMany([
      ['project:bad', 'not json'],
      ['meta:bad', { id: 'bad', name: 'Broken', updatedAt: now, savedAt: now }],
    ]);
    render(<DialogHost />);
    render(<ToastHost />);
    uiStore.getState().openDialog('recent');
    const row = await screen.findByTestId('recent-row');
    await waitFor(() => expect(row.textContent).toContain('could not be read'));
    await userEvent.click(within(row).getByRole('button', { name: 'Open Broken' }));
    await waitFor(() => expect(uiStore.getState().toasts.some((t) => t.kind === 'error' && t.message.startsWith('Could not open Broken.'))).toBe(true));
    expect(editorStore.getState().project.name).toBe('Current');
  });

  it('delete asks for confirmation and removes the entry', async () => {
    await saveSnapshot(sampleProject('Doomed'));
    render(<DialogHost />);
    uiStore.getState().openDialog('recent');
    const row = await screen.findByTestId('recent-row');
    await userEvent.click(within(row).getByRole('button', { name: 'Delete Doomed from recent projects' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete "Doomed"?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No recent projects yet')).toBeTruthy();
  });
});
