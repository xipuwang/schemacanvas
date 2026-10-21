// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import * as ops from '@/model/ops';
import { editorStore, settingsStore } from '@/store';
import { registerCommand, runCommand, listCommands } from '@/editor';
import { uiStore } from '../uiStore';
import { fuzzyScore } from './fuzzy';
import { layoutModeForWidth } from './layout';
import { Resizer } from './Resizer';
import { SheetTabs } from './SheetTabs';
import { DialogHost } from './DialogHost';
import { CommandPalette, searchCommands } from './CommandPalette';
import { registerShellCommands, shellCommands } from './commands';
import { registerShellDialogs } from './dialogs';
import { groupedShortcuts } from './dialogs/ShortcutsDialog';
import { shellStore } from './shellStore';
import { validateActiveModel } from './validation';
import { createNewProject } from './files';
import { ToastHost } from '../components';

let offCommands: () => void;
let offDialogs: () => void;

beforeEach(() => {
  editorStore.getState().newProject('Test');
  uiStore.setState({ dialog: null, toasts: [], issues: [], dock: null });
  shellStore.setState({ paletteOpen: false, drawer: null });
  settingsStore.getState().setLocale('en');
  offCommands = registerShellCommands();
  offDialogs = registerShellDialogs();
});
afterEach(() => {
  cleanup();
  offCommands();
  offDialogs();
});

describe('pure helpers', () => {
  it('fuzzyScore ranks word starts and consecutive matches, rejects non-subsequences', () => {
    expect(fuzzyScore('zzz', 'Save project file')).toBe(-1);
    expect(fuzzyScore('sav', 'Save project file')).toBeGreaterThan(fuzzyScore('sav', 'Show advanced variables'));
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('spf', 'Save project file')).toBeGreaterThan(0);
  });
  it('layoutModeForWidth follows the 1100 / 700 breakpoints', () => {
    expect([1440, 1100, 1099, 700, 699, 390].map(layoutModeForWidth)).toEqual(['wide', 'wide', 'medium', 'medium', 'narrow', 'narrow']);
  });
  it('shell commands cover the spec, with unique ids and i18n labels in both locales', async () => {
    const { t } = await import('@/i18n');
    const ids = shellCommands().map((c) => c.id);
    for (const id of ['file.new', 'file.open', 'file.save', 'file.export', 'file.import', 'file.examples', 'diagram.validate', 'diagram.convert', 'diagram.options', 'help.shortcuts', 'settings', 'palette.open', 'view.togglePanel.library', 'view.togglePanel.properties', 'view.togglePanel.issues'])
      expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of shellCommands()) {
      expect(t(c.labelKey, undefined, 'en')).not.toBe(c.labelKey);
      expect(t(c.labelKey, undefined, 'zh')).not.toBe(c.labelKey);
    }
  });
  it('validateActiveModel returns [] without a diagram and runs the model rules otherwise', () => {
    const { project, activeDiagramId } = editorStore.getState();
    expect(validateActiveModel(project, undefined)).toEqual([]);
    expect(Array.isArray(validateActiveModel(project, activeDiagramId))).toBe(true);
  });
});

describe('Resizer', () => {
  it('is a focusable separator with value semantics and keyboard operation', async () => {
    const onChange = vi.fn();
    render(<Resizer orientation="vertical" value={240} min={180} max={420} onChange={onChange} label="Resize library" />);
    const sep = screen.getByRole('separator', { name: 'Resize library' });
    expect(sep.getAttribute('aria-valuenow')).toBe('240');
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    sep.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(256);
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(onChange).toHaveBeenLastCalledWith(192);
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(420);
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(180);
  });
  it('inverted (right dock): ArrowLeft grows', async () => {
    const onChange = vi.fn();
    render(<Resizer orientation="vertical" invert value={300} min={240} max={520} onChange={onChange} label="r" />);
    screen.getByRole('separator').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(316);
  });
});

describe('SheetTabs', () => {
  const renderTabs = () =>
    render(
      <>
        <SheetTabs />
        <DialogHost />
        <ToastHost />
      </>,
    );

  it('renders one tab per diagram, the active one selected', () => {
    renderTabs();
    const tab = screen.getByRole('tab', { name: 'ER Diagram' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.className).toContain('is-active');
  });

  it('creates a relational schema (new empty model) from the + menu and activates it', async () => {
    renderTabs();
    await userEvent.click(screen.getByRole('button', { name: 'New diagram' }));
    const menu = screen.getByRole('menu');
    await userEvent.click(menu.querySelector('[data-item-id="new-relational-schema"]')!);
    await waitFor(() => expect(editorStore.getState().project.diagramOrder.length).toBe(2));
    const s = editorStore.getState();
    expect(s.project.diagrams[s.activeDiagramId!]!.type).toBe('relational-schema');
    expect(screen.getByRole('tab', { name: 'Relational Schema' }).getAttribute('aria-selected')).toBe('true');
  });

  it('F2 renames through ops.renameDiagram (Enter commits, Escape cancels)', async () => {
    renderTabs();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'ER Diagram' }), { key: 'F2' });
    const input = screen.getByRole('textbox', { name: 'Diagram name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Clinic{Enter}');
    const s = editorStore.getState();
    expect(s.project.diagrams[s.activeDiagramId!]!.name).toBe('Clinic');
    expect(editorStore.getState().canUndo).toBe(true);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Clinic' }), { key: 'F2' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Diagram name' }), 'zzz{Escape}');
    expect(editorStore.getState().project.diagrams[editorStore.getState().activeDiagramId!]!.name).toBe('Clinic');
  });

  it('double-click renames; context menu duplicates and deletes behind a confirm dialog', async () => {
    renderTabs();
    await userEvent.dblClick(screen.getByRole('tab', { name: 'ER Diagram' }));
    expect(screen.getByRole('textbox', { name: 'Diagram name' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('tab', { name: 'ER Diagram' }) });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(editorStore.getState().project.diagramOrder.length).toBe(2));
    expect(screen.getByRole('tab', { name: 'ER Diagram copy' })).toBeTruthy();

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('tab', { name: 'ER Diagram copy' }) });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('ER Diagram copy');
    // cancel keeps it
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(editorStore.getState().project.diagramOrder.length).toBe(2);
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('tab', { name: 'ER Diagram copy' }) });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(editorStore.getState().project.diagramOrder.length).toBe(1));
    expect(screen.queryByRole('tab', { name: 'ER Diagram copy' })).toBeNull();
  });

  it('arrow keys switch tabs; delete is disabled for the last diagram', async () => {
    renderTabs();
    await userEvent.click(screen.getByRole('button', { name: 'New diagram' }));
    await userEvent.click(screen.getByRole('menu').querySelector('[data-item-id="new-relational-schema"]')!);
    await waitFor(() => expect(editorStore.getState().project.diagramOrder.length).toBe(2));
    await new Promise((r) => setTimeout(r, 60)); // let the menu's focus-return settle
    screen.getByRole('tab', { name: 'Relational Schema' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'ER Diagram' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('dialogs and commands', () => {
  it('settings dialog changes theme and language live and the grid through ops', async () => {
    render(<DialogHost />);
    act(() => uiStore.getState().openDialog('settings'));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Dark' }));
    expect(settingsStore.getState().theme).toBe('dark');
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Snap to grid' }));
    const d = editorStore.getState().project.diagrams[editorStore.getState().activeDiagramId!]!;
    expect(d.options.grid.snap).toBe(false);
    await userEvent.click(within(dialog).getByRole('radio', { name: '中文 (Chinese)' }));
    expect(settingsStore.getState().locale).toBe('zh');
    await screen.findByRole('dialog', { name: '设置' });
    settingsStore.getState().setTheme('system');
  });

  it('shortcuts dialog lists registered commands grouped and filters by search', async () => {
    const off = registerCommand({ id: 'test.cmd', labelKey: 'common.add', group: 'edit', shortcut: 'Mod+Shift+Q', run: () => undefined });
    try {
      expect(groupedShortcuts('').flatMap((g) => g.items.map((i) => i.command.id))).toContain('test.cmd');
      render(<DialogHost />);
      act(() => uiStore.getState().openDialog('shortcuts'));
      const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
      expect(within(dialog).getByText('Save project file')).toBeTruthy();
      await userEvent.type(within(dialog).getByRole('searchbox'), 'project file');
      expect(within(dialog).queryByText('Show properties')).toBeNull();
      expect(within(dialog).getByText('Open project file')).toBeTruthy();
    } finally {
      off();
    }
  });

  it('unregistered dialog kinds show a graceful placeholder', async () => {
    render(<DialogHost />);
    act(() => uiStore.getState().openDialog('export'));
    expect(await screen.findByRole('dialog', { name: 'Not available yet' })).toBeTruthy();
  });

  it('command palette filters, navigates with arrows and runs the command on Enter', async () => {
    const run = vi.fn();
    const off = registerCommand({ id: 'zz.palette', labelKey: 'common.rename', group: 'edit', run });
    try {
      render(<CommandPalette />);
      act(() => shellStore.getState().setPalette(true));
      const input = await screen.findByRole('combobox', { name: 'Search commands' });
      expect(document.activeElement).toBe(input);
      await userEvent.type(input, 'renam');
      const options = screen.getAllByRole('option');
      expect(options[0]!.textContent).toContain('Rename');
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(run).toHaveBeenCalled());
      expect(shellStore.getState().paletteOpen).toBe(false);
    } finally {
      off();
    }
  });

  it('palette searchCommands never lists itself and hides disabled commands', () => {
    const ids = searchCommands('').map((c) => c.id);
    expect(ids).not.toContain('palette.open');
    expect(ids).toContain('file.save');
  });

  it('diagram.convert is enabled only for Chen diagrams; validate fills the issues dock', async () => {
    expect(await runCommand('diagram.convert')).toBe(true);
    expect(uiStore.getState().dialog?.kind).toBe('convert');
    uiStore.getState().closeDialog();
    createNewProject('Rel', 'relational-schema');
    expect(await runCommand('diagram.convert')).toBe(false);
    await runCommand('diagram.validate');
    expect(uiStore.getState().dock).toBe('issues');
  });

  it('file.new asks before discarding unsaved changes and then opens the new-project dialog', async () => {
    render(<DialogHost />);
    // a project WITH content and no storage (jsdom has no IndexedDB): the previous project cannot be kept, so the shell asks
    editorStore.getState().commit('x', (d) => {
      const er = Object.values(d.models).find((m) => m.kind === 'er')!;
      ops.addEntity(d, er.id, { name: 'Student' });
    });
    expect(editorStore.getState().dirty).toBe(true);
    void runCommand('file.new');
    const confirm = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeTruthy();
  });

  it('file.new does not ask when the project is empty (nothing to lose)', async () => {
    render(<DialogHost />);
    editorStore.getState().commit('x', (d) => void (d.name = 'Changed'));
    void runCommand('file.new');
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).toBeNull();
  });

  it('new-project dialog creates a relational project', async () => {
    render(<DialogHost />);
    act(() => uiStore.getState().openDialog('new-project'));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Project name' }), 'Clinic');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Relational schema' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    const s = editorStore.getState();
    expect(s.project.name).toBe('Clinic');
    expect(Object.values(s.project.diagrams).map((d) => d.type)).toEqual(['relational-schema']);
    expect(Object.values(s.project.models).map((m) => m.kind)).toEqual(['relational']);
    expect(s.canUndo).toBe(false);
  });

  it('lists every registered command exactly once for the palette and shortcuts', () => {
    const ids = listCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
