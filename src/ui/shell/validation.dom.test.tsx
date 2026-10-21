// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import '@/i18n';
import { relationalBuilder } from '@/model/builders';
import { projectOf } from '@/validation/fixtures';
import { ddlIssues, generateDdl } from '@/sql';
import { validateProject } from '@/validation';
import { toolUi } from '@/editor/tools/toolState';
import { editorStore, settingsStore } from '@/store';
import { uiStore } from '../uiStore';
import { loadDdlChecks, runValidation, validateActiveModel, validationAnnouncement } from './validation';

/** SA-03: five structural problems (no PK, duplicate column, FK to a missing table / column / non-key). */
function badModel() {
  const b = relationalBuilder('Bad', 'postgresql');
  b.relation('NoKey', ['a', 'b']);
  b.relation('Dup', ['x', 'X'], { pk: ['x'] });
  const t = b.relation('T', ['id', 'ref1', 'ref2', 'ref3', 'other'], { pk: ['id'] });
  const u = b.relation('U', ['id', 'plain'], { pk: ['id'] });
  const toMissingTable = b.fk(t, ['ref1'], u, ['id']);
  toMissingTable.targetRelationId = 'rel_ghost';
  const toMissingColumn = b.fk(t, ['ref2'], u, ['id']);
  toMissingColumn.columns[0]!.targetColumnId = 'col_ghost';
  b.fk(t, ['ref3'], u, ['plain']);
  return b.build();
}

describe('SA-03 structural problems are reported once', () => {
  it('five problems -> five errors; the SQL export still refuses', async () => {
    await loadDdlChecks(); // the dialect checks are a lazy chunk
    const model = badModel();
    const { project, diagram } = projectOf(model);
    const issues = validateActiveModel(project, diagram.id);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.map((i) => i.code).sort()).toEqual([
      'rel.column-name-duplicate',
      'rel.fk-column-missing',
      'rel.fk-relation-missing',
      'rel.fk-target-not-key',
      'rel.no-primary-key',
    ]);
    expect(issues.some((i) => i.code.startsWith('ddl.') && i.severity === 'error')).toBe(false);
    // without the de-duplication the same model reports the DDL twins as well
    const raw = [...validateProject(project, { modelId: model.id }), ...ddlIssues(model, 'postgresql')];
    expect(raw.filter((i) => i.severity === 'error').length).toBeGreaterThan(errors.length);
    const r = generateDdl(model, 'postgresql');
    expect(r.sql).toBe('');
    expect(r.issues.filter((i) => i.severity === 'error').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps DDL issues the model rules do not cover', async () => {
    await loadDdlChecks();
    const b = relationalBuilder('Long', 'postgresql');
    b.relation('t'.repeat(70), [{ name: 'id', type: 'INT' }], { pk: ['id'] });
    const { project, diagram } = projectOf(b.build());
    expect(validateActiveModel(project, diagram.id).some((i) => i.code === 'ddl.postgresql.identifier-too-long')).toBe(true);
  });
});

describe('explicit Validate waits for the dialect checks', () => {
  it('announces once, with the final result, after the lazy chunk arrived', async () => {
    vi.resetModules();
    const { editorStore: es } = await import('@/store');
    const { uiStore: ui } = await import('../uiStore');
    const { toolUi: tu } = await import('@/editor/tools/toolState');
    const v = await import('./validation');
    const { relationalBuilder: rb } = await import('@/model/builders');
    const { projectOf: po } = await import('@/validation/fixtures');
    const b = rb('Long', 'postgresql');
    b.relation('t'.repeat(70), [{ name: 'id', type: 'INT' }], { pk: ['id'] });
    const { project, diagram } = po(b.build());
    es.getState().loadProject(project);
    es.getState().setActiveDiagram(diagram.id);
    tu.setState({ announcement: '' });
    const first = v.runValidation(true);
    expect(first.some((i) => i.code.startsWith('ddl.'))).toBe(false); // model-only so far
    expect(tu.getState().announcement).toBe(''); // nothing announced yet
    await waitFor(() => expect(tu.getState().announcement).toMatch(/^Validation finished: /));
    expect(ui.getState().issues.some((i) => i.code === 'ddl.postgresql.identifier-too-long')).toBe(true);
    expect(tu.getState().announcement).not.toBe('Validation finished: no issues.');
  });
});

describe('A11Y-06 validation announcement and focus', () => {
  beforeEach(() => {
    editorStore.getState().newProject('Test');
    settingsStore.getState().setLocale('en');
    uiStore.setState({ issues: [], dock: null });
    toolUi.setState({ announcement: '' });
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('formats counts with plurals in both languages', () => {
    const mk = (severity: 'error' | 'warning' | 'info') => ({ id: severity, code: 'x', severity, title: '', explanation: '', suggestion: '', affected: [], modelId: 'm' });
    expect(validationAnnouncement([])).toBe('Validation finished: no issues.');
    expect(validationAnnouncement([mk('error'), mk('warning'), mk('warning')])).toBe('Validation finished: 1 error, 2 warnings, 0 notes.');
    settingsStore.getState().setLocale('zh');
    expect(validationAnnouncement([mk('error')])).toBe('检查完成：1 个错误，0 个警告，0 条提示。');
  });

  it('an explicit run announces through the live region; the automatic run stays silent', () => {
    runValidation(false);
    expect(toolUi.getState().announcement).toBe('');
    runValidation(true);
    expect(toolUi.getState().announcement).toMatch(/^Validation finished: /);
  });

  it('moves focus to the first issue row only after keyboard input', async () => {
    document.body.innerHTML = '<ul class="issues-list"><li><button class="issue-row" id="r1">a</button></li></ul><button id="other">o</button>';
    // an empty ER model has no issues, so force one through a keyless entity
    editorStore.getState().newProject('K');
    const st = editorStore.getState();
    const modelId = Object.values(st.project.models).find((m) => m.kind === 'er')!.id;
    const { addEntity } = await import('@/model/ops');
    st.commit('add', (p) => void addEntity(p, modelId, { name: 'Keyless' }));
    document.getElementById('other')!.focus();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    runValidation(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(document.activeElement?.id).toBe('other');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' }));
    runValidation(true);
    await waitFor(() => expect(document.activeElement?.id).toBe('r1'));
  });
});
