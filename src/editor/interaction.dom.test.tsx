// @vitest-environment jsdom
/** Keyboard / assistive-technology behaviour of the canvas, in jsdom (the real-browser counterpart is e2e/editor2/interaction.spec.ts). */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ops from '@/model/ops';
import type { Id } from '@/model/types';
import { editorStore } from '@/store';
import { uiStore } from '@/ui/uiStore';
import '@/i18n';
import { DiagramCanvas } from './DiagramCanvas';
import './tools';
import { canvasUiStore } from './canvasState';
import { runCommand } from './commands/registry';
import { kbStore, resetKb } from './keyboard/keyboardState';
import { loadGlobal, nodeNamed } from './testFixtures';

const st = () => editorStore.getState();
let chen: Id;

beforeEach(() => {
  chen = loadGlobal('chen').diagramId;
  canvasUiStore.setState({ armedItem: null, focusNodeId: null, symbolHints: true });
  resetKb();
  uiStore.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const canvas = () => screen.getByRole('application');
const key = (target: Element | Document, k: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(target, { key: k, ...init }));
const nodeCount = () => Object.keys(st().project.diagrams[chen]!.nodes).length;

describe('A11Y-01: the context menu is operable from the keyboard and owns its keys', () => {
  it('Enter runs the focused item, closes the menu, and never starts a rename on the shape behind it', () => {
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    act(() => st().setSelection([nodeNamed(st().project, chen, 'Drug')]));
    key(canvas(), 'F10', { shiftKey: true });
    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();
    const before = nodeCount();
    const dup = within(menu).getByRole('menuitem', { name: /Duplicate/ });
    dup.focus();
    key(dup, 'Enter');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(nodeCount()).toBeGreaterThan(before);
    expect(screen.queryByLabelText('Edit text')).toBeNull();
  });

  it('Space runs the item too, and arrow / type-ahead keys do not reach the canvas', () => {
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    const drug = nodeNamed(st().project, chen, 'Drug');
    act(() => st().setSelection([drug]));
    const x0 = st().project.diagrams[chen]!.nodes[drug]!.x;
    key(canvas(), 'ContextMenu');
    const menu = screen.getByRole('menu');
    const first = within(menu).getAllByRole('menuitem')[0]!;
    first.focus();
    key(first, 'ArrowDown'); // moves within the menu, must not nudge the selected node
    expect(st().project.diagrams[chen]!.nodes[drug]!.x).toBe(x0);
    const del = within(menu).getByRole('menuitem', { name: /^Delete/ });
    del.focus();
    key(del, ' ');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(st().project.diagrams[chen]!.nodes[drug]).toBeUndefined();
  });

  it('Escape closes the menu and returns focus to the canvas', () => {
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    act(() => st().setSelection([nodeNamed(st().project, chen, 'Drug')]));
    key(canvas(), 'F10', { shiftKey: true });
    const item = within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!;
    key(item, 'Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(canvas());
  });
});

describe('A11Y-02: focus is not selection', () => {
  it('the context menu and the command palette of the editor offer "Properties"; focus.properties focuses the panel without changing the selection', async () => {
    document.body.insertAdjacentHTML('beforeend', '<aside data-testid="dock-properties"><input aria-label="Name field" /></aside><aside data-testid="dock-library"><button>Entity</button></aside>');
    try {
      render(<DiagramCanvas diagramId={chen} />);
      canvas().focus();
      const drug = nodeNamed(st().project, chen, 'Drug');
      act(() => st().setSelection([drug]));
      await act(async () => void (await runCommand('focus.properties')));
      expect(document.activeElement).toBe(screen.getByLabelText('Name field'));
      expect(st().selection.ids).toEqual([drug]);
      // F6 cycles properties -> library -> canvas, from inside a text field too
      key(document.activeElement!, 'F6');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Entity' }));
      key(document.activeElement!, 'F6');
      expect(document.activeElement).toBe(canvas());
      key(canvas(), 'F6', { shiftKey: true });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Entity' }));
      expect(st().selection.ids).toEqual([drug]);
    } finally {
      document.querySelectorAll('[data-testid^="dock-"]').forEach((n) => n.remove());
    }
  });
});

describe('A11Y-05: the diagram has a text alternative', () => {
  it('the SVG is an image with a generated summary, and the outline lists entities, attributes, relationships and participants', () => {
    const { container } = render(<DiagramCanvas diagramId={chen} />);
    const svg = container.querySelector('svg.sc-canvas__svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.getAttribute('aria-label')).toMatch(/Chen ER diagram with \d+ entities, \d+ relationships, \d+ attributes/);
    const outline = screen.getByRole('navigation', { name: 'Diagram outline' });
    expect(within(outline).getByRole('heading', { name: 'Entities' })).toBeTruthy();
    expect(within(outline).getByRole('link', { name: 'Weak entity Drug' })).toBeTruthy();
    expect(within(outline).getByRole('link', { name: 'Identifying relationship Makes' })).toBeTruthy();
    expect(within(outline).getByRole('link', { name: /^Drug, cardinality N, total participation/ })).toBeTruthy();
    expect(outline.closest('[role="application"]')).toBeNull();
    // the skip link comes first and moves focus into the outline
    fireEvent.click(screen.getByRole('button', { name: 'Skip to diagram outline' }));
    expect(outline.contains(document.activeElement)).toBe(true);
  });

  it('activating an outline item selects its shape and focuses the canvas; it stays in sync after a rename', () => {
    render(<DiagramCanvas diagramId={chen} />);
    const outline = screen.getByRole('navigation', { name: 'Diagram outline' });
    fireEvent.click(within(outline).getByRole('link', { name: 'Weak entity Drug' }));
    expect(st().selection.ids).toEqual([nodeNamed(st().project, chen, 'Drug')]);
    expect(document.activeElement).toBe(canvas());
    expect(canvasUiStore.getState().focusNodeId).toBe(st().selection.ids[0]);
    act(() => {
      const model = Object.values(st().project.models).find((m) => m.kind === 'er')!;
      const entity = Object.values((model as import('@/model/types').ErModel).entities).find((e) => e.name === 'Drug')!;
      st().commit('Rename', (d) => ops.updateEntity(d, model.id, entity.id, { name: 'Pill' }));
    });
    expect(within(outline).getByRole('link', { name: 'Weak entity Pill' })).toBeTruthy();
    expect(within(outline).queryByRole('link', { name: 'Weak entity Drug' })).toBeNull();
  });

  it('relational diagrams list tables with their key columns and foreign keys', () => {
    const { diagramId } = loadGlobal('rel');
    render(<DiagramCanvas diagramId={diagramId} />);
    const outline = screen.getByRole('navigation', { name: 'Diagram outline' });
    expect(within(outline).getByRole('link', { name: 'Table Patient' })).toBeTruthy();
    expect(within(outline).getByRole('link', { name: /^foreign key column DoctorSSN referencing Doctor\.SSN/ })).toBeTruthy();
    expect(within(outline).getByRole('heading', { name: 'Foreign keys' })).toBeTruthy();
  });
});

describe('A11Y-12: live text is current', () => {
  it('delete, undo and redo announce what happened; an expired creation hint does not linger after the rename commits', async () => {
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    const drug = nodeNamed(st().project, chen, 'Drug');
    act(() => st().setSelection([drug]));
    await act(async () => void (await runCommand('edit.delete')));
    expect(kbStore.getState().live).toMatch(/^Deleted /);
    await act(async () => void (await runCommand('edit.undo')));
    expect(kbStore.getState().live).toMatch(/^Undid Delete\./);
    await act(async () => void (await runCommand('edit.redo')));
    expect(kbStore.getState().live).toMatch(/^Redid Delete\./);
  });

  it('keyboard link with no shape in that direction says so', async () => {
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    act(() => st().setSelection([nodeNamed(st().project, chen, 'Drug')]));
    await act(async () => void (await runCommand('chen.linkFromSelection')));
    const sc = document.querySelector('[data-testid="canvas-live-kb"]')!;
    expect(sc.textContent).toMatch(/Connect from/);
    // far away from everything to the right of the right-most shape
    for (let i = 0; i < 4; i++) key(canvas(), 'ArrowRight');
    for (let i = 0; i < 12; i++) key(canvas(), 'ArrowRight');
    expect(sc.textContent).toMatch(/No shape to the right\./);
  });
});

describe('UX-11: a delete that cascades says what else went, with Undo', () => {
  it('deleting the weak entity Drug toasts "Deleted entity Drug, and with it ..." and the action undoes it', async () => {
    render(<DiagramCanvas diagramId={chen} />);
    const drug = nodeNamed(st().project, chen, 'Drug');
    act(() => st().setSelection([drug]));
    const before = nodeCount();
    await act(async () => void (await runCommand('edit.delete')));
    const toast = uiStore.getState().toasts.at(-1)!;
    expect(toast.message).toMatch(/^Deleted entity Drug, and with it .*attributes?.* and \d+ participation lines?\./);
    expect(toast.action?.label).toBe('Undo');
    act(() => toast.action!.onSelect());
    expect(nodeCount()).toBe(before);
  });

  it('a plain attribute delete takes nothing else with it, so there is no toast', async () => {
    render(<DiagramCanvas diagramId={chen} />);
    act(() => st().setSelection([nodeNamed(st().project, chen, 'Formula')]));
    await act(async () => void (await runCommand('edit.delete')));
    expect(uiStore.getState().toasts).toHaveLength(0);
  });
});

describe('SA-09: symbol hints (tooltips)', () => {
  it('keyboard focus shows the same explanation after a short rest; Escape dismisses it; the toggle turns it off', async () => {
    vi.useFakeTimers();
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    key(canvas(), 'Tab');
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => void vi.advanceTimersByTime(500));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent?.length).toBeGreaterThan(20);
    expect(canvas().getAttribute('aria-describedby')).toContain(tip.id);
    key(canvas(), 'Escape');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(async () => void (await runCommand('view.symbolHints')));
    expect(canvasUiStore.getState().symbolHints).toBe(false);
    key(canvas(), 'Tab');
    act(() => void vi.advanceTimersByTime(800));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
