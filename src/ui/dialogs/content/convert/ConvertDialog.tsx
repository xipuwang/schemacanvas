import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { layoutBusyStore, selectLayoutBusy } from '@/layout';
import { localizeDecision, tp, useT } from '@/i18n';
import { resolveRefsInDiagram } from '@/model/diagramSync';
import { DEFAULT_CONVERSION_OPTIONS } from '@/model/defaults';
import { describeRef } from '@/model/queries';
import type { ConversionDecision, ConversionOptions, ErModel, Id, OneToOneStrategy, SemanticRef } from '@/model/types';
import { editorStore, useEditorStore } from '@/store';
import { Badge, Button, Checkbox, Dialog, EmptyState, SegmentedControl, Select, Spinner, Switch, Tabs } from '../../../components';
import { Icon } from '../../../icons';
import { selectRefsOnDiagram } from '../../../panels/issues/issueActions';
import { runValidation } from '../../../shell/validation';
import { uiStore } from '../../../uiStore';
import type { DialogComponentProps } from '../../registry';
import { IssueList, Notice, SeverityIcon, useDebounced } from '../common';
import {
  applyPlan,
  cloneOptions,
  findPreviousConversion,
  listDerivedAttributes,
  listOneToOneRelationships,
  overrideChoice,
  planConversion,
  pruneOptions,
  renderPlanSvg,
  warningItems,
  withMaterialized,
  withOverride,
  type ConversionPlan,
  type OneToOneChoice,
} from './convertFlow';

type PreviewTab = 'decisions' | 'warnings' | 'mapping' | 'result';

const choiceKey = (c: OneToOneChoice): string => (typeof c === 'object' ? `fk:${c.fk}` : c);
const parseChoice = (v: string): OneToOneChoice => (v.startsWith('fk:') ? { fk: v.slice(3) } : (v as OneToOneChoice));

export function ConvertDialog({ onClose }: DialogComponentProps) {
  const t = useT();
  const project = useEditorStore((s) => s.project);
  const activeId = useEditorStore((s) => s.activeDiagramId);
  const diagram = activeId ? project.diagrams[activeId] : undefined;
  const er = diagram ? project.models[diagram.modelId] : undefined;
  if (!diagram || diagram.type !== 'chen' || er?.kind !== 'er') {
    return (
      <Dialog title={t('dialogs.convert.title')} size="sm" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('common.close')}</Button>}>
        <EmptyState icon="entity" title={t('dialogs.convert.notErTitle')} description={t('dialogs.convert.notErDesc')} />
      </Dialog>
    );
  }
  return <ConvertBody er={er} erDiagramId={diagram.id} onClose={onClose} />;
}

function ConvertBody({ er, erDiagramId, onClose }: { er: ErModel; erDiagramId: Id; onClose: () => void }) {
  const t = useT();
  const project = useEditorStore((s) => s.project);
  const prev = useMemo(() => findPreviousConversion(project, er.id), [project, er.id]);
  const ones = useMemo(() => listOneToOneRelationships(er), [er]);
  const derived = useMemo(() => listDerivedAttributes(er), [er]);

  const [options, setOptions] = useState<ConversionOptions>(() => pruneOptions(prev?.record.options ?? DEFAULT_CONVERSION_OPTIONS, er));
  const [replace, setReplace] = useState<boolean>(!!prev);
  const [tab, setTab] = useState<PreviewTab>('decisions');
  const [applying, setApplying] = useState(false);

  const live = useMemo(() => ({ options, replace }), [options, replace]);
  const settled = useDebounced(live, 250);
  const [state, setState] = useState<{ plan?: ConversionPlan; error?: string; forKey?: object }>({});
  const [computing, setComputing] = useState(true);
  const token = useRef(0);
  useEffect(() => {
    const id = ++token.current;
    // a newer option change, Esc or closing the dialog aborts the layout that is still running in the worker
    const controller = new AbortController();
    setComputing(true);
    const current = editorStore.getState().project;
    const previous = findPreviousConversion(current, er.id);
    planConversion(current, er.id, settled.options, { ...(settled.replace && previous ? { replace: { model: previous.model, recordId: previous.record.id } } : {}), signal: controller.signal }).then(
      (plan) => {
        if (id !== token.current) return;
        setState({ plan, forKey: settled });
        setComputing(false);
      },
      (e: unknown) => {
        if (id !== token.current) return;
        setState({ error: e instanceof Error ? e.message : String(e), forKey: settled });
        setComputing(false);
      },
    );
    return () => {
      token.current++;
      controller.abort();
    };
  }, [settled, er.id]);
  const busy = computing || settled !== live;
  const laying = useStore(layoutBusyStore, selectLayoutBusy) && computing;
  const plan = state.plan;

  const setStrategy = (oneToOne: OneToOneStrategy): void => setOptions((o) => ({ ...cloneOptions(o), oneToOne }));
  const entityName = (id: Id): string => er.entities[id]?.name ?? '?';
  const participantLabel = (p: { entityId: Id; role?: string }): string => (p.role ? `${entityName(p.entityId)} (${p.role})` : entityName(p.entityId));

  const apply = (): void => {
    if (!plan || busy) return;
    setApplying(true);
    try {
      const applied = applyPlan(plan, t('dialogs.convert.undoLabel'));
      uiStore.getState().pushToast({ kind: 'success', message: t('dialogs.convert.done', { tables: tp('dialogs.convert.tables', applied.tables) }) });
      onClose();
      runValidation(false);
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e), forKey: settled });
      setApplying(false);
    }
  };

  const jumpToEr = (ref: SemanticRef): void => {
    onClose();
    selectRefsOnDiagram(erDiagramId, [ref]);
  };
  const erDiagram = project.diagrams[erDiagramId]!;
  const onEr = (ref: SemanticRef): boolean => resolveRefsInDiagram(project, erDiagram, [ref]).nodeIds.length + resolveRefsInDiagram(project, erDiagram, [ref]).edgeIds.length > 0;

  const emptyEr = Object.keys(er.entities).length === 0;
  const warningsCount = plan ? warningItems(plan.result.record).length + plan.result.record.warnings.length : 0;
  const decisionsCount = plan?.result.record.decisions.length ?? 0;
  const mappingCount = plan?.result.record.trace.length ?? 0;
  const tabs = [
    { id: 'decisions', label: <TabLabel text={t('dialogs.convert.tabDecisions')} count={decisionsCount} />  },
    { id: 'warnings', label: <TabLabel text={t('dialogs.convert.tabWarnings')} count={warningsCount} tone={warningsCount ? 'warning' : undefined} /> },
    { id: 'mapping', label: <TabLabel text={t('dialogs.convert.tabMapping')} count={mappingCount} /> },
    { id: 'result', label: t('dialogs.convert.tabResult') },
  ];

  return (
    <Dialog
      title={t('dialogs.convert.title')}
      description={replace && prev ? t('dialogs.convert.headerReplace', { er: er.name, rel: prev.model.name }) : t('dialogs.convert.header', { er: er.name })}
      size="xl"
      onClose={onClose}
      className="dlg-convert"
      footer={
        <>
          <span className="cv-summary" role="status" data-testid="convert-summary">
            {busy ? (
              <>
                <Spinner size={14} label={laying ? t('dialogs.convert.layingOut') : t('dialogs.convert.updating')} /> {laying ? t('dialogs.convert.layingOut') : t('dialogs.convert.updating')}
              </>
            ) : plan ? (
              t('dialogs.convert.summary', { tables: tp('dialogs.convert.tables', plan.tables), fks: tp('dialogs.convert.fks', plan.foreignKeys) })
            ) : null}
          </span>
          <span className="dlg-spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon="convert" onClick={apply} disabled={!plan || busy || !!state.error || plan.tables === 0 || emptyEr} loading={applying || laying} aria-busy={applying || busy || undefined} data-testid="convert-apply">
            {t('dialogs.convert.convert')}
          </Button>
        </>
      }
    >
      <div className="cv">
        <div className="cv-options">
          <section className="cv-section">
            <h3 className="dlg-h3">{t('dialogs.convert.oneToOne')}</h3>
            <Select
              label={t('dialogs.convert.oneToOneDefault')}
              description={t(`dialogs.convert.strategyDesc.${options.oneToOne === 'merge' || options.oneToOne === 'relation' ? options.oneToOne : 'auto'}`)}
              value={options.oneToOne === 'merge' || options.oneToOne === 'relation' ? options.oneToOne : 'auto'}
              onChange={(v) => setStrategy(v as OneToOneStrategy)}
              options={[
                { value: 'auto', label: t('dialogs.convert.strategy.auto') },
                { value: 'merge', label: t('dialogs.convert.strategy.merge') },
                { value: 'relation', label: t('dialogs.convert.strategy.relation') },
              ]}
              data-testid="convert-strategy"
            />
            {ones.length > 0 ? (
              <div className="cv-overrides" role="group" aria-label={t('dialogs.convert.perRelationship')}>
                <p className="cv-sub">{t('dialogs.convert.perRelationship')}</p>
                {ones.map(({ relationship, first, second }) => (
                  <Select
                    key={relationship.id}
                    label={t('dialogs.convert.relationshipLabel', { name: relationship.name, a: participantLabel(first), b: participantLabel(second) })}
                    value={choiceKey(overrideChoice(options, relationship.id))}
                    onChange={(v) => setOptions((o) => withOverride(o, relationship.id, parseChoice(v)))}
                    options={[
                      { value: 'default', label: t('dialogs.convert.sameAsDefault') },
                      { value: 'auto', label: t('dialogs.convert.strategy.auto') },
                      { value: `fk:${first.id}`, label: t('dialogs.convert.fkIn', { name: participantLabel(first) }) },
                      { value: `fk:${second.id}`, label: t('dialogs.convert.fkIn', { name: participantLabel(second) }) },
                      { value: 'merge', label: t('dialogs.convert.strategy.merge') },
                      { value: 'relation', label: t('dialogs.convert.strategy.relation') },
                    ]}
                  />
                ))}
              </div>
            ) : (
              <p className="dlg-hint">{t('dialogs.convert.noOneToOne')}</p>
            )}
          </section>

          <section className="cv-section">
            <h3 className="dlg-h3">{t('dialogs.convert.derived')}</h3>
            {derived.length > 0 ? (
              <>
                <p className="dlg-hint">{t('dialogs.convert.derivedHint')}</p>
                <div className="cv-checks" role="group" aria-label={t('dialogs.convert.derived')}>
                  {derived.map(({ attribute, label }) => (
                    <Checkbox key={attribute.id} label={<span className="dlg-mono">{label}</span>} checked={options.materializeDerived.includes(attribute.id)} onChange={(on) => setOptions((o) => withMaterialized(o, attribute.id, on))} />
                  ))}
                </div>
              </>
            ) : (
              <p className="dlg-hint">{t('dialogs.convert.noDerived')}</p>
            )}
          </section>

          <section className="cv-section">
            <h3 className="dlg-h3">{t('dialogs.convert.columns')}</h3>
            <Switch label={t('dialogs.convert.carryTypes')} description={t('dialogs.convert.carryTypesDesc')} checked={options.carryDataTypes} onChange={(v) => setOptions((o) => ({ ...cloneOptions(o), carryDataTypes: v }))} />
          </section>

          {prev ? (
            <section className="cv-section">
              <h3 className="dlg-h3">{t('dialogs.convert.reconvert')}</h3>
              <Switch label={t('dialogs.convert.replace', { name: prev.model.name })} description={t('dialogs.convert.replaceDesc')} checked={replace} onChange={setReplace} />
            </section>
          ) : null}
        </div>

        <div className="cv-preview">
          <Tabs items={tabs} value={tab} onChange={(v) => setTab(v as PreviewTab)} label={t('dialogs.convert.preview')} renderPanels={false} />
          <div className={`cv-panel${busy ? ' is-busy' : ''}`} role="tabpanel" aria-label={t('dialogs.convert.preview')} tabIndex={0} aria-busy={busy} data-testid={`convert-panel-${tab}`}>
            {emptyEr ? <Notice tone="info">{t('dialogs.convert.emptyEr')}</Notice> : null}
            {state.error ? (
              <Notice tone="danger" title={t('dialogs.convert.failed')} testId="convert-error">
                {state.error}
              </Notice>
            ) : null}
            {plan && !state.error ? (
              tab === 'decisions' ? (
                <DecisionsTab plan={plan} onJump={jumpToEr} pickable={onEr} />
              ) : tab === 'warnings' ? (
                <WarningsTab plan={plan} onJump={jumpToEr} pickable={onEr} />
              ) : tab === 'mapping' ? (
                <MappingTab plan={plan} onJump={jumpToEr} />
              ) : (
                <ResultTab plan={plan} />
              )
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function TabLabel({ text, count, tone }: { text: string; count: number; tone?: 'warning' }) {
  return (
    <>
      {text}
      <Badge tone={tone ?? 'neutral'} className="cv-tabcount">
        {count}
      </Badge>
    </>
  );
}

function SourceChips({ refs, plan, onJump, pickable }: { refs: SemanticRef[]; plan: ConversionPlan; onJump: (r: SemanticRef) => void; pickable?: (r: SemanticRef) => boolean }) {
  const seen = new Set<string>();
  return (
    <>
      {refs.map((ref) => {
        const name = describeRef(plan.project, ref);
        if (!name || seen.has(name)) return null;
        seen.add(name);
        return !pickable || pickable(ref) ? (
          <button key={name} type="button" className="dlg-chip dlg-chip-btn" onClick={() => onJump(ref)} title={name}>
            {name}
          </button>
        ) : (
          <span key={name} className="dlg-chip">
            {name}
          </span>
        );
      })}
    </>
  );
}

function DecisionsTab({ plan, onJump, pickable }: { plan: ConversionPlan; onJump: (r: SemanticRef) => void; pickable: (r: SemanticRef) => boolean }) {
  const t = useT();
  const decisions = useMemo(() => [...plan.result.record.decisions].sort((a, b) => (a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1)), [plan]);
  if (decisions.length === 0) return <p className="dlg-hint">{t('dialogs.convert.noDecisions')}</p>;
  return <DecisionList decisions={decisions} plan={plan} onJump={onJump} pickable={pickable} testId="convert-decisions" />;
}

function DecisionList({ decisions, plan, onJump, pickable, testId }: { decisions: ConversionDecision[]; plan: ConversionPlan; onJump: (r: SemanticRef) => void; pickable: (r: SemanticRef) => boolean; testId: string }) {
  const t = useT();
  return (
    <ul className="dlg-issues" data-testid={testId}>
      {decisions.map((d) => {
        const text = localizeDecision(d);
        return (
          <li key={d.id} className="dlg-issue" data-level={d.level}>
            <SeverityIcon severity={d.level} label={t(`dialogs.convert.level.${d.level}`)} />
            <div>
              <p className="dlg-issue-title">{text.title}</p>
              <p className="dlg-issue-text">{text.explanation}</p>
              {d.sources.length > 0 ? (
                <p className="dlg-issue-refs">
                  <span className="dlg-muted cv-lbl">{t('dialogs.convert.from')}</span>
                  <SourceChips refs={d.sources} plan={plan} onJump={onJump} pickable={pickable} />
                </p>
              ) : null}
              {d.targets.length > 0 ? (
                <p className="dlg-issue-refs">
                  <span className="dlg-muted cv-lbl">{t('dialogs.convert.to')}</span>
                  <SourceChips refs={d.targets} plan={plan} onJump={onJump} pickable={() => false} />
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function WarningsTab({ plan, onJump, pickable }: { plan: ConversionPlan; onJump: (r: SemanticRef) => void; pickable: (r: SemanticRef) => boolean }) {
  const t = useT();
  const warnings = plan.result.record.warnings;
  const decisions = warningItems(plan.result.record);
  if (warnings.length === 0 && decisions.length === 0) return <p className="dlg-hint">{t('dialogs.convert.noWarnings')}</p>;
  return (
    <>
      {decisions.length > 0 ? <DecisionList decisions={decisions} plan={plan} onJump={onJump} pickable={pickable} testId="convert-warning-decisions" /> : null}
      {warnings.length > 0 ? <IssueList issues={warnings} project={plan.project} onPick={onJump} pickable={pickable} /> : null}
    </>
  );
}

function MappingTab({ plan, onJump }: { plan: ConversionPlan; onJump: (r: SemanticRef) => void }) {
  const t = useT();
  const trace = plan.result.record.trace;
  if (trace.length === 0) return <p className="dlg-hint">{t('dialogs.convert.noMapping')}</p>;
  return (
    <table className="cv-map" data-testid="convert-mapping">
      <caption className="sc-visually-hidden">{t('dialogs.convert.tabMapping')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('dialogs.convert.mapSource')}</th>
          <th scope="col">{t('dialogs.convert.mapTarget')}</th>
        </tr>
      </thead>
      <tbody>
        {trace.map((row, i) => {
          const name = describeRef(plan.project, row.source);
          return (
            <tr key={i}>
              <td>
                <span className="cv-kind">{t(`dialogs.convert.kind.${row.source.kind}`)}</span>{' '}
                <button type="button" className="dlg-chip dlg-chip-btn" onClick={() => onJump(row.source)} title={t('dialogs.convert.showOnDiagram', { name })}>
                  {name}
                </button>
              </td>
              <td>
                {row.targets.length === 0 ? (
                  <span className="dlg-muted">{t('dialogs.convert.notStored')}</span>
                ) : (
                  row.targets.map((tg) => {
                    const label = describeRef(plan.project, tg);
                    return (
                      <span key={`${tg.kind}:${tg.id}`} className={`dlg-chip cv-target cv-target-${tg.kind}`} title={t(`dialogs.convert.kind.${tg.kind}`)}>
                        {tg.kind === 'foreignKey' ? <Icon name="link" size={12} /> : null}
                        {label}
                      </span>
                    );
                  })
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ResultTab({ plan }: { plan: ConversionPlan }) {
  const t = useT();
  const svg = useMemo(() => renderPlanSvg(plan), [plan]);
  const [fit, setFit] = useState<'fit' | 'actual'>('fit');
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!svg) return setUrl(undefined);
    const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [svg]);
  const size = useMemo(() => {
    const m = svg ? /<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg) : null;
    return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined;
  }, [svg]);
  const { report } = plan;
  const replaced = plan.replaceModelId !== undefined;
  return (
    <div className="cv-result">
      {replaced ? (
        <Notice tone={report.dropped.length > 0 ? 'warning' : 'info'} title={t('dialogs.convert.reportTitle')} testId="convert-report">
          <p>{t('dialogs.convert.reportSummary', { kept: report.kept.length, overwritten: report.overwritten?.length ?? 0, dropped: report.dropped.length })}</p>
          {report.overwritten && report.overwritten.length > 0 ? (
            <>
              <p className="cv-sub">{t('dialogs.convert.overwritten')}</p>
              <ul className="dlg-list">
                {report.overwritten.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </>
          ) : null}
          {report.dropped.length > 0 ? (
            <>
              <p className="cv-sub">{t('dialogs.convert.dropped')}</p>
              <ul className="dlg-list">
                {report.dropped.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </>
          ) : null}
          {report.kept.length > 0 ? (
            <>
              <p className="cv-sub">{t('dialogs.convert.kept')}</p>
              <p className="dlg-issue-refs">
                {report.kept.map((r) => (
                  <span key={`${r.kind}:${r.id}`} className="dlg-chip">
                    {describeRef(plan.project, r)}
                  </span>
                ))}
              </p>
            </>
          ) : null}
        </Notice>
      ) : null}
      <div className="cv-result-bar">
        <span className="dlg-muted">{t('dialogs.convert.resultNote')}</span>
        <SegmentedControl<'fit' | 'actual'>
          size="sm"
          label={t('dialogs.convert.zoom')}
          value={fit}
          onChange={setFit}
          options={[
            { value: 'fit', label: t('dialogs.convert.fit') },
            { value: 'actual', label: t('dialogs.convert.actual') },
          ]}
        />
      </div>
      <div className={`cv-sheet${fit === 'actual' ? ' is-actual' : ''}`} tabIndex={0} role="group" aria-label={t('dialogs.convert.resultLabel')}>
        {url && size ? <img src={url} alt={t('dialogs.convert.resultAlt', { count: plan.tables })} width={size.w} height={size.h} data-testid="convert-result-img" /> : null}
      </div>
    </div>
  );
}
