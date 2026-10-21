import { useEffect, useMemo, useRef, useState } from 'react';
import { clampPngScale, copyPngToClipboard, downloadBlob, renderExportSvg } from '@/export';
import { t as tr, useT, tp } from '@/i18n';
import { displayDiagramName, localizeIssue } from '@/i18n';
import type { Issue, SqlDialect } from '@/model/types';
import { editorStore, useEditorStore } from '@/store';
import { Button, Checkbox, Dialog, NumberField, SegmentedControl, Select, Spinner, Switch, TextField } from '../../../components';
import { Icon } from '../../../icons';
import { uiStore } from '../../../uiStore';
import type { DialogComponentProps } from '../../registry';
import { Notice, useDebounced } from '../common';
import { CodeView } from '../sql/CodeView';
import { exportSourceModel } from '../sql/sqlOutput';
import {
  DEFAULT_EXPORT_STATE,
  EXPORT_KINDS,
  classifyExportWarning,
  defaultFilename,
  exportOptionsFor,
  isExportKind,
  isImageKind,
  runExport,
  withExtension,
  type ExportKind,
  type ExportOutcome,
  type ExportState,
} from './exportFlow';

const KIND_ICON: Record<ExportKind, string> = { svg: 'image', png: 'image', pdf: 'pdf', json: 'save', sql: 'sql', dbml: 'sql' };
const DIALECTS: SqlDialect[] = ['postgresql', 'sqlite', 'mysql', 'generic'];
const DIALECT_NAME: Record<SqlDialect, string> = { postgresql: 'PostgreSQL', sqlite: 'SQLite', mysql: 'MySQL', generic: '' };

export const localizeExportWarning = (w: string): string => {
  const k = classifyExportWarning(w);
  return k ? tr(k.key, 'params' in k ? k.params : undefined) : w;
};

const fmt = (n: number): string => Math.round(n).toLocaleString();

/** Image preview of what Download will produce (the same pure SVG the exporters start from). */
function usePreview(state: ExportState, selection: readonly string[]) {
  const project = useEditorStore((s) => s.project);
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const settled = useDebounced(state, 200);
  return useMemo(() => {
    if (!isImageKind(settled.format) || !diagramId || !project.diagrams[diagramId]) return undefined;
    try {
      const r = renderExportSvg(project, diagramId, exportOptionsFor(settled, selection));
      return { svg: r.svg, width: r.width, height: r.height, empty: r.empty };
    } catch {
      return undefined;
    }
  }, [settled, project, diagramId, selection]);
}

function PreviewImage({ svg, width, height, dark, transparent, alt }: { svg: string; width: number; height: number; dark: boolean; transparent: boolean; alt: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [svg]);
  return (
    <div className={`exp-stage${transparent ? ' is-checker' : ''}${dark ? ' is-dark' : ''}`}>
      {url ? <img src={url} width={width} height={height} alt={alt} className="exp-img" style={{ aspectRatio: `${width} / ${height}` }} /> : null}
    </div>
  );
}

export function ExportDialog({ props, onClose }: DialogComponentProps) {
  const t = useT();
  const project = useEditorStore((s) => s.project);
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const selectionIds = useEditorStore((s) => s.selection.ids);
  const diagram = diagramId ? project.diagrams[diagramId] : undefined;
  const source = useMemo(() => exportSourceModel(project, diagramId), [project, diagramId]);
  const selectionNodeIds = useMemo(() => (diagram ? selectionIds.filter((id) => Object.hasOwn(diagram.nodes, id)) : []), [diagram, selectionIds]);

  const wanted = isExportKind(props.format) ? props.format : undefined;
  const [state, setState] = useState<ExportState>(() => ({
    ...DEFAULT_EXPORT_STATE,
    format: wanted ?? (diagram ? 'svg' : 'json'),
    sqlDialect: source?.model.dialect ?? 'generic',
    onlySelected: false,
  }));
  const patch = (p: Partial<ExportState>): void => setState((s) => ({ ...s, ...p }));
  /** Preview-only swatch for a transparent export (what slide colour the result is checked against). */
  const [previewOn, setPreviewOn] = useState<'light' | 'dark'>('light');

  const autoName = defaultFilename(project, diagram, state.format);
  const [edited, setEdited] = useState<string | null>(null);
  const filename = edited === null ? autoName : withExtension(edited, state.format);
  useEffect(() => {
    // a new format re-bases an edited name onto the new extension
    setEdited((e) => (e === null ? e : withExtension(e, state.format)));
  }, [state.format]);

  const needsDiagram = isImageKind(state.format);
  const needsRelational = state.format === 'sql' || state.format === 'dbml';
  const unavailable = (needsDiagram && !diagram) || (needsRelational && !source);

  // Prepare the real result in the background so warnings show BEFORE the download and Download is instant.
  const key = useDebounced(JSON.stringify([state, selectionNodeIds]), 250);
  const liveKey = JSON.stringify([state, selectionNodeIds]);
  const [prepared, setPrepared] = useState<{ key: string; outcome?: ExportOutcome; error?: string } | null>(null);
  const run = useRef(0);
  useEffect(() => {
    if (unavailable) {
      setPrepared(null);
      return;
    }
    const id = ++run.current;
    runExport(editorStore.getState().project, diagramId, state, selectionNodeIds).then(
      (outcome) => {
        if (id === run.current) setPrepared({ key, outcome });
      },
      (e: unknown) => {
        if (id === run.current) setPrepared({ key, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      run.current++;
    };
    // `key` carries state + selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, unavailable, diagramId]);
  const busy = !unavailable && (!prepared || prepared.key !== liveKey);
  const ready = !busy && prepared?.outcome?.ok ? prepared.outcome : undefined;

  const preview = usePreview(state, selectionNodeIds);
  const png = preview ? clampPngScale(preview.width, preview.height, state.scale) : undefined;
  const warnings = [...(ready?.warnings ?? []).map(localizeExportWarning)];
  const issueNotes: Issue[] = ready ? ready.issues.filter((i) => i.severity !== 'info') : [];

  const download = (): void => {
    if (!ready) return;
    downloadBlob(ready.blob, filename);
    uiStore.getState().pushToast({ kind: 'success', message: t('dialogs.export.done', { file: filename }) });
    onClose();
  };
  const copyImage = async (): Promise<void> => {
    if (!ready) return;
    const ok = await copyPngToClipboard(ready.blob);
    uiStore.getState().pushToast({ kind: ok ? 'success' : 'error', message: t(ok ? 'dialogs.export.copied' : 'dialogs.export.copyFailed') });
  };

  const formatOptions = EXPORT_KINDS.map((k) => ({
    value: k,
    label: t(`dialogs.export.kind.${k}`),
    icon: KIND_ICON[k],
    disabled: (isImageKind(k) && !diagram) || ((k === 'sql' || k === 'dbml') && !source),
  }));

  const dimension = (() => {
    if (state.format === 'png' && png) return t('dialogs.export.dimPng', { w: fmt(png.width), h: fmt(png.height), scale: Number(png.scale.toFixed(2)) });
    if (state.format === 'pdf' && ready?.info) return t('dialogs.export.dimPdf', { w: fmt(ready.info.width), h: fmt(ready.info.height) });
    if (preview) return t('dialogs.export.dimSvg', { w: fmt(preview.width), h: fmt(preview.height) });
    return '';
  })();

  return (
    <Dialog
      title={t('dialogs.export.title')}
      size="xl"
      onClose={onClose}
      className="dlg-export"
      footer={
        <>
          {state.format === 'png' ? (
            <Button icon="copy" onClick={() => void copyImage()} disabled={!ready} data-testid="export-copy">
              {t('dialogs.export.copyImage')}
            </Button>
          ) : null}
          <span className="dlg-spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon="download" onClick={download} disabled={!ready} loading={busy} data-testid="export-download">
            {t('dialogs.export.download')}
          </Button>
        </>
      }
    >
      <div className="exp-layout">
        <div className="exp-options">
          <div className="sc-field">
            <span className="sc-field-label" id="exp-format-l">
              {t('dialogs.export.format')}
            </span>
            <SegmentedControl<ExportKind> label={t('dialogs.export.format')} value={state.format} onChange={(v) => patch({ format: v })} options={formatOptions} className="exp-formats" />
            <p className="sc-field-desc">{t(`dialogs.export.kindDesc.${state.format}`)}</p>
          </div>

          {isImageKind(state.format) ? (
            <>
              <div className="sc-field">
                <span className="sc-field-label">{t('dialogs.export.background')}</span>
                <SegmentedControl<'white' | 'transparent'>
                  label={t('dialogs.export.background')}
                  value={state.background}
                  onChange={(v) => patch({ background: v })}
                  options={[
                    { value: 'white', label: t('dialogs.export.bgWhite') },
                    { value: 'transparent', label: t('dialogs.export.bgTransparent') },
                  ]}
                />
              </div>
              <NumberField label={t('dialogs.export.padding')} value={state.padding} min={2} max={400} step={4} suffix="px" onChange={(v) => v !== undefined && patch({ padding: v })} />
              {state.format === 'png' ? (
                <div className="sc-field">
                  <span className="sc-field-label">{t('dialogs.export.scale')}</span>
                  <SegmentedControl<'1' | '2' | '3' | '4'>
                    label={t('dialogs.export.scale')}
                    value={String(state.scale) as '1' | '2' | '3' | '4'}
                    onChange={(v) => patch({ scale: Number(v) as 1 | 2 | 3 | 4 })}
                    options={(['1', '2', '3', '4'] as const).map((s) => ({ value: s, label: `${s}x` }))}
                  />
                  {png ? <p className="sc-field-desc" data-testid="export-pixels">{t('dialogs.export.pixels', { w: fmt(png.width), h: fmt(png.height) })}</p> : null}
                  {png?.clamped ? (
                    <Notice tone="warning" testId="export-clamp">
                      {t('dialogs.export.clamped', { scale: Number(png.scale.toFixed(2)) })}
                    </Notice>
                  ) : null}
                </div>
              ) : null}
              {state.format === 'pdf' ? (
                <>
                  <Select
                    label={t('dialogs.export.page')}
                    value={state.pageSize}
                    onChange={(v) => patch({ pageSize: v as ExportState['pageSize'] })}
                    options={[
                      { value: 'fit', label: t('dialogs.export.pageFit') },
                      { value: 'a4', label: 'A4' },
                      { value: 'letter', label: 'Letter' },
                    ]}
                  />
                  {state.pageSize !== 'fit' ? (
                    <div className="sc-field">
                      <span className="sc-field-label">{t('dialogs.export.orientation')}</span>
                      <SegmentedControl<ExportState['orientation']>
                        label={t('dialogs.export.orientation')}
                        value={state.orientation}
                        onChange={(v) => patch({ orientation: v })}
                        options={[
                          { value: 'auto', label: t('dialogs.export.orientAuto') },
                          { value: 'portrait', label: t('dialogs.export.portrait') },
                          { value: 'landscape', label: t('dialogs.export.landscape') },
                        ]}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
              {state.background === 'transparent' ? (
                <div className="exp-transparent" data-testid="export-transparent">
                  <Notice tone="info" testId="export-transparent-hint">
                    {t(state.darkPalette ? 'dialogs.export.transparentHintLight' : 'dialogs.export.transparentHint')}
                  </Notice>
                  <Switch label={t('dialogs.export.lightLines')} description={t('dialogs.export.lightLinesDesc')} checked={state.darkPalette} onChange={(v) => patch({ darkPalette: v })} />
                  <div className="sc-field">
                    <span className="sc-field-label">{t('dialogs.export.previewOn')}</span>
                    <SegmentedControl<'light' | 'dark'>
                      size="sm"
                      label={t('dialogs.export.previewOn')}
                      value={previewOn}
                      onChange={setPreviewOn}
                      options={[
                        { value: 'light', label: t('dialogs.export.swatchLight') },
                        { value: 'dark', label: t('dialogs.export.swatchDark') },
                      ]}
                    />
                  </div>
                </div>
              ) : (
                <Switch label={t('dialogs.export.dark')} description={t('dialogs.export.darkDesc')} checked={state.darkPalette} onChange={(v) => patch({ darkPalette: v })} />
              )}
              {selectionNodeIds.length > 0 ? (
                <Checkbox
                  label={t('dialogs.export.onlySelected')}
                  description={tp('dialogs.export.onlySelectedDesc', selectionNodeIds.length)}
                  checked={state.onlySelected}
                  onChange={(v) => patch({ onlySelected: v })}
                />
              ) : null}
            </>
          ) : null}

          {state.format === 'sql' ? (
            <Select
              label={t('dialogs.export.dialect')}
              value={state.sqlDialect}
              onChange={(v) => patch({ sqlDialect: v as SqlDialect })}
              options={DIALECTS.map((d) => ({ value: d, label: d === 'generic' ? t('dialogs.sql.generic') : DIALECT_NAME[d] }))}
            />
          ) : null}
          {needsRelational && source?.viaConversion ? <p className="sc-field-desc">{t('dialogs.export.viaConversion', { name: source.model.name })}</p> : null}
          {needsRelational && !source ? <Notice tone="info">{t('dialogs.export.noRelational')}</Notice> : null}

          <TextField
            label={t('dialogs.export.fileName')}
            value={filename}
            mono
            spellCheck={false}
            onChange={(e) => setEdited(e.target.value)}
            onBlur={() => edited !== null && edited.trim() === '' && setEdited(null)}
            data-testid="export-filename"
          />
        </div>

        <div className="exp-preview" aria-live="polite">
          <div className="exp-preview-bar">
            <span className="exp-preview-title">{t('dialogs.export.preview')}</span>
            {busy ? (
              <span className="exp-busy" data-testid="export-busy">
                <Spinner size={14} label={t('dialogs.export.preparing')} />
                {t('dialogs.export.preparing')}
              </span>
            ) : (
              <span className="exp-dim" data-testid="export-dim">
                {dimension}
              </span>
            )}
          </div>
          {warnings.length > 0 ? (
            <Notice tone="warning" title={t('dialogs.export.warningsTitle')} testId="export-warnings">
              <ul className="dlg-list">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {issueNotes.length > 0 ? (
            <Notice tone="warning" title={t('dialogs.export.sqlNotes')}>
              <ul className="dlg-list">
                {issueNotes.map((i) => (
                  <li key={i.id}>{localizeIssue(i).title}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {prepared?.outcome && !prepared.outcome.ok && prepared.key === liveKey ? (
            <Notice tone="danger" title={t('dialogs.export.blockedTitle')} testId="export-blocked">
              <ul className="dlg-list">
                {prepared.outcome.issues
                  .filter((i) => i.severity === 'error')
                  .map((i) => (
                    <li key={i.id}>{localizeIssue(i).title}</li>
                  ))}
              </ul>
            </Notice>
          ) : null}
          {prepared?.error && prepared.key === liveKey ? (
            <Notice tone="danger" title={t('dialogs.export.failed')} testId="export-error">
              {prepared.error}
            </Notice>
          ) : null}

          {state.format === 'json' ? (
            <div className="exp-json">
              <Icon name="save" size={24} />
              <p>{t('dialogs.export.jsonSummary', { models: Object.keys(project.models).length, diagrams: Object.keys(project.diagrams).length })}</p>
            </div>
          ) : isImageKind(state.format) ? (
            preview ? (
              <PreviewImage svg={preview.svg} width={preview.width} height={preview.height} dark={state.background === 'transparent' ? previewOn === 'dark' : state.darkPalette} transparent={state.background === 'transparent'} alt={t('dialogs.export.previewAlt', { name: diagram ? displayDiagramName(diagram) : '' })} />
            ) : (
              <Notice tone="info">{t('dialogs.export.noDiagram')}</Notice>
            )
          ) : ready?.text !== undefined ? (
            <div className="exp-code">
              <CodeView text={ready.text} lang={state.format === 'dbml' ? 'dbml' : 'sql'} label={t('dialogs.export.previewAlt', { name: filename })} />
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
