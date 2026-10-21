/** Small pieces shared by the content dialogs and the SQL dock. */
import { useEffect, useState, type ReactNode } from 'react';
import { localizeIssue } from '@/i18n';
import { describeRef } from '@/model/queries';
import type { Issue, Project, SemanticRef, Severity } from '@/model/types';
import { Icon } from '../../icons';
import './dialogs.css';

/** Value that follows `value` after it has been stable for `ms` (the first value is returned immediately). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Copy text to the system clipboard; falls back to a hidden textarea. Resolves false when both fail. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export const ICON_FOR: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'info' };

export function SeverityIcon({ severity, label }: { severity: Severity; label?: string }) {
  return <Icon name={ICON_FOR[severity]} size={16} className={`dlg-sev dlg-sev-${severity}`} label={label} />;
}

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';
const NOTICE_ICON: Record<NoticeTone, string> = { info: 'info', warning: 'warning', danger: 'error', success: 'check' };

/** Inline notice. `danger` is announced assertively (role=alert), the rest politely. */
export function Notice({ tone = 'info', title, children, testId }: { tone?: NoticeTone; title?: string; children?: ReactNode; testId?: string }) {
  return (
    <div className={`dlg-notice dlg-notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId}>
      <Icon name={NOTICE_ICON[tone]} size={16} className="dlg-notice-icon" />
      <div className="dlg-notice-body">
        {title ? <p className="dlg-notice-title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** A list of localized issues (title, explanation, affected element names). `onPick` turns the pickable names into buttons. */
export function IssueList({
  issues,
  project,
  className,
  onPick,
  pickable,
}: {
  issues: readonly Issue[];
  project?: Project;
  className?: string;
  onPick?: (ref: SemanticRef) => void;
  pickable?: (ref: SemanticRef) => boolean;
}) {
  return (
    <ul className={`dlg-issues${className ? ` ${className}` : ''}`}>
      {issues.map((issue) => {
        const text = localizeIssue(issue);
        const seen = new Set<string>();
        const refs = project
          ? issue.affected
              .map((ref) => ({ ref, name: describeRef(project, ref) }))
              .filter(({ name }) => (name && !seen.has(name) ? (seen.add(name), true) : false))
              .slice(0, 6)
          : [];
        return (
          <li key={issue.id} className="dlg-issue" data-severity={issue.severity}>
            <SeverityIcon severity={issue.severity} label={issue.severity} />
            <div>
              <p className="dlg-issue-title">{text.title}</p>
              <p className="dlg-issue-text">{text.explanation}</p>
              {text.suggestion ? <p className="dlg-issue-text dlg-muted">{text.suggestion}</p> : null}
              {refs.length > 0 ? (
                <p className="dlg-issue-refs">
                  {refs.map(({ ref, name }) =>
                    onPick && (!pickable || pickable(ref)) ? (
                      <button key={name} type="button" className="dlg-chip dlg-chip-btn" onClick={() => onPick(ref)}>
                        {name}
                      </button>
                    ) : (
                      <span key={name} className="dlg-chip">
                        {name}
                      </span>
                    ),
                  )}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function plural(n: number): 'one' | 'other' {
  return n === 1 ? 'one' : 'other';
}
