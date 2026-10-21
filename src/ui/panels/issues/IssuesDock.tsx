import { useEffect, useMemo, useRef, useState } from 'react';
import { runCommand } from '@/editor';
import { describeRef } from '@/model/queries';
import type { Id, Issue, RelationalModel, SemanticRef, Severity } from '@/model/types';
import { useT, tp, localizeIssue } from '@/i18n';
import { summarizeIssues } from '@/validation';
import { useEditorStore } from '@/store';
import { Badge, Button, EmptyState } from '../../components';
import { Icon } from '../../icons';
import { useUi } from '../../uiStore';
import { SEVERITIES, type FocusOutcome, filterIssues, findOtherDiagram, focusCanvas, focusIssueOnCanvas, showIssueInDiagram, sortIssues } from './issueActions';
import { BulkDataType } from '../properties/BulkDataType';
import './issues.css';

const ICON: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'info' };
const MAX_CHIPS = 4;

function affectedNames(project: Parameters<typeof describeRef>[0], refs: readonly SemanticRef[]): string[] {
  const seen = new Set<string>();
  for (const r of refs) {
    const name = describeRef(project, r);
    if (name) seen.add(name);
  }
  return [...seen];
}

/** The bottom-dock list of validation issues with severity filters, click-to-highlight and arrow-key navigation. */
export function IssuesDock() {
  const t = useT();
  const issues = useUi((s) => s.issues);
  const stale = useUi((s) => s.issuesStale);
  const focusedId = useUi((s) => s.focusedIssueId);
  const project = useEditorStore((s) => s.project);
  const activeDiagramId = useEditorStore((s) => s.activeDiagramId);
  const [shown, setShown] = useState<ReadonlySet<Severity>>(new Set(SEVERITIES));
  const [validating, setValidating] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  /** Roving tabindex: the row that last had focus is the tab stop, so Tab away and back returns to it. */
  const [roving, setRoving] = useState<Id | null>(null);

  const summary = useMemo(() => summarizeIssues(issues), [issues]);
  const visible = useMemo(() => sortIssues(filterIssues(issues, shown)), [issues, shown]);

  const toggle = (s: Severity): void => {
    setShown((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const validate = (): void => {
    setValidating(true);
    void runCommand('diagram.validate').finally(() => setValidating(false));
  };

  const rows = (): HTMLButtonElement[] => [...(list.current?.querySelectorAll<HTMLButtonElement>('button.issue-row') ?? [])];

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      focusCanvas();
      return;
    }
    const all = rows();
    const i = all.findIndex((r) => r === document.activeElement);
    let next: number | undefined;
    if (e.key === 'ArrowDown') next = Math.min(all.length - 1, i + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = all.length - 1;
    if (next === undefined || all.length === 0) return;
    e.preventDefault();
    all[next]?.focus();
  };

  // keep the focused issue visible when it changes from elsewhere (e.g. a canvas halo click)
  useEffect(() => {
    if (!focusedId) return;
    list.current?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(focusedId)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [focusedId]);

  const tabStop = visible.find((i) => i.id === roving)?.id ?? visible.find((i) => i.id === focusedId)?.id ?? visible[0]?.id;

  const header = (
    <div className="issues-head">
      <div className="issues-chips" role="group" aria-label={t('issuesPanel.filter')}>
        {SEVERITIES.map((s) => (
          <button key={s} type="button" className={`issues-chip issues-chip-${s}`} aria-pressed={shown.has(s)} onClick={() => toggle(s)} data-testid={`issues-chip-${s}`}>
            <Icon name={ICON[s]} size={14} />
            <span>{t(`issuesPanel.severity.${s}`)}</span>
            <span className="issues-chip-count">{summary[s]}</span>
          </button>
        ))}
      </div>
      <div className="issues-head-end">
        {stale ? (
          <Badge tone="warning" className="issues-stale">
            {t('issuesPanel.stale')}
          </Badge>
        ) : null}
        <Button size="sm" icon="validate" onClick={validate} loading={validating} data-testid="issues-validate">
          {t('issuesPanel.validate')}
        </Button>
      </div>
    </div>
  );

  if (issues.length === 0) {
    return (
      <div className="issues-dock">
        {header}
        <EmptyState icon="check" title={t('issuesPanel.emptyTitle')} description={t('issuesPanel.emptyDesc')} className="issues-empty" />
      </div>
    );
  }

  return (
    <div className="issues-dock" data-testid="issues-dock">
      {header}
      {visible.length === 0 ? (
        <p className="issues-none-shown">{t('issuesPanel.noneShown')}</p>
      ) : (
        <ul ref={list} className="issues-list" aria-label={tp('issuesPanel.listLabel', visible.length)} onKeyDown={onKeyDown}>
          {visible.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              expanded={issue.id === focusedId}
              tabStop={issue.id === tabStop}
              onRowFocus={() => setRoving(issue.id)}
              names={affectedNames(project, issue.affected)}
              otherDiagram={issue.id === focusedId ? findOtherDiagram(project, activeDiagramId, issue) : undefined}
              onFocusIssue={() => focusIssueOnCanvas(issue)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  expanded,
  tabStop,
  onRowFocus,
  names,
  otherDiagram,
  onFocusIssue,
}: {
  issue: Issue;
  expanded: boolean;
  tabStop: boolean;
  onRowFocus: () => void;
  names: string[];
  otherDiagram: { id: Id; name: string } | undefined;
  onFocusIssue: () => FocusOutcome;
}) {
  const t = useT();
  const text = localizeIssue(issue);
  const [outcome, setOutcome] = useState<'selected' | 'other-model' | 'none' | null>(null);
  const showOther = expanded && (outcome === 'other-model' || (outcome === null && !!otherDiagram)) && otherDiagram;
  const project = useEditorStore((s) => s.project);
  /** "Column without a data type" issues (any dialect) get the bulk fix for the tables they name. */
  const bulkModel = expanded && /(^|\.)missing-type$/.test(issue.code) ? (project.models[issue.modelId]?.kind === 'relational' ? (project.models[issue.modelId] as RelationalModel) : undefined) : undefined;
  const bulkRelations = issue.affected.flatMap((a) => (a.kind === 'relation' ? [a.id] : a.kind === 'column' ? [a.relationId] : []));
  const detailId = `issue-detail-${issue.id}`;
  const activate = (): void => setOutcome(onFocusIssue());
  return (
    <li className={`issues-item issues-item-${issue.severity}${expanded ? ' is-open' : ''}`}>
      <button
        type="button"
        className="issue-row"
        data-issue-id={issue.id}
        data-severity={issue.severity}
        aria-current={expanded ? 'true' : undefined}
        aria-expanded={expanded}
        aria-controls={expanded ? detailId : undefined}
        tabIndex={tabStop ? 0 : -1}
        onFocus={onRowFocus}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            activate();
          }
        }}
      >
        <Icon name={ICON[issue.severity]} size={16} className={`issue-icon issue-icon-${issue.severity}`} label={t(`issuesPanel.severity.${issue.severity}`)} />
        <span className="issue-main">
          <span className="issue-title">{text.title}</span>
          {names.length > 0 ? (
            <span className="issue-refs">
              {names.slice(0, MAX_CHIPS).map((n) => (
                <span key={n} className="issue-ref">
                  {n}
                </span>
              ))}
              {names.length > MAX_CHIPS ? <span className="issue-ref issue-ref-more">{t('issuesPanel.more', { count: names.length - MAX_CHIPS })}</span> : null}
            </span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <div className="issue-detail" id={detailId}>
          <p className="issue-expl">{text.explanation}</p>
          {text.suggestion ? (
            <p className="issue-sugg">
              <strong>{t('issuesPanel.suggestion')}</strong> {text.suggestion}
            </p>
          ) : null}
          {bulkModel ? <BulkDataType model={bulkModel} relationIds={bulkRelations} testId="issue-bulk-type" /> : null}
          {showOther && otherDiagram ? (
            <Button size="sm" icon="sheet" onClick={() => showIssueInDiagram(issue, otherDiagram.id)} data-testid="issue-show-in">
              {t('issuesPanel.showIn', { name: otherDiagram.name })}
            </Button>
          ) : outcome === 'none' ? (
            <p className="issue-note">{t('issuesPanel.notOnSheet')}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
