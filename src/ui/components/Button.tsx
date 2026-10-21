import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../icons';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon name. */
  icon?: string;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`sc-btn sc-btn-${variant} sc-btn-${size}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children !== undefined && children !== null ? <span className="sc-btn-label">{children}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Required: the accessible name (also the tooltip text). */
  label: string;
  icon: string;
  shortcut?: string;
  size?: 'sm' | 'md';
  /** Toggle state (`aria-pressed`) — rendered with the key-gold "on" treatment. */
  pressed?: boolean;
  variant?: 'ghost' | 'secondary';
  /** Extra content after the icon (e.g. a chevron for menu triggers). */
  children?: ReactNode;
  noTooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, shortcut, size = 'md', pressed, variant = 'ghost', className, children, noTooltip, type = 'button', ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={`sc-iconbtn sc-iconbtn-${size} sc-iconbtn-${variant}${pressed ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
  if (noTooltip) return button;
  return (
    <Tooltip label={label} shortcut={shortcut} describe={false}>
      {button}
    </Tooltip>
  );
});
