import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from '../icons';

export interface FieldChrome {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  /** Visually hide the label (it is still the accessible name). */
  hideLabel?: boolean;
  className?: string;
}

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

/** Layout helper: label, control (render prop receives id/aria wiring), description and error text. */
export function Field({ label, description, error, hideLabel, className, children }: FieldChrome & { children: (control: FieldControlProps) => ReactNode }) {
  const id = useId();
  const descId = description ? `${id}-d` : undefined;
  const errId = error ? `${id}-e` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`sc-field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id} className={hideLabel ? 'sc-visually-hidden' : 'sc-field-label'}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {description ? (
        <p id={descId} className="sc-field-desc">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="sc-field-error">
          <Icon name="error" size={14} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & FieldChrome & { mono?: boolean };

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField({ label, description, error, hideLabel, className, mono, ...rest }, ref) {
  return (
    <Field label={label} description={description} error={error} hideLabel={hideLabel} className={className}>
      {(c) => <input ref={ref} type="text" className={`sc-input${mono ? ' is-mono' : ''}`} {...c} {...rest} />}
    </Field>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldChrome & { mono?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, description, error, hideLabel, className, mono, rows = 4, ...rest }, ref) {
  return (
    <Field label={label} description={description} error={error} hideLabel={hideLabel} className={className}>
      {(c) => <textarea ref={ref} rows={rows} className={`sc-input sc-textarea${mono ? ' is-mono' : ''}`} {...c} {...rest} />}
    </Field>
  );
});

export interface NumberFieldProps extends FieldChrome {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  suffix?: string;
}

/** Number input that keeps free-form text while typing and commits (clamped) on blur / Enter; ArrowUp/Down step. */
export function NumberField({ value, onChange, min, max, step = 1, disabled, placeholder, suffix, ...chrome }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value === undefined ? '' : String(value));
  }, [value]);
  const clamp = (n: number): number => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (raw: string): void => {
    editing.current = false;
    if (raw.trim() === '') {
      setText(value === undefined ? '' : String(value));
      if (value !== undefined && placeholder !== undefined) onChange(undefined);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setText(value === undefined ? '' : String(value));
      return;
    }
    const c = clamp(n);
    setText(String(c));
    if (c !== value) onChange(c);
  };
  return (
    <Field {...chrome}>
      {(c) => (
        <span className="sc-input-wrap">
          <input
            {...c}
            type="text"
            inputMode="decimal"
            className="sc-input sc-number"
            disabled={disabled}
            placeholder={placeholder}
            value={text}
            onFocus={() => (editing.current = true)}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const base = Number(text);
                const n = clamp((Number.isFinite(base) ? base : (value ?? 0)) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1));
                setText(String(n));
                onChange(n);
              }
            }}
          />
          {suffix ? <span className="sc-input-suffix" aria-hidden="true">{suffix}</span> : null}
        </span>
      )}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> &
  FieldChrome & { value: string; options: SelectOption[]; onChange: (value: string) => void };

/** Styled native `<select>`: free keyboard + screen-reader behaviour. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, description, error, hideLabel, className, options, value, onChange, ...rest }, ref) {
  return (
    <Field label={label} description={description} error={error} hideLabel={hideLabel} className={className}>
      {(c) => (
        <span className="sc-select-wrap">
          <select ref={ref} className="sc-input sc-select" value={value} onChange={(e) => onChange(e.target.value)} {...c} {...rest}>
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" className="sc-select-caret" />
        </span>
      )}
    </Field>
  );
});

export interface ColorFieldProps extends FieldChrome {
  value: string | undefined;
  onChange: (hex: string | undefined) => void;
  disabled?: boolean;
  /** Placeholder text/swatch when the value is undefined (inherit). */
  placeholder?: string;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Native colour picker + hex text input; invalid hex is rejected on blur. */
export function ColorField({ value, onChange, disabled, placeholder, ...chrome }: ColorFieldProps) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const picker = value && HEX.test(value) ? (value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value) : '#000000';
  return (
    <Field {...chrome}>
      {(c) => (
        <span className="sc-color">
          <input type="color" aria-label={typeof chrome.label === 'string' ? chrome.label : undefined} className="sc-color-swatch" disabled={disabled} value={picker} onChange={(e) => onChange(e.target.value)} />
          <input
            {...c}
            type="text"
            className="sc-input is-mono"
            disabled={disabled}
            placeholder={placeholder}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (text.trim() === '') {
                if (value !== undefined) onChange(undefined);
              } else if (HEX.test(text.trim())) {
                if (text.trim() !== value) onChange(text.trim());
              } else setText(value ?? '');
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </span>
      )}
    </Field>
  );
}
