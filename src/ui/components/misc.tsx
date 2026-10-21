import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';
import { useT } from '@/i18n';
import { Icon } from '../icons';

export function VisuallyHidden({ children, as: Tag = 'span', ...rest }: { children: ReactNode; as?: ElementType } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag className="sc-visually-hidden" {...rest}>
      {children}
    </Tag>
  );
}

export type BadgeTone = 'neutral' | 'key' | 'fk' | 'danger' | 'warning' | 'info' | 'success';

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`sc-badge sc-badge-${tone}${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function Separator({ orientation = 'horizontal', className }: { orientation?: 'horizontal' | 'vertical'; className?: string }) {
  return <div role="separator" aria-orientation={orientation} className={`sc-sep sc-sep-${orientation}${className ? ` ${className}` : ''}`} />;
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  const t = useT();
  return (
    <span className="sc-spinner" role="status" style={{ width: size, height: size } as CSSProperties}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="8" cy="8" r="6" opacity="0.25" />
        <path d="M8 2a6 6 0 016 6" />
      </svg>
      <VisuallyHidden>{label ?? t('ui.loading')}</VisuallyHidden>
    </span>
  );
}

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: ReactNode;
  /** Call-to-action buttons. */
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={`sc-empty${className ? ` ${className}` : ''}`}>
      {icon ? <Icon name={icon} size={24} className="sc-empty-icon" /> : null}
      <p className="sc-empty-title">{title}</p>
      {description ? <p className="sc-empty-desc">{description}</p> : null}
      {actions ? <div className="sc-empty-actions">{actions}</div> : null}
    </div>
  );
}
