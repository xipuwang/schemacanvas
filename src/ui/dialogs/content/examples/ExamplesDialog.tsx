import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLES, buildExample, renderExampleThumbnail, type ExampleDefinition } from '@/examples';
import { useT } from '@/i18n';
import { Badge, Button, Dialog, EmptyState, SegmentedControl, TextField } from '../../../components';
import { uiStore } from '../../../uiStore';
import { replaceProject } from '../../../shell/replace';
import type { DialogComponentProps } from '../../registry';
import { diagramToActivate, filterExamples, type ExampleView } from './examplesFlow';

const LEVEL_TONE = { basic: 'success', intermediate: 'info', advanced: 'warning' } as const;

function Thumbnail({ id, view, alt }: { id: string; view: ExampleView; alt: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let revoke: string | undefined;
    // build lazily after the card has painted: the first build of an example runs the converter and the scene
    const handle = setTimeout(() => {
      try {
        revoke = URL.createObjectURL(new Blob([renderExampleThumbnail(id, view)], { type: 'image/svg+xml;charset=utf-8' }));
        setUrl(revoke);
      } catch {
        setUrl(undefined);
      }
    }, 0);
    return () => {
      clearTimeout(handle);
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [id, view]);
  return <div className="ex-thumb">{url ? <img src={url} alt={alt} loading="lazy" /> : <span className="ex-thumb-wait" aria-hidden="true" />}</div>;
}

export function ExamplesDialog({ props, onClose }: DialogComponentProps) {
  const t = useT();
  // the confirm dialog replaces this one (one dialog at a time); a cancelled confirm re-opens it with the same state
  const [view, setView] = useState<ExampleView>(props.view === 'relational' ? 'relational' : 'er');
  const [query, setQuery] = useState(typeof props.query === 'string' ? props.query : '');
  const [selected, setSelected] = useState<string>(typeof props.selected === 'string' ? props.selected : (EXAMPLES[0]?.id ?? ''));
  const grid = useRef<HTMLDivElement>(null);

  const text = (e: ExampleDefinition): string => `${t(e.titleKey)} ${t(e.descriptionKey)} ${t(`examples.level.${e.level}`)}`;
  const shown = useMemo(() => filterExamples(EXAMPLES, query, text), [query, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = shown.find((e) => e.id === selected) ?? shown[0];
  const tabStop = current?.id;

  const open = async (e: ExampleDefinition | undefined): Promise<void> => {
    if (!e) return;
    // the shell's replace helper keeps the current project in Recent projects (and asks first when it cannot)
    uiStore.getState().closeDialog();
    const next = buildExample(e.id);
    const res = await replaceProject(next, { label: t(e.titleKey), activeDiagramId: diagramToActivate(next, view) });
    if (!res.replaced) {
      uiStore.getState().openDialog('examples', { view, query, selected: e.id });
      return;
    }
    if (!res.keptPrevious) uiStore.getState().pushToast({ kind: 'success', message: t('dialogs.examples.opened', { name: t(e.titleKey) }) });
  };

  const move = (delta: { dx?: number; dy?: number } | 'home' | 'end'): void => {
    const cards = [...(grid.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    if (cards.length === 0) return;
    const i = Math.max(0, cards.findIndex((c) => c === document.activeElement));
    let next = i;
    if (delta === 'home') next = 0;
    else if (delta === 'end') next = cards.length - 1;
    else {
      // columns = cards sharing the first card's row
      const top = cards[0]!.offsetTop;
      const cols = Math.max(1, cards.filter((c) => c.offsetTop === top).length);
      next = Math.min(cards.length - 1, Math.max(0, i + (delta.dx ?? 0) + (delta.dy ?? 0) * cols));
    }
    cards[next]?.focus();
    const id = cards[next]?.dataset.exampleId;
    if (id) setSelected(id);
  };

  return (
    <Dialog
      title={t('dialogs.examples.title')}
      size="xl"
      onClose={onClose}
      className="dlg-examples"
      footer={
        <>
          <span className="ex-footer-note">{current ? t('dialogs.examples.opensIn', { view: t(`dialogs.examples.view.${view}`) }) : ''}</span>
          <span className="dlg-spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon="example" onClick={() => void open(current)} disabled={!current} data-testid="examples-open">
            {t('dialogs.examples.open')}
          </Button>
        </>
      }
    >
      <div className="ex">
        <div className="ex-bar">
          <div className="ex-search">
            <TextField label={t('dialogs.examples.search')} hideLabel value={query} placeholder={t('dialogs.examples.searchPlaceholder')} onChange={(e) => setQuery(e.target.value)} type="search" data-testid="examples-search" />
          </div>
          <SegmentedControl<ExampleView>
            label={t('dialogs.examples.preview')}
            value={view}
            onChange={setView}
            options={[
              { value: 'er', label: t('dialogs.examples.view.er') },
              { value: 'relational', label: t('dialogs.examples.view.relational') },
            ]}
          />
        </div>
        {shown.length === 0 ? (
          <EmptyState icon="search" title={t('dialogs.examples.noneTitle')} description={t('dialogs.examples.noneDesc')} />
        ) : (
          <div
            ref={grid}
            className="ex-grid"
            role="radiogroup"
            aria-label={t('dialogs.examples.gallery')}
            onKeyDown={(e) => {
              const k = e.key;
              if (k === 'ArrowRight') move({ dx: 1 });
              else if (k === 'ArrowLeft') move({ dx: -1 });
              else if (k === 'ArrowDown') move({ dy: 1 });
              else if (k === 'ArrowUp') move({ dy: -1 });
              else if (k === 'Home') move('home');
              else if (k === 'End') move('end');
              else if (k === 'Enter') void open(current);
              else return;
              e.preventDefault();
            }}
          >
            {shown.map((e) => (
              <div
                key={e.id}
                role="radio"
                aria-checked={e.id === current?.id}
                aria-label={t(e.titleKey)}
                aria-describedby={`ex-desc-${e.id}`}
                tabIndex={e.id === tabStop ? 0 : -1}
                data-example-id={e.id}
                className={`ex-card${e.id === current?.id ? ' is-selected' : ''}`}
                onClick={() => setSelected(e.id)}
                onDoubleClick={() => void open(e)}
              >
                <Thumbnail id={e.id} view={view} alt={t('dialogs.examples.thumbAlt', { name: t(e.titleKey), view: t(`dialogs.examples.view.${view}`) })} />
                <div className="ex-meta">
                  <h3 className="ex-title">{t(e.titleKey)}</h3>
                  <p className="ex-desc" id={`ex-desc-${e.id}`}>
                    {t(e.descriptionKey)}
                  </p>
                  <div className="ex-tags">
                    <Badge tone={LEVEL_TONE[e.level]}>{t(`examples.level.${e.level}`)}</Badge>
                    {e.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="dlg-chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
