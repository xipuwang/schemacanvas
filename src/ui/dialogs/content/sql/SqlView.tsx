import { useMemo, useState } from 'react';
import { createStore, useStore } from 'zustand';
import { downloadBlob, suggestFilename } from '@/export';
import { useT, tp } from '@/i18n';
import type { Issue, RelationalModel } from '@/model/types';
import { runCommand } from '@/editor';
import { editorStore, useEditorStore } from '@/store';
import { Badge, Button, EmptyState, SegmentedControl } from '../../../components';
import { uiStore } from '../../../uiStore';
import { IssueList, Notice, copyText } from '../common';
import { CodeView } from './CodeView';
import { SQL_FORMATS, exportSourceModel, buildSqlOutput, extensionFor, langFor, type SqlFormat } from './sqlOutput';

/** The format the user picked in the SQL dock/dialog; null = follow the model's own dialect. */
const formatStore = createStore<{ format: SqlFormat | null; set(f: SqlFormat): void }>()((set) => ({ format: null, set: (format) => set({ format }) }));

export function useSqlFormat(model: RelationalModel | undefined): [SqlFormat, (f: SqlFormat) => void] {
  const picked = useStore(formatStore, (s) => s.format);
  return [picked ?? model?.dialect ?? 'generic', formatStore.getState().set];
}

const FORMAT_NAME = { postgresql: 'PostgreSQL', sqlite: 'SQLite', mysql: 'MySQL', dbml: 'DBML' } as const;
const formatLabel = (f: SqlFormat, generic: string): string => (f === 'generic' ? generic : FORMAT_NAME[f]);

/** Live DDL / DBML of the active relational model. Shared by the bottom dock and the 'SQL and DBML' dialog. */
export function SqlView({ variant, onNavigate }: { variant: 'dock' | 'dialog'; onNavigate?: () => void }) {
  const t = useT();
  const project = useEditorStore((s) => s.project);
  const activeId = useEditorStore((s) => s.activeDiagramId);
  const source = exportSourceModel(project, activeId);
  const model = source?.model;
  /** The sheet that shows the converted model, when the active sheet is the ER diagram it was derived from. */
  const relationalSheet = source?.viaConversion && model ? project.diagramOrder.find((id) => project.diagrams[id]?.type === 'relational-schema' && project.diagrams[id]?.modelId === model.id) : undefined;
  const [format, setFormat] = useSqlFormat(model);
  const [showIssues, setShowIssues] = useState(false);
  const out = useMemo(() => (model ? buildSqlOutput(model, format) : undefined), [model, format]);

  if (!model || !out) {
    const hasDiagram = !!activeId && !!project.diagrams[activeId];
    return (
      <div className={`sqlv sqlv-${variant}`}>
        <EmptyState
          icon="sql"
          title={t('dialogs.sql.noModelTitle')}
          description={t(hasDiagram ? 'dialogs.sql.noModelDesc' : 'dialogs.sql.noDiagramDesc')}
          actions={
            hasDiagram && project.diagrams[activeId]?.type === 'chen' ? (
              <Button
                variant="primary"
                icon="convert"
                onClick={() => {
                  onNavigate?.();
                  void runCommand('diagram.convert');
                }}
              >
                {t('dialogs.sql.convert')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const ext = extensionFor(format);
  const filename = suggestFilename(project, undefined, ext);
  const counts = { error: 0, warning: 0, info: 0 } as Record<Issue['severity'], number>;
  for (const i of out.issues) counts[i.severity]++;
  const copy = async (): Promise<void> => {
    const ok = await copyText(out.text);
    uiStore.getState().pushToast({ kind: ok ? 'success' : 'error', message: t(ok ? 'dialogs.sql.copied' : 'dialogs.sql.copyFailed') });
  };
  const download = (): void => {
    downloadBlob(new Blob([out.text], { type: 'text/plain;charset=utf-8' }), filename);
    uiStore.getState().pushToast({ kind: 'success', message: t('dialogs.sql.downloaded', { file: filename }) });
  };
  const lineCount = out.text === '' ? 0 : out.text.split('\n').length;

  return (
    <div className={`sqlv sqlv-${variant}`} data-testid={`sql-${variant}`}>
      <div className="sqlv-bar">
        <SegmentedControl<SqlFormat>
          size="sm"
          label={t('dialogs.sql.format')}
          value={format}
          onChange={setFormat}
          options={SQL_FORMATS.map((f) => ({ value: f, label: formatLabel(f, t('dialogs.sql.generic')) }))}
        />
        <span className="sqlv-meta">{t('dialogs.sql.meta', { name: model.name, lines: tp('dialogs.sql.lines', lineCount) })}</span>
        <span className="sqlv-spacer" />
        {out.issues.length > 0 ? (
          <button type="button" className="sqlv-issues-toggle" aria-expanded={showIssues} onClick={() => setShowIssues((v) => !v)} data-testid="sql-issues-toggle">
            {counts.error > 0 ? <Badge tone="danger">{counts.error}</Badge> : null}
            {counts.warning > 0 ? <Badge tone="warning">{counts.warning}</Badge> : null}
            {counts.info > 0 ? <Badge tone="info">{counts.info}</Badge> : null}
            <span>{t(showIssues ? 'dialogs.sql.hideIssues' : 'dialogs.sql.showIssues')}</span>
          </button>
        ) : null}
        <Button size="sm" icon="copy" onClick={() => void copy()} disabled={out.text === ''} data-testid="sql-copy">
          {t('dialogs.sql.copy')}
        </Button>
        <Button size="sm" icon="download" onClick={download} disabled={out.text === ''} data-testid="sql-download">
          {t('dialogs.sql.download', { ext })}
        </Button>
      </div>
      {source?.viaConversion ? (
        <div className="sqlv-notice">
          <Notice tone="info" testId="sql-derived">
            <p>{t('dialogs.sql.derived', { name: model.name })}</p>
            {relationalSheet ? (
              <Button
                size="sm"
                icon="sheet"
                data-testid="sql-show-relational"
                onClick={() => {
                  onNavigate?.();
                  editorStore.getState().setActiveDiagram(relationalSheet);
                }}
              >
                {t('dialogs.sql.showSheet')}
              </Button>
            ) : null}
          </Notice>
        </div>
      ) : null}
      {out.blocked ? (
        <div className="sqlv-notice">
          <Notice tone="danger" title={t('dialogs.sql.blockedTitle')}>
            <p>{t('dialogs.sql.blockedDesc')}</p>
          </Notice>
        </div>
      ) : null}
      {out.issues.length > 0 && (showIssues || out.blocked) ? <IssueList issues={out.issues} project={project} className="sqlv-issues" /> : null}
      {out.text !== '' ? <CodeView text={out.text} lang={langFor(format)} label={t('dialogs.sql.codeLabel', { format: formatLabel(format, t('dialogs.sql.generic')) })} /> : null}
    </div>
  );
}
