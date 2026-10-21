// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Component } from 'react';
import '@/i18n';
import { AUTOSAVE_KEY, JOURNAL_KEY, clear, closeDb, idbKv, loadAutosave, loadAutosaveOrJournal, saveViewState, startAutosave, writeJournal } from '@/persistence';
import { sampleProject } from '@/model/io/testFixtures';
import { editorStore, settingsStore } from '@/store';
import { setLocaleLoaded } from '@/i18n';
import { ErrorBoundary } from '../ErrorBoundary';
import { uiStore } from '../uiStore';
import { resumePersistenceForTests } from '@/persistence/suspend';
import { clearLocalData } from './dialogs/SettingsDialog';
import { openProjectFile } from './files';
import { registerShellDialogs } from './dialogs';
import { DialogHost } from './DialogHost';
import userEvent from '@testing-library/user-event';

let offDialogs: () => void;
beforeEach(async () => {
  localStorage.clear();
  resumePersistenceForTests(); // the ErrorBoundary tests suspend persistence for the page session
  await closeDb();
  await clear();
  settingsStore.getState().setLocale('en');
  editorStore.getState().loadProject(sampleProject('Secret'));
  uiStore.setState({ dialog: null, toasts: [] });
  offDialogs = registerShellDialogs();
});
afterEach(() => {
  cleanup();
  offDialogs();
  vi.restoreAllMocks();
});

describe('PRIV-2 clear local data', () => {
  it('removes IndexedDB, journal and viewstate, and a pending autosave cannot bring the project back', async () => {
    render(<DialogHost />);
    const stop = startAutosave(editorStore, { delayMs: 20 });
    localStorage.setItem('schemacanvas:settings:keep', 'x');
    editorStore.getState().commit('r', (d) => void (d.name = 'Secret2')); // autosave timer now pending
    writeJournal(editorStore.getState().project);
    saveViewState(editorStore.getState().project.id, { dock: 'sql' });
    expect(localStorage.getItem(JOURNAL_KEY)).not.toBeNull();

    const done = clearLocalData();
    await userEvent.click(await screen.findByRole('button', { name: 'Clear data' }));
    expect(await done).toBe(true);
    await new Promise((r) => setTimeout(r, 80)); // let any stray timer fire
    window.dispatchEvent(new Event('pagehide'));

    expect(localStorage.getItem(JOURNAL_KEY)).toBeNull();
    expect(localStorage.getItem('schemacanvas:viewstate:v1')).toBeNull();
    expect(localStorage.getItem('schemacanvas:settings:keep')).toBe('x');
    expect(await idbKv.get(AUTOSAVE_KEY)).toBeUndefined();
    expect(await loadAutosave()).toBeNull();
    expect(await loadAutosaveOrJournal()).toBeNull();
    expect(editorStore.getState().project.name).not.toMatch(/Secret/);
    stop();
  });
});

describe('PRIV-2b clear local data failure', () => {
  it('shows an error toast and does not claim success when IndexedDB clear fails', async () => {
    render(<DialogHost />);
    vi.spyOn(idbKv, 'clear').mockRejectedValue(new Error('blocked'));
    const done = clearLocalData();
    await userEvent.click(await screen.findByRole('button', { name: 'Clear data' }));
    expect(await done).toBe(false);
    const toasts = uiStore.getState().toasts;
    expect(toasts.some((x) => x.kind === 'error' && x.message.includes('Could not clear'))).toBe(true);
    expect(toasts.some((x) => x.kind === 'success')).toBe(false);
  });
});

describe('PRIV-3 ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('kaboom');
  }
  it('shows the fallback with a reload button instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByRole('alert').textContent).toContain('autosave');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
  it('falls back to static text when i18n itself throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const i18n = await import('@/i18n');
    vi.spyOn(i18n, 'currentLocale').mockImplementation(() => {
      throw new Error('i18n broken');
    });
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
  it('renders children when nothing throws and zh fallback is Chinese', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setLocaleLoaded('zh');
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('出错了');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy();
    await setLocaleLoaded('en');
    class Fine extends Component { override render() { return <p>fine</p>; } }
    cleanup();
    render(<ErrorBoundary><Fine /></ErrorBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });
});

describe('i18n-a11y-02 localized open error', () => {
  it('toast for a bad file uses the Chinese sentence, not the raw English message', async () => {
    await setLocaleLoaded('zh');
    settingsStore.getState().setLocale('zh');
    await openProjectFile(new File(['not json'], 'bad.json'));
    const msg = uiStore.getState().toasts.at(-1)?.message ?? '';
    expect(msg).toContain('不是有效的 JSON');
    expect(msg).not.toMatch(/valid JSON/i);
    await setLocaleLoaded('en');
    settingsStore.getState().setLocale('en');
  });
});
