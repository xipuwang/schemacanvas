import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { IconButton } from './Button';
import { focusableIn, trapTab, useReturnFocus, useScrollLock } from './focus';

export interface DialogProps {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Footer actions (right aligned). */
  footer?: ReactNode;
  children?: ReactNode;
  /** Element to focus first; defaults to the first focusable control in the body, then the dialog. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Hide the header close button (e.g. confirm dialogs). */
  hideClose?: boolean;
  /** Clicking the backdrop closes (default true). */
  dismissOnBackdrop?: boolean;
  className?: string;
  /** Arrange header/footer fixed with a scrolling body (default true). */
  bodyClassName?: string;
}

/** First sensible control: the checked radio of a radiogroup (never a roving tabindex=-1 radio), else the first tabbable. */
function initialTarget(root: HTMLElement): HTMLElement | undefined {
  return focusableIn(root).find((el) => el.getAttribute('tabindex') !== '-1');
}

export function Dialog({ title, description, onClose, size = 'md', footer, children, initialFocusRef, hideClose, dismissOnBackdrop = true, className, bodyClassName }: DialogProps) {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useScrollLock();
  useReturnFocus();

  useEffect(() => {
    const target =
      initialFocusRef?.current ?? (body.current ? initialTarget(body.current) : undefined) ?? (root.current ? focusableIn(root.current).find((el) => el.dataset.dialogClose === undefined) : undefined) ?? root.current;
    target?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.stopPropagation();
      e.preventDefault();
      onClose();
      return;
    }
    if (root.current) trapTab(e, root.current);
  };

  return createPortal(
    <div
      className="sc-dialog-backdrop"
      onPointerDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`sc-dialog sc-dialog-${size}${className ? ` ${className}` : ''}`}
        onKeyDown={onKeyDown}
      >
        <div className="sc-dialog-header">
          <h2 id={titleId} className="sc-dialog-title">
            {title}
          </h2>
          {hideClose ? null : <IconButton label={t('common.close')} icon="close" size="sm" onClick={onClose} data-dialog-close="" />}
        </div>
        {description ? (
          <p id={descId} className="sc-dialog-desc">
            {description}
          </p>
        ) : null}
        <div ref={body} className={`sc-dialog-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>
          {children}
        </div>
        {footer ? <div className="sc-dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
