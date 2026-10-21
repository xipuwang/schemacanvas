import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../icons';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}

/** `role=switch` toggle; Space/Enter toggle (native button semantics). */
export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <div className="sc-switch-row">
      <button type="button" role="switch" id={sid} aria-checked={checked} aria-labelledby={`${sid}-l`} aria-describedby={description ? `${sid}-d` : undefined} disabled={disabled} className={`sc-switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="sc-switch-thumb" />
      </button>
      <span className="sc-switch-text">
        <label id={`${sid}-l`} htmlFor={sid} className="sc-switch-label">
          {label}
        </label>
        {description ? (
          <span id={`${sid}-d`} className="sc-field-desc">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  label: ReactNode;
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, checked, indeterminate, onChange, description, className, id, ...rest }, ref) {
  const auto = useId();
  const cid = id ?? auto;
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <div className={`sc-check${className ? ` ${className}` : ''}`}>
      <span className="sc-check-box">
        <input
          {...rest}
          id={cid}
          ref={(n) => {
            inner.current = n;
            if (typeof ref === 'function') ref(n);
            else if (ref) ref.current = n;
          }}
          type="checkbox"
          checked={checked}
          aria-describedby={description ? `${cid}-d` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="sc-check-mark" aria-hidden="true">
          {indeterminate ? <Icon name="minus" size={12} /> : checked ? <Icon name="check" size={12} /> : null}
        </span>
      </span>
      <span className="sc-switch-text">
        <label htmlFor={cid} className="sc-switch-label">
          {label}
        </label>
        {description ? (
          <span id={`${cid}-d`} className="sc-field-desc">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
});
