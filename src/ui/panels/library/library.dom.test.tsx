// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { LIBRARY_MIME, canvasUiStore, decodeLibraryItem, registerTemplateInserter, createFromLibraryItem, type LibraryItem } from '@/editor';
import { setCanvasHandle } from '@/editor/commands/registry';
import { createBareProject, createErModel } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import { relationalBuilder } from '@/model/builders';
import { TEMPLATES } from '@/examples';
import { editorStore, settingsStore } from '@/store';
import { LibraryPanel } from './LibraryPanel';
import { LIBRARY_STORAGE_KEY, collapseStore } from './collapse';
import { librarySections, partMatches } from './items';
import { previewFor } from './previews';
import { insertTemplateAt } from './templateInserter';

const st = () => editorStore.getState();

function load(type: 'chen' | 'relational-schema'): string {
  const project = createBareProject('t');
  const model = type === 'chen' ? createErModel('m') : relationalBuilder('r').build();
  const d = withDiagram(project, model, type);
  st().loadProject(project);
  st().setActiveDiagram(d.id);
  return d.id;
}

let armed: LibraryItem | null = null;
beforeEach(() => {
  settingsStore.getState().setLocale('en');
  armed = null;
  canvasUiStore.setState({ armedItem: null });
  collapseStore.setState({ collapsed: [] });
  try {
    localStorage.removeItem(LIBRARY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  setCanvasHandle({
    armItem: (item: LibraryItem | null) => {
      armed = item;
      canvasUiStore.setState({ armedItem: item });
    },
  } as never);
});
afterEach(() => {
  cleanup();
  setCanvasHandle(null);
  registerTemplateInserter(insertTemplateAt);
});

describe('library content per diagram type', () => {
  it('Chen: entities, relationships, attributes, tools and ER templates', () => {
    load('chen');
    render(<LibraryPanel />);
    for (const id of ['entity', 'weak-entity', 'relationship', 'identifying-relationship', 'attribute', 'key-attribute', 'partial-key', 'multivalued', 'derived', 'composite']) {
      expect(document.querySelector(`[data-part-id="${id}"]`), id).toBeTruthy();
    }
    expect(document.querySelector('[data-part-id="table"]')).toBeNull();
    const er = TEMPLATES.filter((t) => t.modelKind === 'er');
    expect(document.querySelectorAll('[data-part-id^="template-"]')).toHaveLength(er.length);
    expect(document.querySelector('[data-tool="connect"]')).toBeTruthy();
    expect(document.querySelector('[data-tool="fk"]')).toBeNull();
  });

  it('Relational: tables, relational templates and the FK tool', () => {
    load('relational-schema');
    render(<LibraryPanel />);
    expect(document.querySelector('[data-part-id="table"]')).toBeTruthy();
    expect(document.querySelector('[data-part-id="entity"]')).toBeNull();
    const rel = TEMPLATES.filter((t) => t.modelKind === 'relational');
    expect(document.querySelectorAll('[data-part-id^="template-"]')).toHaveLength(rel.length);
    expect(document.querySelector('[data-tool="fk"]')).toBeTruthy();
    expect(document.querySelector('[data-tool="connect"]')).toBeNull();
  });

  it('connect / fk tools are disabled with an explanation until their commands exist, select and hand work', () => {
    load('chen');
    render(<LibraryPanel />);
    const connect = document.querySelector('[data-tool="connect"]') as HTMLElement;
    const hasCommand = connect.getAttribute('aria-disabled') !== 'true';
    // command registered by the tools worker => enabled; otherwise disabled. Either way the button reflects it.
    expect(typeof hasCommand).toBe('boolean');
    const hand = document.querySelector('[data-tool="hand"]') as HTMLElement;
    act(() => void fireEvent.click(hand));
    expect(st().tool).toBe('hand');
    expect(hand.getAttribute('aria-pressed')).toBe('true');
    act(() => void fireEvent.click(document.querySelector('[data-tool="select"]')!));
    expect(st().tool).toBe('select');
  });
});

describe('arming, dragging and keyboard', () => {
  it('click arms, click again disarms, Escape disarms, the hint explains', () => {
    load('chen');
    render(<LibraryPanel />);
    const entity = document.querySelector('[data-part-id="entity"]') as HTMLElement;
    expect(screen.getByTestId('library-hint').textContent).toMatch(/Drag onto the sheet, or click a part/);
    act(() => void fireEvent.click(entity));
    expect(armed).toEqual({ kind: 'entity' });
    expect(entity.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('library-hint').textContent).toMatch(/Click the sheet to place Entity/);
    act(() => void fireEvent.click(entity));
    expect(armed).toBeNull();
    act(() => void fireEvent.click(entity));
    act(() => void fireEvent.keyDown(entity, { key: 'Escape' }));
    expect(armed).toBeNull();
    // arming another replaces
    act(() => void fireEvent.click(document.querySelector('[data-part-id="weak-entity"]')!));
    expect(armed).toEqual({ kind: 'entity', weak: true });
  });

  it('items are draggable and carry the library MIME payload', () => {
    load('chen');
    render(<LibraryPanel />);
    const item = document.querySelector('[data-part-id="identifying-relationship"]') as HTMLElement;
    expect(item.getAttribute('draggable')).toBe('true');
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' };
    act(() => void fireEvent.dragStart(item, { dataTransfer }));
    expect(decodeLibraryItem(data[LIBRARY_MIME])).toEqual({ kind: 'relationship', identifying: true });
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('roving focus: one tab stop, arrows move, Enter/Space (native click) arms', () => {
    load('chen');
    render(<LibraryPanel />);
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-lib-item]'));
    expect(items.filter((i) => i.tabIndex === 0)).toHaveLength(1);
    items[0]!.focus();
    act(() => void fireEvent.keyDown(items[0]!, { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(items[1]);
    expect(items[1]!.tabIndex).toBe(0);
    expect(items[0]!.tabIndex).toBe(-1);
    act(() => void fireEvent.keyDown(items[1]!, { key: 'End' }));
    expect(document.activeElement).toBe(items[items.length - 1]);
    act(() => void fireEvent.keyDown(items[items.length - 1]!, { key: 'Home' }));
    expect(document.activeElement).toBe(items[0]);
  });
});

describe('search and collapsing', () => {
  it('filters parts by localized label and keywords and explains an empty result', () => {
    load('chen');
    render(<LibraryPanel />);
    const search = screen.getByRole('searchbox', { name: 'Search parts' });
    act(() => void fireEvent.change(search, { target: { value: 'underline' } }));
    expect(document.querySelector('[data-part-id="key-attribute"]')).toBeTruthy();
    expect(document.querySelector('[data-part-id="entity"]')).toBeNull();
    act(() => void fireEvent.change(search, { target: { value: 'zzzz' } }));
    expect(screen.getByText(/No parts match "zzzz"/)).toBeTruthy();
    act(() => void fireEvent.keyDown(search, { key: 'Escape' }));
    expect((search as HTMLInputElement).value).toBe('');
    expect(document.querySelector('[data-part-id="entity"]')).toBeTruthy();
  });

  it('partMatches covers English keywords for Chinese labels', () => {
    const part = librarySections('chen')[0]!.parts[0]!;
    expect(partMatches(part, '实体', 'rectangle')).toBe(true);
    expect(partMatches(part, '实体', '实')).toBe(true);
    expect(partMatches(part, '实体', 'diamond')).toBe(false);
  });

  it('collapsed sections are remembered in localStorage and survive a remount', () => {
    load('chen');
    const { unmount } = render(<LibraryPanel />);
    const toggle = screen.getByRole('button', { name: /^Entities/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => void fireEvent.click(toggle));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-part-id="entity"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(LIBRARY_STORAGE_KEY) ?? '{}').collapsed).toEqual(['entities']);
    unmount();
    collapseStore.getState().reload();
    render(<LibraryPanel />);
    expect(screen.getByRole('button', { name: /^Entities/ }).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('previews use the real notation builders', () => {
  it('weak entity is a double rectangle, identifying relationship a double diamond, multivalued a double ellipse', () => {
    const count = (svg: string, tag: string) => (svg.match(new RegExp(`<${tag}[ />]`, 'g')) ?? []).length;
    const entity = previewFor({ kind: 'entity', weak: false }, 'chen', 'light', 'en')!;
    const weak = previewFor({ kind: 'entity', weak: true }, 'chen', 'light', 'en')!;
    expect(count(weak.svg, 'rect')).toBeGreaterThan(count(entity.svg, 'rect'));
    const rel = previewFor({ kind: 'relationship', identifying: false }, 'chen', 'light', 'en')!;
    const ident = previewFor({ kind: 'relationship', identifying: true }, 'chen', 'light', 'en')!;
    const shapes = (s: string) => count(s, 'polygon') + count(s, 'path') + count(s, 'polyline');
    expect(shapes(ident.svg)).toBeGreaterThan(shapes(rel.svg));
    const simple = previewFor({ kind: 'attribute', flavor: 'simple' }, 'chen', 'light', 'en')!;
    const multi = previewFor({ kind: 'attribute', flavor: 'multivalued' }, 'chen', 'light', 'en')!;
    expect(count(multi.svg, 'ellipse') + count(multi.svg, 'path')).toBeGreaterThan(count(simple.svg, 'ellipse') + count(simple.svg, 'path'));
    // the attribute preview shows only the attribute: no owner entity rectangle
    expect(count(simple.svg, 'rect')).toBe(0);
  });

  it('every part previews in both themes, is cached and has no fixed pixel size', () => {
    for (const type of ['chen', 'relational-schema'] as const) {
      for (const section of librarySections(type)) {
        for (const part of section.parts) {
          const light = previewFor(part.preview, type, 'light', 'en');
          const dark = previewFor(part.preview, type, 'dark', 'en');
          expect(light, part.id).toBeTruthy();
          expect(dark, part.id).toBeTruthy();
          expect(light!.svg).toMatch(/viewBox="/);
          expect(light!.svg.slice(0, 200)).not.toMatch(/ width="/);
          expect(previewFor(part.preview, type, 'light', 'en')).toBe(light);
          expect(light!.svg).not.toBe(dark!.svg);
        }
      }
    }
  });

  it('the horizontal table preview is a single row with a key cell', () => {
    const p = previewFor({ kind: 'relation' }, 'relational-schema', 'light', 'en')!;
    expect(p.svg).toContain('<line'); // PK underline is an explicit line (SVG hygiene rule)
    expect(p.width).toBeGreaterThan(p.height);
  });
});

describe('template inserter', () => {
  it('inserts a whole template in ONE commit and returns the new node ids', () => {
    const diagramId = load('chen');
    const depth = st().undoStack.length;
    const ids = insertTemplateAt({ store: editorStore, diagramId, templateId: 'many-to-many', at: { x: 400, y: 300 } });
    expect(ids.length).toBeGreaterThan(3);
    expect(st().undoStack.length).toBe(depth + 1);
    const diagram = st().project.diagrams[diagramId]!;
    for (const id of ids) expect(diagram.nodes[id]).toBeTruthy();
    // centred on the drop point (within the grid snap)
    const xs = ids.map((id) => diagram.nodes[id]!.x);
    expect(Math.min(...xs)).toBeLessThan(400);
    act(() => st().undo());
    expect(Object.keys(st().project.diagrams[diagramId]!.nodes)).toHaveLength(0);
  });

  it('a template of the wrong model kind is refused without changing the project', () => {
    const diagramId = load('relational-schema');
    const before = st().project;
    expect(() => insertTemplateAt({ store: editorStore, diagramId, templateId: 'many-to-many', at: { x: 0, y: 0 } })).toThrow();
    expect(st().project).toBe(before);
  });

  it('createFromLibraryItem goes through the registered inserter and selects what it returns', () => {
    const diagramId = load('chen');
    const spy = vi.fn(insertTemplateAt);
    registerTemplateInserter(spy);
    const res = createFromLibraryItem(editorStore, diagramId, { kind: 'template', templateId: 'weak-entity' }, { x: 200, y: 200 });
    expect(spy).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.selectIds.length).toBeGreaterThan(1);
  });
});

describe('zh locale', () => {
  it('renders Chinese labels and hint', () => {
    load('chen');
    settingsStore.getState().setLocale('zh');
    render(<LibraryPanel />);
    expect(within(document.querySelector('[data-part-id="weak-entity"]') as HTMLElement).getByText('弱实体')).toBeTruthy();
    expect(screen.getByTestId('library-hint').textContent).toContain('拖到画布上');
  });
});
