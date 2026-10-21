/** Validation flow: the Validate command and the debounced live re-validation. */
import { announce } from '@/editor/tools/toolState';
import { t, tp } from '@/i18n';
import { summarizeIssues } from '@/validation';
import { validateProject } from '@/validation';
import { editorStore } from '@/store';
import type { Issue, Project } from '@/model/types';
import { uiStore } from '../uiStore';
import { shellStore } from './shellStore';

/**
 * The dialect checks (src/sql/ddl, ~30 KB) are not needed for the first paint, so they load on first use: until the module
 * has arrived `validateActiveModel` reports the model rules only and `runValidation` re-runs once it has.
 */
type DdlChecks = Pick<typeof import('@/sql/ddl'), 'ddlIssues'> & Pick<typeof import('@/sql/duplicates'), 'dropDuplicatedDdlIssues'>;
let ddlChecks: DdlChecks | undefined;
let ddlLoading: Promise<void> | undefined;

/** Load the dialect checks (idempotent). A failed download is retried on the next call. */
export function loadDdlChecks(): Promise<void> {
  ddlLoading ??= Promise.all([import('@/sql/ddl'), import('@/sql/duplicates')]).then(
    ([ddl, dup]) => {
      ddlChecks = { ddlIssues: ddl.ddlIssues, dropDuplicatedDdlIssues: dup.dropDuplicatedDdlIssues };
    },
    (error: unknown) => {
      ddlLoading = undefined;
      throw error;
    },
  );
  return ddlLoading;
}

/** Issues of the model viewed by the active diagram (+ dialect issues for relational models once `loadDdlChecks` resolved; model rules only before). Reads module state, otherwise side-effect free. */
export function validateActiveModel(project: Project, activeDiagramId: string | null | undefined): Issue[] {
  const diagram = activeDiagramId ? project.diagrams[activeDiagramId] : undefined;
  if (!diagram) return [];
  const model = project.models[diagram.modelId];
  if (!model) return [];
  const issues = validateProject(project, { modelId: model.id });
  // One entry per problem: a structural DDL issue that restates a rel.* rule is dropped (the SQL export still refuses on it).
  if (model.kind === 'relational' && ddlChecks) issues.push(...ddlChecks.dropDuplicatedDdlIssues(issues, ddlChecks.ddlIssues(model, model.dialect)));
  return issues;
}

/** Run validation now and publish to the uiStore. `openDock` also reveals the issues dock and announces the result (for a relational model whose dialect checks are still loading: once they arrived, or with an info toast when they cannot be loaded). */
export function runValidation(openDock: boolean): Issue[] {
  const { project, activeDiagramId } = editorStore.getState();
  const issues = validateActiveModel(project, activeDiagramId);
  const diagram = activeDiagramId ? project.diagrams[activeDiagramId] : undefined;
  const ui = uiStore.getState();
  ui.setIssues(issues);
  if (openDock) ui.setDock('issues');
  const pending = !ddlChecks && diagram && project.models[diagram.modelId]?.kind === 'relational';
  const finish = (final: readonly Issue[]): void => {
    if (!openDock) return;
    announce(validationAnnouncement(final));
    if (lastInputWasKeyboard && final.length > 0) setTimeout(focusFirstIssueRow, 30);
  };
  if (!pending) {
    finish(issues);
    return issues;
  }
  // First relational validation of the session: the dialect checks are still downloading. The model-only result is shown
  // right away, but an explicit Validate announces only the FINAL result (after the dialect issues were added).
  void loadDdlChecks().then(
    () => finish(runValidation(false)),
    () => {
      if (openDock) {
        uiStore.getState().pushToast({ kind: 'info', message: t('issues.word.dialectChecksUnavailable') });
        finish(issues);
      }
    },
  );
  return issues;
}

/** "Validation finished: 2 errors, 3 warnings, 0 notes." / "Validation finished: no issues." */
export function validationAnnouncement(issues: readonly Issue[]): string {
  const sum = summarizeIssues(issues);
  if (sum.total === 0) return t('issues.word.validationClean');
  const count = (key: string, n: number): string => tp(key, n);
  return t('issues.word.validationDone', {
    errors: count('issues.word.nErrors', sum.error),
    warnings: count('issues.word.nWarnings', sum.warning),
    notes: count('issues.word.nNotes', sum.info),
  });
}

/** Keyboard modality, so an explicit Validate from the keyboard moves focus into the dock but a mouse click does not. */
let lastInputWasKeyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (lastInputWasKeyboard = true), true);
  window.addEventListener('pointerdown', () => (lastInputWasKeyboard = false), true);
}

/** Focus the first issue row once the dock has rendered it (it mounts after the store update). */
function focusFirstIssueRow(attempt = 0): void {
  if (typeof document === 'undefined') return;
  const row = document.querySelector<HTMLElement>('.issues-list button.issue-row');
  if (row) row.focus();
  else if (attempt < 20) setTimeout(() => focusFirstIssueRow(attempt + 1), 25);
}

/** Re-validate 400ms after the model (or the active diagram) changes. Returns the unsubscribe function. */
export function startLiveValidation(delayMs = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastModels = editorStore.getState().project.models;
  let lastActive = editorStore.getState().activeDiagramId;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => runValidation(false), delayMs);
  };
  const unsubStore = editorStore.subscribe((s) => {
    if (s.project.models === lastModels && s.activeDiagramId === lastActive) return;
    lastModels = s.project.models;
    lastActive = s.activeDiagramId;
    if (shellStore.getState().liveValidation) schedule();
    else uiStore.getState().markIssuesStale();
  });
  const unsubShell = shellStore.subscribe((s, prev) => {
    if (s.liveValidation && !prev.liveValidation) schedule();
  });
  if (shellStore.getState().liveValidation) schedule();
  void loadDdlChecks().catch(() => undefined); // fetched right after the first paint, long before anyone presses Validate
  return () => {
    clearTimeout(timer);
    unsubStore();
    unsubShell();
  };
}
