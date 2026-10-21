// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@/i18n';
import { buildExample } from '@/examples';
import { editorStore, settingsStore } from '@/store';
import { uiStore } from '../../uiStore';
import { ImportDialog } from './import/ImportDialog';
import { SqlView } from './sql/SqlView';
import { CodeView } from './sql/CodeView';
import { Notice } from './common';

beforeEach(() => {
  settingsStore.getState().setLocale('en');
  uiStore.setState({ dialog: null, toasts: [] });
});
afterEach(cleanup);

describe('SqlView', () => {
  it('shows the derived relational model of an ER sheet (SA-14) with a way to its relational sheet', () => {
    const p = buildExample('weak-entity');
    editorStore.getState().loadProject(p);
    const chen = p.diagramOrder.find((id) => p.diagrams[id]!.type === 'chen')!;
    const rel = p.diagramOrder.find((id) => p.diagrams[id]!.type === 'relational-schema')!;
    editorStore.getState().setActiveDiagram(chen);
    render(<SqlView variant="dock" />);
    expect(screen.queryByText('No relational model on this sheet')).toBeNull();
    expect(screen.getByTestId('sql-derived').textContent).toContain('converted relational model');
    expect(screen.getByTestId('code-view').textContent).toContain('CREATE TABLE');
    fireEvent.click(screen.getByRole('button', { name: 'Show the relational sheet' }));
    expect(editorStore.getState().activeDiagramId).toBe(rel);
  });

  it('shows an empty state with Convert on an ER sheet that has no converted model', () => {
    const p = buildExample('weak-entity');
    p.conversions = {};
    editorStore.getState().loadProject(p);
    editorStore.getState().setActiveDiagram(p.diagramOrder.find((id) => p.diagrams[id]!.type === 'chen')!);
    render(<SqlView variant="dock" />);
    expect(screen.getByText('No relational model on this sheet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Convert' })).toBeTruthy();
  });

  it('renders live DDL for the active relational model and switches dialect', () => {
    const p = buildExample('weak-entity');
    editorStore.getState().loadProject(p);
    editorStore.getState().setActiveDiagram(p.diagramOrder.find((id) => p.diagrams[id]!.type === 'relational-schema')!);
    render(<SqlView variant="dock" />);
    const code = screen.getByTestId('code-view');
    expect(code.textContent).toContain('CREATE TABLE');
    expect(code.textContent).toContain('CompanyName');
    fireEvent.click(screen.getByRole('radio', { name: 'DBML' }));
    expect(screen.getByTestId('code-view').textContent).toContain('Table');
    expect(screen.getByRole('button', { name: 'Download .dbml' })).toBeTruthy();
  });
});

describe('CodeView', () => {
  it('caps the rendered lines and says so, but keeps the line count honest', () => {
    const text = Array.from({ length: 50 }, (_, i) => `SELECT ${i};`).join('\n');
    render(<CodeView text={text} lang="sql" label="x" maxLines={10} />);
    expect(document.querySelectorAll('.code-line')).toHaveLength(10);
    expect(screen.getByRole('status').textContent).toContain('first 10 of 50 lines');
  });
});

describe('Notice', () => {
  it('announces danger notices assertively', () => {
    render(<Notice tone="danger" title="Broken">why</Notice>);
    expect(screen.getByRole('alert').textContent).toContain('Broken');
  });
});

describe('ImportDialog', () => {
  it('reports the error position, then imports after the text is fixed (one undo step)', async () => {
    editorStore.getState().newProject('T');
    render(<ImportDialog props={{}} onClose={() => undefined} />);
    const area = screen.getByTestId('import-text');
    const apply = screen.getByTestId('import-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(area, { target: { value: 'CREATE TABLE A (id INT PRIMARY KEY);\nCREATE TABLE B (a INT REFERENCES );' } });
    const err = await screen.findByTestId('import-error', undefined, { timeout: 3000 });
    expect(err.textContent).toContain('line 2');
    expect(within(err).getByText(/REFERENCES/)).toBeTruthy();
    expect(apply.disabled).toBe(true);
    fireEvent.change(area, { target: { value: 'CREATE TABLE A (id INT PRIMARY KEY);\nCREATE TABLE B (a INT REFERENCES A (id));' } });
    const summary = await screen.findByTestId('import-summary', undefined, { timeout: 3000 });
    expect(summary.textContent).toContain('2 tables and 1 foreign key');
    const undoBefore = editorStore.getState().undoStack.length;
    await act(async () => {
      fireEvent.click(apply);
    });
    await waitFor(() => expect(editorStore.getState().undoStack.length).toBe(undoBefore + 1), { timeout: 5000 });
    const s = editorStore.getState();
    expect(s.project.diagrams[s.activeDiagramId!]!.type).toBe('relational-schema');
    expect(uiStore.getState().toasts.at(-1)?.message).toBe('Imported 2 tables');
  });

  it('shows a project-file load error with its message', async () => {
    render(<ImportDialog props={{ tab: 'project', text: '{ nope' }} onClose={() => undefined} />);
    const err = await screen.findByTestId('import-error', undefined, { timeout: 3000 });
    expect(err.textContent).toContain('Cannot open this project file');
    expect(err.textContent!.length).toBeGreaterThan(40);
  });
});

describe('ExportDialog transparent background (UX-13)', () => {
  it('hints at dark slides, offers light lines and previews on a dark or light swatch; default is unchanged', async () => {
    const { ExportDialog } = await import('./export/ExportDialog');
    const p = buildExample('weak-entity');
    editorStore.getState().loadProject(p);
    editorStore.getState().setActiveDiagram(p.diagramOrder.find((id) => p.diagrams[id]!.type === 'relational-schema')!);
    render(<ExportDialog props={{ format: 'png' }} onClose={() => undefined} />);
    expect(screen.queryByTestId('export-transparent')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Dark palette' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Transparent' }));
    expect(screen.getByTestId('export-transparent-hint').textContent).toContain('dark slide');
    const light = screen.getByRole('switch', { name: 'Light lines for dark slides' }) as HTMLInputElement;
    expect(light.getAttribute('aria-checked') ?? String(light.checked)).toBe('false'); // default unchanged
    // preview swatch is independent of the palette
    fireEvent.click(screen.getByRole('radio', { name: 'Dark slide' }));
    await waitFor(() => expect(document.querySelector('.exp-stage.is-dark.is-checker')).toBeTruthy());
    fireEvent.click(light);
    expect(screen.getByTestId('export-transparent-hint').textContent).toContain('Light lines');
    fireEvent.click(screen.getByRole('radio', { name: 'Light slide' }));
    await waitFor(() => expect(document.querySelector('.exp-stage.is-checker:not(.is-dark)')).toBeTruthy());
  });
});
