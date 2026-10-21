// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import '@/editor/commands';
import { viewportInfoStore } from '@/editor';
import * as ops from '@/model/ops';
import { editorStore, settingsStore } from '@/store';
import { uiStore } from '../uiStore';
import { DialogHost } from './DialogHost';
import { ProjectName, Toolbar, fileMenuEntries } from './Toolbar';
import { SheetTabs } from './SheetTabs';
import { StatusBar } from './StatusBar';
import { Welcome } from './Welcome';
import { registerShellCommands } from './commands';
import { registerShellDialogs } from './dialogs';
import { shellStore, WELCOME_STORAGE_KEY } from './shellStore';

let offCommands: () => void;
let offDialogs: () => void;
beforeEach(() => {
  editorStore.getState().newProject('Test');
  uiStore.setState({ dialog: null, toasts: [], issues: [], dock: null });
  shellStore.setState({ welcomeHidden: false, welcomeDismissed: false });
  settingsStore.getState().setLocale('en');
  offCommands = registerShellCommands();
  offDialogs = registerShellDialogs();
});
afterEach(() => {
  cleanup();
  offCommands();
  offDialogs();
  try {
    localStorage.removeItem(WELCOME_STORAGE_KEY);
  } catch {
    /* none */
  }
});

function withThreeSheets(): string[] {
  const store = editorStore.getState();
  store.commit('add', (d) => {
    ops.createDiagram(d, { type: 'relational-schema' });
    ops.createDiagram(d, { type: 'crows-foot' });
  });
  return [...editorStore.getState().project.diagramOrder];
}

describe('File menu entries', () => {
  it('lists the eight entries in order with shortcuts where defined', () => {
    const entries = fileMenuEntries().filter((e) => !('type' in e && e.type === 'separator'));
    expect(entries.map((e) => ('label' in e ? e.label : ''))).toEqual(['New project', 'Open file…', 'Open example…', 'Recent projects…', 'Save', 'Import SQL or DBML…', 'Export…', 'SQL and DBML view']);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId['file.save']).toMatchObject({ shortcut: 'Mod+S' });
    expect(byId['file.open']).toMatchObject({ shortcut: 'Mod+O' });
    expect(byId['file.export']).toMatchObject({ shortcut: 'Mod+Shift+E' });
    expect(byId['file.recent']).toMatchObject({ disabled: false });
  });

  it('the toolbar File menu opens the Recent projects dialog', async () => {
    render(
      <>
        <Toolbar />
        <DialogHost />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^File$/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Recent projects/ }));
    expect(uiStore.getState().dialog?.kind).toBe('recent');
  });
});

describe('sheet tab reorder', () => {
  it('Alt+ArrowRight / Alt+ArrowLeft move the focused tab in one undo step each; plain arrows only move focus', async () => {
    const order = withThreeSheets();
    render(<SheetTabs />);
    const tabs = screen.getAllByRole('tab');
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight', altKey: true });
    expect(editorStore.getState().project.diagramOrder).toEqual([order[1], order[0], order[2]]);
    expect(editorStore.getState().canUndo).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('position 2 of 3');
    fireEvent.keyDown(screen.getAllByRole('tab')[1]!, { key: 'ArrowLeft', altKey: true });
    expect(editorStore.getState().project.diagramOrder).toEqual(order);
    fireEvent.keyDown(screen.getAllByRole('tab')[0]!, { key: 'ArrowLeft', altKey: true }); // already first
    expect(editorStore.getState().project.diagramOrder).toEqual(order);
    fireEvent.keyDown(screen.getAllByRole('tab')[0]!, { key: 'ArrowRight' });
    expect(editorStore.getState().project.diagramOrder).toEqual(order);
    editorStore.getState().undo();
    editorStore.getState().undo();
    expect(editorStore.getState().project.diagramOrder).toEqual(order);
  });
});

describe('project name', () => {
  it('renames through ops.renameProject (Enter commits, Escape cancels, blank is ignored) as one undo step', async () => {
    render(<ProjectName />);
    await userEvent.click(screen.getByRole('button', { name: /Rename project/ }));
    let field = screen.getByRole('textbox', { name: 'Project name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Clinic{Enter}');
    expect(editorStore.getState().project.name).toBe('Clinic');
    await userEvent.click(screen.getByRole('button', { name: /Rename project/ }));
    field = screen.getByRole('textbox', { name: 'Project name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Nope{Escape}');
    expect(editorStore.getState().project.name).toBe('Clinic');
    await userEvent.click(screen.getByRole('button', { name: /Rename project/ }));
    field = screen.getByRole('textbox', { name: 'Project name' });
    await userEvent.clear(field);
    await userEvent.type(field, '   {Enter}');
    expect(editorStore.getState().project.name).toBe('Clinic');
    editorStore.getState().undo();
    expect(editorStore.getState().project.name).toBe('Test');
  });
});

describe('status bar zoom', () => {
  it('shows the live canvas zoom of the active diagram, not the stored viewport', () => {
    const id = editorStore.getState().activeDiagramId!;
    render(<StatusBar />);
    expect(screen.getByTestId('status-zoom').textContent).toContain('100%');
    act(() => viewportInfoStore.setState({ diagramId: id, zoom: 0.5 }));
    expect(screen.getByTestId('status-zoom').textContent).toContain('50%');
    act(() => viewportInfoStore.setState({ diagramId: 'other', zoom: 0.25 })); // another sheet's value is ignored
    expect(screen.getByTestId('status-zoom').textContent).toContain('100%');
  });
});

describe('Welcome', () => {
  it('offers example / entity / import and remembers "Don\'t show again" in localStorage', async () => {
    const id = editorStore.getState().activeDiagramId!;
    const { container } = render(<Welcome canvas={{ current: null }} diagramId={id} />);
    const group = within(screen.getByRole('group', { name: 'Get started' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual(['Open an example', 'Add an entity', 'Import SQL', "Don't show again", '']);
    await userEvent.click(group.getByRole('button', { name: 'Import SQL' }));
    await userEvent.click(group.getByRole('button', { name: "Don't show again" }));
    expect(container.querySelector('[data-testid="welcome"]')).toBeNull();
    expect(localStorage.getItem(WELCOME_STORAGE_KEY)).toBe('dismissed');
  });

  it('offers a table on relational sheets', () => {
    editorStore.getState().commit('x', (d) => void ops.createDiagram(d, { type: 'relational-schema' }));
    const rel = editorStore.getState().project.diagramOrder.at(-1)!;
    render(<Welcome canvas={{ current: null }} diagramId={rel} />);
    expect(screen.getByRole('button', { name: 'Add a table' })).toBeTruthy();
  });
});

describe('global shortcuts', () => {
  it('a shortcut bound to Enter never swallows the native activation of a focused button', async () => {
    const { registerCommand } = await import('@/editor');
    const { useGlobalShortcuts } = await import('./keyboard');
    let ran = 0;
    let clicked = 0;
    const off = registerCommand({ id: 'test.enter', labelKey: 'commands.file.new', group: 'tools', shortcut: 'Enter', run: () => void ran++ });
    function Probe() {
      useGlobalShortcuts();
      return (
        <>
          <button type="button" onClick={() => void clicked++}>
            Activate
          </button>
          <div tabIndex={0} data-testid="plain" />
        </>
      );
    }
    render(<Probe />);
    screen.getByRole('button', { name: 'Activate' }).focus();
    await userEvent.keyboard('{Enter}');
    expect({ clicked, ran }).toEqual({ clicked: 1, ran: 0 });
    screen.getByTestId('plain').focus();
    await userEvent.keyboard('{Enter}');
    expect(ran).toBe(1); // elsewhere the shortcut still works
    off();
  });
});
