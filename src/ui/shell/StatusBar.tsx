import { useSyncExternalStore } from 'react';
import { useViewportInfo } from '@/editor';
import { getPersistenceStatus, onPersistenceStatus, type PersistenceStatus } from '@/persistence';
import { summarizeIssues } from '@/validation';
import { useEditorStore } from '@/store';
import { tp, useT } from '@/i18n';
import { Icon } from '../icons';
import { useUi } from '../uiStore';
import { togglePanel } from './commands';

export function usePersistenceStatus(): PersistenceStatus {
  return useSyncExternalStore(onPersistenceStatus, getPersistenceStatus, getPersistenceStatus);
}

export function StatusBar() {
  const t = useT();
  // the live canvas zoom (the stored viewport only updates after a debounce and not at all for fit-on-open)
  const live = useViewportInfo();
  const stored = useEditorStore((s) => (s.activeDiagramId ? s.project.diagrams[s.activeDiagramId]?.viewport?.zoom : undefined) ?? 1);
  const activeId = useEditorStore((s) => s.activeDiagramId);
  const zoom = live.diagramId !== null && live.diagramId === activeId ? live.zoom : stored;
  const selected = useEditorStore((s) => s.selection.ids.length);
  const dirty = useEditorStore((s) => s.dirty);
  const status = usePersistenceStatus();
  const issues = useUi((s) => s.issues);
  const stale = useUi((s) => s.issuesStale);
  const dockOpen = useUi((s) => s.dock === 'issues');
  const sum = summarizeIssues(issues);

  let persist: { text: string; tone: 'ok' | 'warn' | 'bad' | 'idle'; icon: string };
  if (status.state === 'unavailable') persist = { text: t('shell.status.unavailable'), tone: 'warn', icon: 'warning' };
  else if (status.state === 'error') persist = { text: t('shell.status.error'), tone: 'bad', icon: 'error' };
  else if (status.state === 'saving') persist = { text: t('shell.status.saving'), tone: 'idle', icon: 'save' };
  else if (dirty) persist = { text: t('shell.status.dirty'), tone: 'idle', icon: 'save' };
  else if (status.state === 'saved') persist = { text: t('shell.status.saved'), tone: 'ok', icon: 'check' };
  else persist = { text: t('shell.status.idle'), tone: 'idle', icon: 'save' };

  const issuesLabel = sum.total === 0 ? t('shell.status.noIssues') : t('shell.status.issuesLabel', { errors: sum.error, warnings: sum.warning, info: sum.info });
  return (
    <footer className="shell-status" aria-label={t('shell.status.label')}>
      <span className="shell-status-item" aria-label={t('shell.status.zoom')} data-testid="status-zoom">
        <Icon name="zoom-fit" size={14} />
        <span className="shell-num">{Math.round(zoom * 100)}%</span>
      </span>
      <span className="shell-status-item" data-testid="status-selection">
        {selected === 0 ? t('shell.status.nothingSelected') : tp('shell.status.selected', selected)}
      </span>
      <span className="shell-tb-spacer" />
      <button type="button" className={`shell-status-item shell-status-btn${dockOpen ? ' is-on' : ''}`} onClick={() => togglePanel('issues')} aria-label={`${issuesLabel}${stale ? ` (${t('shell.status.stale')})` : ''}`} aria-pressed={dockOpen} title={t('shell.status.issuesHint')} data-testid="status-issues">
        {sum.total === 0 ? (
          <>
            <Icon name="check" size={14} />
            <span>{t('shell.status.noIssues')}</span>
          </>
        ) : (
          <>
            {sum.error > 0 ? (
              <span className="shell-count is-error">
                <Icon name="error" size={14} />
                <span className="shell-num">{sum.error}</span>
              </span>
            ) : null}
            {sum.warning > 0 ? (
              <span className="shell-count is-warning">
                <Icon name="warning" size={14} />
                <span className="shell-num">{sum.warning}</span>
              </span>
            ) : null}
            {sum.info > 0 ? (
              <span className="shell-count is-info">
                <Icon name="info" size={14} />
                <span className="shell-num">{sum.info}</span>
              </span>
            ) : null}
          </>
        )}
      </button>
      <span className={`shell-status-item shell-persist is-${persist.tone}`} role="status" data-testid="status-persist">
        <Icon name={persist.icon} size={14} />
        <span>{persist.text}</span>
      </span>
    </footer>
  );
}
