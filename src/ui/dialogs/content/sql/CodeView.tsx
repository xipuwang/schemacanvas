import { memo, useMemo } from 'react';
import { useT } from '@/i18n';
import { highlight, type Lang } from './highlight';

/** Rendering cap: very large outputs stay responsive; copy and download always use the full text. */
export const MAX_RENDERED_LINES = 3000;

/** Read-only code view in the mono font with light syntax colouring and CSS line numbers (not selectable). */
export const CodeView = memo(function CodeView({ text, lang, label, maxLines = MAX_RENDERED_LINES }: { text: string; lang: Lang; label: string; maxLines?: number }) {
  const t = useT();
  const { lines, total } = useMemo(() => {
    const all = text.split(/\r\n|\r|\n/);
    const cut = all.length > maxLines;
    // highlight only what is shown (block-comment state is correct for a prefix)
    return { lines: highlight(cut ? all.slice(0, maxLines).join('\n') : text, lang), total: all.length };
  }, [text, lang, maxLines]);
  const cut = total > lines.length;
  return (
    <div className="code-view" role="region" aria-label={label} tabIndex={0} data-testid="code-view">
      <pre className="code-pre">
        <code>
          {lines.map((tokens, i) => (
            <span key={i} className="code-line">
              {tokens.length === 0 ? '' : tokens.map((tok, j) => (tok.kind === 'plain' ? tok.text : <span key={j} className={`tk-${tok.kind}`}>{tok.text}</span>))}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      {cut ? (
        <p className="code-cut" role="status">
          {t('dialogs.sql.truncated', { shown: lines.length.toLocaleString(), total: total.toLocaleString() })}
        </p>
      ) : null}
    </div>
  );
});
