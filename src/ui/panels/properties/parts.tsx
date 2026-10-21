/** Small building blocks shared by every properties form. Composition over the shell's accessible primitives. */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { Issue } from '@/model/types';
import { worstSeverity } from '@/validation';
import { localizeIssue, tp, useT } from '@/i18n';
import { Field, Tooltip } from '../../components';
import { Icon } from '../../icons';
import { focusIssue, useEditError, clearEditError } from './edit';

// ----- layout ----------------------------------------------------------------------------------------------------------

export function Section({ title, children, actions, collapsible, defaultOpen = true, testId }: { title: string; children: ReactNode; actions?: ReactNode; collapsible?: boolean; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="pp-section" data-testid={testId}>
      <div className="pp-section-head">
        <h3 className="pp-section-title">
          {collapsible ? (
            <button type="button" className="pp-section-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
        {actions ? <div className="pp-section-actions">{actions}</div> : null}
      </div>
      {open ? (
        <div id={id} className="pp-section-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' | 'danger' | 'info' }) {
  return <p className={`pp-note pp-note-${tone}`}>{children}</p>;
}

/** Inline message for a refused edit (an op threw). Nothing was changed. */
export function EditError() {
  const t = useT();
  const message = useEditError();
  if (!message) return null;
  return (
    <div className="pp-error" role="alert" data-testid="edit-error">
      <Icon name="error" size={14} />
      <span>{message}</span>
      <button type="button" className="pp-error-close" aria-label={t('properties.dismiss')} onClick={clearEditError}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

// ----- text fields that commit on blur / Enter ---------------------------------------------------------------------------

export interface CommitInputProps {
  label: ReactNode;
  /** Accessible name when it must differ from the visible label (adds context such as the participant number). */
  ariaLabel?: string;
  value: string;
  /** Return false when the edit was refused: the field reverts. */
  onCommit: (value: string) => boolean | void;
  required?: boolean;
  mono?: boolean;
  placeholder?: string;
  list?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  description?: ReactNode;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Extra inline style class on the input (key / foreign key marks). */
  inputClassName?: string;
  /** Trim before comparing and committing (default true). */
  trim?: boolean;
}

export function CommitInput({ label, ariaLabel, value, onCommit, required, mono, placeholder, list, hideLabel, disabled, description, className, inputRef, onKeyDown, inputClassName, trim = true }: CommitInputProps) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>();
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = (): void => {
    const next = trim ? draft.trim() : draft;
    if (required && next === '') {
      setError(t('properties.required'));
      setDraft(value);
      return;
    }
    setError(undefined);
    if (next === value) {
      setDraft(value);
      return;
    }
    const ok = onCommit(next);
    if (ok === false) setDraft(value);
    else setDraft(next);
  };
  return (
    <Field label={label} hideLabel={hideLabel} className={className} description={description} error={error}>
      {(c) => (
        <input
          {...c}
          ref={inputRef}
          aria-label={ariaLabel}
          type="text"
          className={`sc-input${mono ? ' is-mono' : ''}${inputClassName ? ` ${inputClassName}` : ''}`}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          list={list}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(undefined);
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              // only a pending draft is reverted (and swallowed); otherwise Escape bubbles so a surrounding dialog can close
              if (draft !== value || error) {
                e.stopPropagation();
                setDraft(value);
                setError(undefined);
              }
            }
          }}
        />
      )}
    </Field>
  );
}

export function CommitTextarea({ label, value, onCommit, rows = 3, placeholder }: { label: string; value: string; onCommit: (v: string) => boolean | void; rows?: number; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <Field label={label}>
      {(c) => (
        <textarea
          {...c}
          className="sc-input sc-textarea"
          rows={rows}
          value={draft}
          placeholder={placeholder}
          onFocus={() => (focused.current = true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            focused.current = false;
            if (draft === value) return;
            if (onCommit(draft) === false) setDraft(value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && draft !== value) {
              e.stopPropagation();
              setDraft(value);
            }
          }}
        />
      )}
    </Field>
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const expandHex = (v: string): string => (v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v);

/**
 * Colour field whose native picker commits ONCE when the picker closes (the shell's ColorField reports every drag tick,
 * which would flood the undo history). The hex box commits on blur / Enter; empty means "inherit".
 */
export function ColorControl({ label, value, onCommit, placeholder }: { label: string; value: string | undefined; onCommit: (hex: string | undefined) => boolean | void; placeholder?: string }) {
  const [text, setText] = useState(value ?? '');
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  useEffect(() => setText(value ?? ''), [value]);
  const pickerValue = value && HEX.test(value) ? expandHex(value) : '#000000';
  useEffect(() => {
    if (picker.current) picker.current.value = pickerValue;
  }, [pickerValue]);
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const handler = (): void => void latest.current(el.value);
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);
  return (
    <Field label={label}>
      {(c) => (
        <span className="sc-color">
          <input ref={picker} type="color" aria-label={`${label} (picker)`} className="sc-color-swatch" data-empty={value ? undefined : ''} defaultValue={pickerValue} />
          <input
            {...c}
            type="text"
            className="sc-input is-mono"
            value={text}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const v = text.trim();
              if (v === '') {
                if (value !== undefined) onCommit(undefined);
              } else if (HEX.test(v)) {
                if (v !== value) onCommit(v);
              } else setText(value ?? '');
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </span>
      )}
    </Field>
  );
}

// ----- compact controls ------------------------------------------------------------------------------------------------

/** Small toggle with a text label (PK, NN, UQ, ...). `title` explains the abbreviation. */
export function ToggleChip({ pressed, onToggle, children, title, disabled, tone = 'neutral', label }: { pressed: boolean; onToggle: (next: boolean) => void; children: ReactNode; title: string; disabled?: boolean; tone?: 'neutral' | 'key' | 'fk'; label: string }) {
  // WCAG 2.5.3: the accessible name must contain the visible text ("PK, Primary key")
  const name = typeof children === 'string' && !label.toLowerCase().includes(children.toLowerCase()) ? `${children}, ${label}` : label;
  return (
    <Tooltip label={title} placement="top" describe={false}>
      <button type="button" className={`pp-chip pp-chip-${tone}${pressed ? ' is-on' : ''}`} aria-pressed={pressed} aria-label={name} aria-disabled={disabled || undefined} onClick={() => !disabled && onToggle(!pressed)}>
        {children}
      </button>
    </Tooltip>
  );
}

// ----- issues ----------------------------------------------------------------------------------------------------------

const SEVERITY_ICON = { error: 'error', warning: 'warning', info: 'info' } as const;

export function IssueBadges({ issues }: { issues: readonly Issue[] }) {
  const t = useT();
  if (issues.length === 0) return null;
  return (
    <ul className="pp-issues" aria-label={t('properties.issues')} data-testid="issue-badges">
      {issues.map((issue) => {
        const text = localizeIssue(issue);
        return (
          <li key={issue.id}>
            <button type="button" className={`pp-issue pp-issue-${issue.severity}`} title={`${text.explanation} ${text.suggestion}`} onClick={() => focusIssue(issue)}>
              <Icon name={SEVERITY_ICON[issue.severity]} size={14} />
              <span>{text.title}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Tiny severity marker next to a list row; clicking focuses the worst issue. */
export function IssueDot({ issues }: { issues: readonly Issue[] }) {
  useT(); // re-render on locale change (tp reads the current locale)
  const worst = worstSeverity(issues as Issue[]);
  if (!worst) return null;
  const first = issues.find((i) => i.severity === worst) ?? issues[0]!;
  const text = localizeIssue(first);
  return (
    <button type="button" className={`pp-dot pp-issue-${worst}`} aria-label={tp('properties.issueDot', issues.length, { title: text.title })} title={text.title} onClick={() => focusIssue(first)}>
      <Icon name={SEVERITY_ICON[worst]} size={14} />
    </button>
  );
}

/** One datalist of common SQL types, shared by every data-type input (`list={SQL_TYPES_ID}`). */
export const SQL_TYPES_ID = 'pp-sql-types';
export const SQL_TYPES = ['INTEGER', 'BIGINT', 'SMALLINT', 'VARCHAR(50)', 'VARCHAR(255)', 'CHAR(10)', 'TEXT', 'BOOLEAN', 'DATE', 'TIME', 'TIMESTAMP', 'NUMERIC(10,2)', 'DECIMAL(10,2)', 'REAL', 'DOUBLE PRECISION', 'UUID', 'JSON', 'BLOB'];
export function SqlTypeList() {
  return (
    <datalist id={SQL_TYPES_ID}>
      {SQL_TYPES.map((x) => (
        <option key={x} value={x} />
      ))}
    </datalist>
  );
}
