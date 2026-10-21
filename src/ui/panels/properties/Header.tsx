/**
 * The panel header speaks the notation (docs/DESIGN.md): a selected relation is a live miniature single-row table whose cells
 * carry the same marks as the sheet (PK underlined + amber, FK italic + sky, PK+FK both); entities, relationships and
 * attributes show a glyph drawn by the real notation builders.
 */
import { useMemo, type ReactNode } from 'react';
import { columnRole, type ColumnRole } from '@/model/queries';
import type { PreviewSpec } from '../library/items';
import { previewFor } from '../library/previews';
import type { Relation, RelationalModel } from '@/model/types';
import { useSettings } from '@/store/settings';
import { useT } from '@/i18n';
import { useResolvedTheme } from '../../theme/useResolvedTheme';

export function MiniTable({ model, relation, highlightColumnId }: { model: RelationalModel; relation: Relation; highlightColumnId?: string }) {
  const t = useT();
  const cells = relation.columns.map((c) => ({ id: c.id, name: c.name || ' ', role: columnRole(model, relation.id, c.id) as ColumnRole }));
  const summary = `${relation.name}(${relation.columns.map((c) => c.name).join(', ')})`;
  return (
    <div className="pp-mini" data-testid="mini-table">
      <div className="pp-mini-name">{relation.name || ' '}</div>
      {/* focusable so a long single row can be scrolled with the keyboard */}
      <div className="pp-mini-scroll" role="group" tabIndex={0} aria-label={t('properties.mini.label', { summary })}>
        <div className="pp-mini-row">
          {cells.length === 0 ? <span className="pp-mini-empty">{t('properties.mini.empty')}</span> : null}
          {cells.map((c) => (
            <span key={c.id} data-role={c.role} className={`pp-mini-cell is-${c.role.replace('+', '-')}${highlightColumnId === c.id ? ' is-picked' : ''}`}>
              {c.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Glyph({ spec, label }: { spec: PreviewSpec; label?: string }) {
  const theme = useResolvedTheme();
  const locale = useSettings((s) => s.locale);
  const preview = useMemo(() => previewFor(spec, 'chen', theme, locale), [spec, theme, locale]);
  if (!preview) return null;
  return <div className="pp-glyph" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: preview.svg }} />;
}

export function GlyphHeader({ spec, title, kind }: { spec: PreviewSpec; title: string; kind: ReactNode }) {
  return (
    <div className="pp-head">
      <Glyph spec={spec} />
      <div className="pp-head-text">
        <div className="pp-head-kind">{kind}</div>
        <div className="pp-head-title" title={title}>
          {title}
        </div>
      </div>
    </div>
  );
}

export function TableHeader({ model, relation, kind, highlightColumnId }: { model: RelationalModel; relation: Relation; kind: ReactNode; highlightColumnId?: string }) {
  return (
    <div className="pp-head pp-head-table">
      <div className="pp-head-kind">{kind}</div>
      <MiniTable model={model} relation={relation} highlightColumnId={highlightColumnId} />
    </div>
  );
}
