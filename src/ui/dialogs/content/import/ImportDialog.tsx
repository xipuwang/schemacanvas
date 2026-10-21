import { useEffect, useMemo, useRef, useState } from 'react';
import { localizeLoadError, tp, useT } from '@/i18n';
import { Button, Dialog, Select, Tabs, Textarea } from '../../../components';
import { uiStore } from '../../../uiStore';
import { replaceProject } from '../../../shell/replace';
import type { DialogComponentProps } from '../../registry';
import { IssueList, Notice, useDebounced } from '../common';
import { applyModelImport, parseImport, parseProjectText, type ImportDialect, type ImportKind } from './importFlow';

const kindOfFile = (name: string): ImportKind | undefined => (/\.sql$/i.test(name) ? 'sql' : /\.dbml$/i.test(name) ? 'dbml' : /\.json$/i.test(name) ? 'project' : undefined);
const isKind = (v: unknown): v is ImportKind => v === 'sql' || v === 'dbml' || v === 'project';

export function ImportDialog({ props, onClose }: DialogComponentProps) {
  const t = useT();
  const [kind, setKind] = useState<ImportKind>(isKind(props.tab) ? props.tab : 'sql');
  const [texts, setTexts] = useState<Record<ImportKind, string>>({
    sql: typeof props.text === 'string' && props.tab !== 'dbml' && props.tab !== 'project' ? props.text : '',
    dbml: typeof props.text === 'string' && props.tab === 'dbml' ? props.text : '',
    project: typeof props.text === 'string' && props.tab === 'project' ? props.text : '',
  });
  const [fileNames, setFileNames] = useState<Partial<Record<ImportKind, string>>>({});
  const [dialect, setDialect] = useState<ImportDialect>('auto');
  const [readError, setReadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const loadFile = async (file: File, force?: ImportKind): Promise<void> => {
    const target = force ?? kindOfFile(file.name) ?? kind;
    try {
      const text = await file.text();
      setReadError(null);
      setKind(target);
      setTexts((s) => ({ ...s, [target]: text }));
      setFileNames((s) => ({ ...s, [target]: file.name }));
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    }
  };
  // a file dropped on the window arrives as a prop
  useEffect(() => {
    if (props.file instanceof File) void loadFile(props.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = texts[kind];
  const settled = useDebounced(text, 250);
  const settledDialect = useDebounced(dialect, 0);
  const pending = settled !== text;
  const sqlResult = useMemo(() => (kind === 'project' ? undefined : parseImport(kind, settled, settledDialect)), [kind, settled, settledDialect]);
  const projectResult = useMemo(() => (kind === 'project' ? parseProjectText(settled) : undefined), [kind, settled]);

  const ready = !pending && (sqlResult?.status === 'ok' || (projectResult !== undefined && settled.trim() !== '' && projectResult.ok));

  const goToError = (): void => {
    if (sqlResult?.status !== 'error' || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(sqlResult.offset, Math.min(text.length, sqlResult.offset + 1));
    // bring the caret line into view
    const lineHeight = parseFloat(getComputedStyle(area.current).lineHeight) || 18;
    area.current.scrollTop = Math.max(0, (sqlResult.line - 3) * lineHeight);
  };

  const run = async (): Promise<void> => {
    if (!ready) return;
    setImporting(true);
    try {
      if (kind === 'project' && projectResult?.ok) {
        const res = await replaceProject(projectResult.project, { label: projectResult.project.name, repairs: projectResult.repairs.length });
        if (!res.replaced) {
          uiStore.getState().openDialog('import', { tab: 'project', text });
          return;
        }
        if (!res.keptPrevious) uiStore.getState().pushToast({ kind: projectResult.repairs.length ? 'warning' : 'success', message: t('dialogs.import.openedProject', { name: projectResult.project.name }) });
        onClose();
      } else if (sqlResult?.status === 'ok') {
        // re-parse so a second click can never re-add the same ids
        const fresh = parseImport(kind as 'sql' | 'dbml', text, dialect);
        if (fresh.status !== 'ok') return;
        const applied = await applyModelImport(fresh.model, { diagramName: t('dialogs.import.diagramName'), label: t(kind === 'sql' ? 'dialogs.import.labelSql' : 'dialogs.import.labelDbml') });
        uiStore.getState().pushToast({ kind: 'success', message: t('dialogs.import.done', { tables: tp('dialogs.import.tables', applied.tables) }) });
        onClose();
      }
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const tabs = [
    { id: 'sql', label: t('dialogs.import.tabSql') },
    { id: 'dbml', label: t('dialogs.import.tabDbml') },
    { id: 'project', label: t('dialogs.import.tabProject') },
  ];
  const accept = kind === 'sql' ? '.sql,.ddl,.txt,text/plain' : kind === 'dbml' ? '.dbml,.txt,text/plain' : '.json,application/json';
  const placeholder = t(kind === 'sql' ? 'dialogs.import.placeholderSql' : kind === 'dbml' ? 'dialogs.import.placeholderDbml' : 'dialogs.import.placeholderProject');

  return (
    <Dialog
      title={t('dialogs.import.title')}
      size="lg"
      onClose={onClose}
      className="dlg-import"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon="import" onClick={() => void run()} disabled={!ready} loading={importing} data-testid="import-apply">
            {t('dialogs.import.import')}
          </Button>
        </>
      }
    >
      <div className="imp">
        <Tabs items={tabs} value={kind} onChange={(v) => setKind(v as ImportKind)} label={t('dialogs.import.formats')} renderPanels={false} />
        <p className="dlg-hint">{t(`dialogs.import.hint.${kind}`)}</p>
        <div className="imp-tools">
          <Button icon="open" onClick={() => picker.current?.click()} data-testid="import-choose">
            {t('dialogs.import.chooseFile')}
          </Button>
          <input
            ref={picker}
            type="file"
            accept={accept}
            hidden
            data-testid="import-file-input"
            aria-label={t('dialogs.import.chooseFile')}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void loadFile(f, kind);
            }}
          />
          {fileNames[kind] ? <span className="imp-file">{fileNames[kind]}</span> : null}
          <span className="dlg-spacer" />
          {kind === 'sql' ? (
            <div className="imp-dialect">
              <Select
                label={t('dialogs.import.dialect')}
                value={dialect}
                onChange={(v) => setDialect(v as ImportDialect)}
                options={[
                  { value: 'auto', label: t('dialogs.import.dialectAuto') },
                  { value: 'postgresql', label: 'PostgreSQL' },
                  { value: 'sqlite', label: 'SQLite' },
                  { value: 'mysql', label: 'MySQL' },
                  { value: 'generic', label: t('dialogs.sql.generic') },
                ]}
              />
            </div>
          ) : null}
        </div>
        <Textarea
          ref={area}
          label={t(`dialogs.import.text.${kind}`)}
          hideLabel
          mono
          rows={11}
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setTexts((s) => ({ ...s, [kind]: e.target.value }))}
          data-testid="import-text"
          className="imp-text"
        />
        {readError ? <Notice tone="danger" title={t('dialogs.import.readFailed')}>{readError}</Notice> : null}

        <div className="imp-result" aria-live="polite" data-testid="import-result">
          {settled.trim() === '' || pending ? (
            <p className="dlg-hint">{t('dialogs.import.nothing')}</p>
          ) : sqlResult?.status === 'error' ? (
            <Notice tone="danger" title={t('dialogs.import.errorTitle', { line: sqlResult.line, column: sqlResult.column })} testId="import-error">
              <p className="imp-err-msg">{sqlResult.message}</p>
              <pre className="imp-excerpt" aria-label={t('dialogs.import.excerpt')}>
                {sqlResult.excerpt.map((l) => (
                  <span key={l.line} className={`imp-ex-line${l.caret !== undefined ? ' is-bad' : ''}`}>
                    <span className="imp-ex-n">{l.line}</span>
                    <span className="imp-ex-t">{l.text}</span>
                    {l.caret !== undefined ? (
                      <span className="imp-ex-caret" aria-hidden="true">
                        <span className="imp-ex-n" />
                        <span className="imp-ex-t">{' '.repeat(l.caret)}^</span>
                      </span>
                    ) : null}
                  </span>
                ))}
              </pre>
              <Button size="sm" onClick={goToError} data-testid="import-goto">
                {t('dialogs.import.goToError')}
              </Button>
            </Notice>
          ) : sqlResult?.status === 'ok' ? (
            <>
              <Notice tone="success" testId="import-summary">
                {t('dialogs.import.summary', { tables: tp('dialogs.import.tables', sqlResult.summary.tables), fks: tp('dialogs.import.fks', sqlResult.summary.foreignKeys) })}
              </Notice>
              {sqlResult.warnings.length > 0 ? (
                <div className="imp-warnings" data-testid="import-warnings">
                  <h3 className="dlg-h3">{tp('dialogs.import.warnings', sqlResult.warnings.length)}</h3>
                  <IssueList issues={sqlResult.warnings} />
                </div>
              ) : null}
            </>
          ) : projectResult?.ok ? (
            <>
              <Notice tone="success" testId="import-summary">
                {t('dialogs.import.projectSummary', { name: projectResult.project.name, models: Object.keys(projectResult.project.models).length, diagrams: Object.keys(projectResult.project.diagrams).length })}
              </Notice>
              <p className="dlg-hint">{t('dialogs.import.projectReplaces')}</p>
              {projectResult.repairs.length > 0 ? <Notice tone="warning">{tp('dialogs.import.repairs', projectResult.repairs.length)}</Notice> : null}
            </>
          ) : projectResult && !projectResult.ok ? (
            <Notice tone="danger" title={t('dialogs.import.projectError')} testId="import-error">
              <p className="imp-err-msg">{localizeLoadError(projectResult.error)}</p>
            </Notice>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
