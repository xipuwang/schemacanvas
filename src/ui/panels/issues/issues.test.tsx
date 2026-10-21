// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@/i18n';
import { buildExample } from '@/examples';
import { makeIssue } from '@/model/issues';
import type { Issue, Project, RelationalModel } from '@/model/types';
import { editorStore, settingsStore } from '@/store';
import { uiStore } from '../../uiStore';
import { IssuesDock } from './IssuesDock';
import { filterIssues, findOtherDiagram, focusIssueOnCanvas, resolveIssueTarget, sortIssues } from './issueActions';

let project: Project;
let rel: RelationalModel;

const issue = (code: string, severity: Issue['severity'], affected: Issue['affected'], title = code): Issue =>
  makeIssue({ code, severity, title, explanation: `${title} explanation`, suggestion: `${title} suggestion`, affected, modelId: rel.id });

beforeEach(() => {
  settingsStore.getState().setLocale('en');
  project = buildExample('pharmacy');
  rel = Object.values(project.models).find((m): m is RelationalModel => m.kind === 'relational')!;
  editorStore.getState().loadProject(project);
  const relDiagram = project.diagramOrder.find((id) => project.diagrams[id]!.type === 'relational-schema')!;
  editorStore.getState().setActiveDiagram(relDiagram);
  uiStore.setState({ issues: [], issuesStale: false, focusedIssueId: null, dialog: null });
});
afterEach(cleanup);

const relation = (name: string) => Object.values(rel.relations).find((r) => r.name === name)!;

describe('issue actions', () => {
  it('sorts most severe first (stable) and filters by severity', () => {
    const list = [issue('a', 'info', []), issue('b', 'error', []), issue('c', 'warning', []), issue('d', 'error', [])];
    expect(sortIssues(list).map((i) => i.code)).toEqual(['b', 'd', 'c', 'a']);
    expect(filterIssues(list, new Set(['info'])).map((i) => i.code)).toEqual(['a']);
  });

  it('resolves a column issue to its table node with a column sub-selection and an FK issue to its edge', () => {
    const drug = relation('Drug');
    const col = drug.columns[0]!;
    const fkId = Object.keys(rel.foreignKeys)[0]!;
    const diagram = project.diagrams[editorStore.getState().activeDiagramId!]!;
    const c = resolveIssueTarget(project, diagram, { affected: [{ kind: 'column', relationId: drug.id, id: col.id }] });
    expect(c.nodeIds).toHaveLength(1);
    expect(c.sub).toEqual({ kind: 'column', relationId: drug.id, id: col.id });
    const f = resolveIssueTarget(project, diagram, { affected: [{ kind: 'foreignKey', id: fkId }] });
    expect(f.edgeIds).toHaveLength(1);
    expect(f.sub).toEqual({ kind: 'foreignKey', id: fkId });
  });

  it('click-to-highlight selects the affected nodes and focuses the issue', () => {
    const drug = relation('Drug');
    const i = issue('rel.x', 'error', [{ kind: 'relation', id: drug.id }]);
    expect(focusIssueOnCanvas(i)).toBe('selected');
    const sel = editorStore.getState().selection;
    const diagram = editorStore.getState().project.diagrams[editorStore.getState().activeDiagramId!]!;
    expect(sel.ids).toEqual([Object.values(diagram.nodes).find((n) => n.ref.id === drug.id)!.id]);
    expect(uiStore.getState().focusedIssueId).toBe(i.id);
  });

  it('reports an issue about the other model and finds its diagram', () => {
    const er = project.diagramOrder.find((id) => project.diagrams[id]!.type === 'chen')!;
    editorStore.getState().setActiveDiagram(er);
    const i = issue('rel.x', 'warning', [{ kind: 'relation', id: relation('Drug').id }]);
    expect(focusIssueOnCanvas(i)).toBe('other-model');
    expect(findOtherDiagram(editorStore.getState().project, er, i)?.type).toBe('relational-schema');
  });
});

describe('IssuesDock', () => {
  it('shows the empty state and runs Validate', () => {
    render(<IssuesDock />);
    expect(screen.getByText('No issues')).toBeTruthy();
    expect(screen.getByText('The model passes every check.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeTruthy();
  });

  it('lists issues with counts, filters by severity, and flags stale results', () => {
    uiStore.setState({ issues: [issue('a', 'error', [], 'Alpha'), issue('b', 'warning', [], 'Beta'), issue('c', 'info', [], 'Gamma')], issuesStale: true });
    render(<IssuesDock />);
    expect(screen.getByTestId('issues-chip-error').textContent).toContain('1');
    expect(screen.getByText('Out of date')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByTestId('issues-chip-error'));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('click selects on the canvas, expands the details, and arrow keys move between issues', () => {
    const drug = relation('Drug');
    uiStore.setState({
      issues: [issue('a', 'error', [{ kind: 'relation', id: drug.id }], 'Alpha'), issue('b', 'warning', [], 'Beta')],
    });
    render(<IssuesDock />);
    const rows = screen.getAllByRole('button', { name: /Alpha|Beta/ });
    fireEvent.click(rows[0]!);
    expect(editorStore.getState().selection.ids).toHaveLength(1);
    expect(screen.getByText('Alpha explanation')).toBeTruthy();
    expect(rows[0]!.getAttribute('aria-current')).toBe('true');
    act(() => rows[0]!.focus());
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('offers "Show in" for an issue of the other model and switches the sheet', () => {
    const er = project.diagramOrder.find((id) => project.diagrams[id]!.type === 'chen')!;
    editorStore.getState().setActiveDiagram(er);
    uiStore.setState({ issues: [issue('a', 'warning', [{ kind: 'relation', id: relation('Drug').id }], 'Alpha')] });
    render(<IssuesDock />);
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    const btn = screen.getByTestId('issue-show-in');
    expect(within(btn).getByText(/Show in/)).toBeTruthy();
    fireEvent.click(btn);
    expect(editorStore.getState().project.diagrams[editorStore.getState().activeDiagramId!]!.type).toBe('relational-schema');
    expect(editorStore.getState().selection.ids).toHaveLength(1);
  });

  it('A11Y-14: the tab stop follows focus and the expanded row exposes aria-expanded / aria-controls', () => {
    uiStore.setState({ issues: [issue('a', 'warning', [], 'Alpha'), issue('b', 'warning', [], 'Beta'), issue('c', 'warning', [], 'Gamma')] });
    render(<IssuesDock />);
    const rows = () => screen.getAllByRole('button', { name: /Alpha|Beta|Gamma/ });
    expect(rows().map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    act(() => rows()[2]!.focus());
    expect(rows().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    expect(rows().map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false']);
    act(() => rows()[1]!.focus()); // a real click focuses the button first
    fireEvent.click(rows()[1]!);
    const open = rows()[1]!;
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const controls = open.getAttribute('aria-controls')!;
    expect(document.getElementById(controls)?.textContent).toContain('Beta explanation');
    // focusing an issue by click moves the tab stop to it as well
    expect(rows().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('UX-6: a missing-type issue offers one bulk action that types every untyped column of its table', () => {
    const drug = relation('Drug');
    editorStore.getState().commit('strip', (d) => {
      for (const c of (d.models[rel.id] as RelationalModel).relations[drug.id]!.columns) delete c.dataType;
    });
    uiStore.setState({ issues: [issue('ddl.generic.missing-type', 'warning', [{ kind: 'relation', id: drug.id }], 'Drug columns untyped')] });
    render(<IssuesDock />);
    fireEvent.click(screen.getByRole('button', { name: /Drug columns untyped/ }));
    fireEvent.click(screen.getByTestId('issue-bulk-type-open'));
    const n = (editorStore.getState().project.models[rel.id] as RelationalModel).relations[drug.id]!.columns.length;
    expect(screen.getByTestId('issue-bulk-type-apply').textContent).toContain(`${n} column`);
    fireEvent.click(screen.getByTestId('issue-bulk-type-apply'));
    const cols = (editorStore.getState().project.models[rel.id] as RelationalModel).relations[drug.id]!.columns;
    expect(cols.every((c) => c.dataType === 'VARCHAR(255)')).toBe(true);
  });
});
