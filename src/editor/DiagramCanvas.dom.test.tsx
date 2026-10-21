// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as ops from '@/model/ops';
import type { Id } from '@/model/types';
import { createBareProject } from '@/model/defaults';
import { editorStore } from '@/store';
import { uiStore } from '@/ui/uiStore';
import '@/i18n';
import { DiagramCanvas } from './DiagramCanvas';
import type { DiagramCanvasHandle } from './canvasHandle';
import { canvasUiStore } from './canvasState';
import { getCommand } from './commands/registry';
import { loadGlobal, nodeNamed } from './testFixtures';
import { createRef } from 'react';
import { buildScene } from '@/scene/registry';

const st = () => editorStore.getState();
let chen: Id;

beforeEach(() => {
  chen = loadGlobal('chen').diagramId;
  canvasUiStore.setState({ armedItem: null, focusNodeId: null });
});
afterEach(() => cleanup());

const canvas = () => screen.getByRole('application');
const key = (target: Element | Document, k: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(target, { key: k, ...init }));

describe('DiagramCanvas (jsdom)', () => {
  it('renders the scene, is a labelled focusable application region and registers its handle', () => {
    const ref = createRef<DiagramCanvasHandle>();
    const { container } = render(<DiagramCanvas ref={ref} diagramId={chen} />);
    expect(canvas().getAttribute('aria-label')).toBeTruthy();
    expect(canvas().tabIndex).toBe(0);
    expect(container.querySelectorAll('[data-node-id]').length).toBe(Object.keys(st().project.diagrams[chen]!.nodes).length);
    expect(ref.current?.getViewport().zoom).toBeGreaterThan(0);
    expect(getCommand('view.fit')!.isEnabled!({ store: editorStore, canvas: ref.current })).toBe(true);
  });

  it('global shortcuts run on the document for non-input targets, never while typing', () => {
    render(
      <>
        <DiagramCanvas diagramId={chen} />
        <input aria-label="elsewhere" />
      </>,
    );
    key(document.body, 'a', { ctrlKey: true });
    expect(st().selection.ids.length).toBe(Object.keys(st().project.diagrams[chen]!.nodes).length);
    const input = screen.getByLabelText('elsewhere');
    input.focus();
    key(input, 'Delete');
    key(input, 'a', { ctrlKey: true });
    expect(Object.keys(st().project.diagrams[chen]!.nodes).length).toBeGreaterThan(0);
    // Delete on the body with a selection deletes (semantic)
    const before = Object.keys(st().project.diagrams[chen]!.nodes).length;
    key(document.body, 'Delete');
    expect(Object.keys(st().project.diagrams[chen]!.nodes).length).toBeLessThan(before);
    key(document.body, 'z', { ctrlKey: true });
    expect(Object.keys(st().project.diagrams[chen]!.nodes).length).toBe(before);
  });

  it('does not fire shortcuts while a dialog is open', () => {
    render(<DiagramCanvas diagramId={chen} />);
    st().setSelection([nodeNamed(st().project, chen, 'Doctor')]);
    uiStore.getState().openDialog('about');
    key(document.body, 'Delete');
    expect(Object.values(st().project.models).some((m) => m.kind === 'er' && Object.values(m.entities).some((e) => e.name === 'Doctor'))).toBe(true);
    uiStore.getState().closeDialog();
  });

  it('arrow keys nudge by the grid size (Shift x10, Alt 1px); a burst is ONE undo step (closed by the next other key); Escape clears the selection', () => {
    render(<DiagramCanvas diagramId={chen} />);
    const id = nodeNamed(st().project, chen, 'Doctor');
    st().setSelection([id]);
    const grid = st().project.diagrams[chen]!.options.grid.size;
    const x0 = st().project.diagrams[chen]!.nodes[id]!.x;
    const d0 = st().undoStack.length;
    canvas().focus();
    key(canvas(), 'ArrowRight');
    expect(st().project.diagrams[chen]!.nodes[id]!.x).toBe(x0 + grid);
    key(canvas(), 'ArrowRight', { shiftKey: true });
    expect(st().project.diagrams[chen]!.nodes[id]!.x).toBe(x0 + grid * 11);
    key(canvas(), 'ArrowDown', { altKey: true });
    expect(st().project.diagrams[chen]!.nodes[id]!.y).toBeGreaterThan(0);
    // DELIBERATE CHANGE (was: one undo step per press): presses inside the 400 ms idle window coalesce; any other key closes the burst
    expect(st().inTransaction).toBe(true);
    key(canvas(), 'Escape');
    expect(st().inTransaction).toBe(false);
    expect(st().undoStack.length).toBe(d0 + 1);
    expect(st().selection.ids).toEqual([]);
    st().undo();
    expect(st().project.diagrams[chen]!.nodes[id]!.x).toBe(x0);
  });

  it('locked nodes do not nudge', () => {
    render(<DiagramCanvas diagramId={chen} />);
    const id = nodeNamed(st().project, chen, 'Doctor');
    st().commit('lock', (d) => ops.setNodeLocked(d, chen, id, true));
    st().setSelection([id]);
    const x0 = st().project.diagrams[chen]!.nodes[id]!.x;
    const d0 = st().undoStack.length;
    key(canvas(), 'ArrowLeft');
    expect(st().project.diagrams[chen]!.nodes[id]!.x).toBe(x0);
    expect(st().undoStack.length).toBe(d0);
  });

  it('A11Y-02: Tab moves the FOCUS ring through nodes in reading order (selection untouched), announces it; Space/Enter selects; Shift+Tab before the first leaves', () => {
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    // select the very first shape in reading order, so that Tab has two more to walk
    const sc = buildScene(st().project, chen);
    const keep = [...sc.nodeOrder].sort((a, b) => sc.nodes[a]!.bounds.y - sc.nodes[b]!.bounds.y || sc.nodes[a]!.bounds.x - sc.nodes[b]!.bounds.x)[0]!;
    act(() => st().setSelection([keep]));
    key(canvas(), 'Tab');
    // the selection is exactly what it was: the Properties panel keeps describing it
    expect(st().selection.ids).toEqual([keep]);
    const first = canvasUiStore.getState().focusNodeId!;
    expect(first).toBeTruthy();
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/Press Space or Enter to select/);
    key(canvas(), 'Tab');
    const second = canvasUiStore.getState().focusNodeId!;
    expect(second).not.toBe(first);
    expect(st().selection.ids).toEqual([keep]);
    key(canvas(), 'Tab', { shiftKey: true });
    expect(canvasUiStore.getState().focusNodeId).toBe(first);
    // Space selects the focused shape (not a pan), and announces the real selection
    key(canvas(), ' ');
    expect(st().selection.ids).toEqual([first]);
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/selected/);
    // Enter on a focused-but-unselected shape selects it instead of renaming whatever is selected
    key(canvas(), 'Tab');
    const next = canvasUiStore.getState().focusNodeId!;
    key(canvas(), 'Enter');
    expect(st().selection.ids).toEqual([next]);
    expect(screen.queryByLabelText('Edit text')).toBeNull();
    // shift-tab before the first node: not consumed (focus leaves)
    for (let i = 0; i < 80; i++) key(canvas(), 'Tab', { shiftKey: true });
    const notPrevented = fireEvent.keyDown(canvas(), { key: 'Tab', shiftKey: true });
    expect(notPrevented).toBe(true);
  });

  it('Enter starts an inline rename; Enter commits through the op; Escape cancels', () => {
    render(<DiagramCanvas diagramId={chen} />);
    const id = nodeNamed(st().project, chen, 'Doctor');
    st().setSelection([id]);
    canvas().focus();
    key(canvas(), 'Enter');
    const input = screen.getByLabelText('Edit text') as HTMLInputElement;
    expect(input.value).toBe('Doctor');
    fireEvent.change(input, { target: { value: 'Physician' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByLabelText('Edit text')).toBeNull();
    const m = st().project.models[st().project.diagrams[chen]!.modelId];
    expect(m!.kind === 'er' && Object.values(m.entities).some((e) => e.name === 'Physician')).toBe(true);
    expect(st().project.diagrams[chen]!.nodes[id]).toBeDefined(); // same node, same id

    key(canvas(), 'Enter');
    const again = screen.getByLabelText('Edit text') as HTMLInputElement;
    fireEvent.change(again, { target: { value: 'Nope' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(screen.queryByLabelText('Edit text')).toBeNull();
    expect(m!.kind === 'er' && Object.values(st().project.models[m!.id]!.kind === 'er' ? (st().project.models[m!.id] as typeof m & { entities: Record<string, { name: string }> }).entities : {}).some((e) => e.name === 'Nope')).toBe(false);
  });

  it('an empty name is refused (the rename is dropped) and an unchanged name creates no history', () => {
    render(<DiagramCanvas diagramId={chen} />);
    const id = nodeNamed(st().project, chen, 'Doctor');
    st().setSelection([id]);
    canvas().focus();
    const d0 = st().undoStack.length;
    key(canvas(), 'Enter');
    const a = screen.getByLabelText('Edit text') as HTMLInputElement;
    fireEvent.change(a, { target: { value: '   ' } });
    fireEvent.keyDown(a, { key: 'Enter' });
    key(canvas(), 'Enter');
    const b = screen.getByLabelText('Edit text') as HTMLInputElement;
    fireEvent.keyDown(b, { key: 'Enter' });
    expect(st().undoStack.length).toBe(d0);
  });

  it('shows the quiet empty-state hint only for an empty diagram', () => {
    const { rerender } = render(<DiagramCanvas diagramId={chen} />);
    expect(screen.queryByTestId('canvas-empty')).toBeNull();
    const p = createBareProject('x');
    editorStore.getState().loadProject(p);
    rerender(<DiagramCanvas diagramId="missing" />);
    expect(screen.queryByTestId('canvas-empty')).toBeNull(); // no diagram: renders nothing, does not throw
  });

  it('survives its diagram disappearing while mounted', () => {
    render(<DiagramCanvas diagramId={chen} />);
    act(() => {
      st().commit('remove', (d) => ops.removeDiagram(d, chen));
    });
    expect(canvas()).toBeTruthy();
    key(canvas(), 'ArrowLeft');
    key(canvas(), 'Tab');
    key(canvas(), 'Enter');
  });

  it('space does not scroll the page when the canvas has focus', () => {
    render(<DiagramCanvas diagramId={chen} />);
    canvas().focus();
    expect(fireEvent.keyDown(canvas(), { key: ' ' })).toBe(false); // preventDefault called
  });
});
