import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyEvent } from 'react';
import { t } from '@/i18n';
import type { Viewport } from '@/model/types';
import type { EditSpec } from './editSpec';

export interface InlineEditProps {
  spec: EditSpec;
  viewport: Viewport;
  /** `nav`: Tab / Shift+Tab pressed (commit and move to the next / previous cell). */
  onDone(text: string, nav: 'next' | 'prev' | null): void;
  onCancel(): void;
}

/** The HTML <input> shown over a label. Positioned and font-matched from the scene label rect x viewport. */
export function InlineEdit({ spec, viewport, onDone, onCancel }: InlineEditProps) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  useEffect(() => {
    finished.current = false;
  }, [spec]);

  const finish = (nav: 'next' | 'prev' | null): void => {
    if (finished.current) return;
    finished.current = true;
    onDone(ref.current?.value ?? spec.value, nav);
  };
  const cancel = (): void => {
    if (finished.current) return;
    finished.current = true;
    onCancel();
  };

  const z = viewport.zoom;
  const fontPx = Math.max(11, spec.font.size * z);
  const h = Math.max(22, spec.rect.h * z, fontPx * 1.6);
  const w = Math.max(64, spec.rect.w * z + 16);
  const cx = (spec.rect.x + spec.rect.w / 2) * z + viewport.x;
  const left = spec.align === 'start' ? spec.rect.x * z + viewport.x : cx - w / 2;
  const top = (spec.rect.y + spec.rect.h / 2) * z + viewport.y - h / 2;

  const onKey = (ev: ReactKeyEvent<HTMLInputElement>): void => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finish(null);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      finish(spec.columnId ? (ev.shiftKey ? 'prev' : 'next') : null);
    }
  };

  return (
    <input
      ref={ref}
      className="sc-inline-input"
      type="text"
      spellCheck={false}
      autoComplete="off"
      aria-label={t('editor.inline.label')}
      defaultValue={spec.value}
      placeholder={spec.kind === 'role' ? t('editor.role.placeholder') : undefined}
      data-edit-kind={spec.kind}
      style={{
        left,
        top,
        width: w,
        height: h,
        fontFamily: spec.font.family,
        fontSize: fontPx,
        fontStyle: spec.font.style ?? 'normal',
        fontWeight: spec.font.weight ?? 'normal',
        textAlign: spec.align === 'start' ? 'left' : spec.align === 'end' ? 'right' : 'center',
      }}
      onKeyDown={onKey}
      onBlur={() => finish(null)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    />
  );
}
