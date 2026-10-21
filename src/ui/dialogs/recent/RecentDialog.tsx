import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteRecent, flush, getPersistenceStatus, listRecent, type RecentProject } from '@/persistence';
import { formatCount, formatRelativeTime, t as tr, useT } from '@/i18n';
import { editorStore } from '@/store';
import { Badge, Button, Dialog, EmptyState, IconButton, Spinner } from '../../components';
import { confirmDialog } from '../../shell/confirm';
import { replaceProject } from '../../shell/replace';
import { uiStore } from '../../uiStore';
import type { DialogComponentProps } from '../registry';
import { countProject, loadRecentOutcome, thumbnailSvg, type ProjectCounts } from './recentModel';
import './recent.css';

function useVisibleOnce(): [React.RefObject<HTMLLIElement | null>, boolean] {
  const ref = useRef<HTMLLIElement>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

interface Details {
  counts: ProjectCounts;
  svgUrl?: string;
}

function countsText(c: ProjectCounts): string {
  const parts: string[] = [];
  if (c.entities) parts.push(formatCount(c.entities, 'shell.recent.entities'));
  if (c.tables) parts.push(formatCount(c.tables, 'shell.recent.tables'));
  if (!parts.length) return tr('shell.recent.empty');
  return parts.join(' · ');
}

function Row({ item, current, onOpen, onDelete }: { item: RecentProject; current: boolean; onOpen: (r: RecentProject) => void; onDelete: (r: RecentProject) => void }) {
  const t = useT();
  const [ref, visible] = useVisibleOnce();
  const [details, setDetails] = useState<Details | 'corrupt' | undefined>();
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let url: string | undefined;
    // lazy: after the row painted, parse the stored project and draw its first diagram
    const handle = setTimeout(() => {
      void loadRecentOutcome(item.id).then(async (o) => {
        if (cancelled) return;
        if (o.status !== 'ok') return setDetails('corrupt');
        const svg = await thumbnailSvg(o.project);
        if (cancelled) return;
        if (svg) url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        setDetails({ counts: countProject(o.project), ...(url ? { svgUrl: url } : {}) });
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, item.id, item.savedAt]);

  const saved = new Date(item.savedAt);
  return (
    <li ref={ref} className={`rc-row${current ? ' is-current' : ''}`} data-testid="recent-row" data-project-id={item.id}>
      <div className="rc-thumb">
        {details && details !== 'corrupt' && details.svgUrl ? (
          <img src={details.svgUrl} alt={t('shell.recent.thumbAlt', { name: item.name })} />
        ) : details ? (
          <span className="rc-thumb-none">{t('shell.recent.noPreview')}</span>
        ) : (
          <span className="rc-thumb-wait" aria-hidden="true" />
        )}
      </div>
      <div className="rc-info">
        <div className="rc-name">
          <span className="rc-name-text">{item.name}</span>
          {current ? <Badge tone="info">{t('shell.recent.current')}</Badge> : null}
        </div>
        <div className="rc-meta">
          <time dateTime={item.savedAt} title={Number.isNaN(+saved) ? undefined : saved.toLocaleString()}>
            {Number.isNaN(+saved) ? '' : formatRelativeTime(saved)}
          </time>
          {details && details !== 'corrupt' ? <span>{countsText(details.counts)}</span> : null}
          {details === 'corrupt' ? <span className="rc-bad">{t('shell.recent.unreadable')}</span> : null}
        </div>
      </div>
      <div className="rc-actions">
        <Button size="sm" variant="primary" disabled={current} onClick={() => onOpen(item)} aria-label={t('shell.recent.openLabel', { name: item.name })}>
          {t('shell.recent.open')}
        </Button>
        <IconButton label={t('shell.recent.deleteLabel', { name: item.name })} icon="trash" size="sm" disabled={current} onClick={() => onDelete(item)} />
      </div>
    </li>
  );
}

export function RecentDialog({ onClose }: DialogComponentProps) {
  const t = useT();
  const [items, setItems] = useState<RecentProject[] | null>(null);
  const currentId = editorStore.getState().project.id;

  // flush first so the project that is open right now is part of the list (autosave is debounced)
  const refresh = useCallback(async () => {
    await flush();
    setItems(await listRecent());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (r: RecentProject): Promise<void> => {
    const o = await loadRecentOutcome(r.id);
    if (o.status === 'missing') {
      uiStore.getState().pushToast({ kind: 'error', message: t('shell.recent.loadFailed', { name: r.name, message: t('shell.recent.missing') }) });
      void refresh();
      return;
    }
    if (o.status === 'corrupt') {
      uiStore.getState().pushToast({ kind: 'error', message: t('shell.recent.loadFailed', { name: r.name, message: o.message }) });
      return;
    }
    onClose();
    await replaceProject(o.project, { label: o.project.name, repairs: o.repairs });
  };

  const remove = async (r: RecentProject): Promise<void> => {
    // the confirm replaces this dialog (one dialog at a time); re-open the list afterwards either way
    const ok = await confirmDialog({ title: t('shell.recent.deleteTitle', { name: r.name }), message: t('shell.recent.deleteMessage'), confirmLabel: t('shell.recent.delete'), danger: true });
    if (ok) {
      await deleteRecent(r.id);
      uiStore.getState().pushToast({ kind: 'info', message: t('shell.recent.deleted', { name: r.name }) });
    }
    uiStore.getState().openDialog('recent');
  };

  const unavailable = items !== null && items.length === 0 && getPersistenceStatus().state === 'unavailable';
  return (
    <Dialog title={t('shell.recent.title')} description={t('shell.recent.desc')} size="lg" onClose={onClose} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      {items === null ? (
        <div className="rc-loading" role="status">
          <Spinner size={18} />
          <span>{t('shell.recent.loading')}</span>
        </div>
      ) : unavailable ? (
        <EmptyState icon="warning" title={t('shell.recent.unavailableTitle')} description={t('shell.recent.unavailableDesc')} />
      ) : items.length === 0 ? (
        <EmptyState icon="folder" title={t('shell.recent.emptyTitle')} description={t('shell.recent.emptyDesc')} />
      ) : (
        <ul className="rc-list" aria-label={t('shell.recent.label')}>
          {items.map((r) => (
            <Row key={r.id} item={r} current={r.id === currentId} onOpen={(x) => void open(x)} onDelete={(x) => void remove(x)} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
