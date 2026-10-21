/** Diagram properties (nothing selected) and the `diagram-options` dialog: the same form in both places. */
import * as ops from '@/model/ops';
import { FONT_STACKS } from '@/model/defaults';
import type { Diagram, DiagramType, Model, SqlDialect } from '@/model/types';
import { displayDiagramName, useT } from '@/i18n';
import { Badge, Button, Dialog, NumberField, SegmentedControl, Select, Switch } from '../../components';
import type { DialogComponentProps } from '../../dialogs/registry';
import { applyDiagramOptions } from './applyOptions';
import { runEdit, useActive } from './edit';
import { CommitInput, EditError, Note, Section } from './parts';

const TYPE_KEY: Record<DiagramType, string> = {
  chen: 'properties.diagram.type.chen',
  'relational-schema': 'properties.diagram.type.relational',
  'crows-foot': 'properties.diagram.type.crowsFoot',
  physical: 'properties.diagram.type.physical',
};

/** No op exists for model metadata (name, dialect): a one-field recipe on the model, still ONE undoable commit. */
function setModelMeta(modelId: string, patch: { name?: string; dialect?: SqlDialect }): boolean {
  return runEdit('Edit model', (d) => {
    const m = d.models[modelId];
    if (!m) return;
    if (patch.name !== undefined) m.name = patch.name;
    if (patch.dialect !== undefined && m.kind === 'relational') m.dialect = patch.dialect;
  });
}

const DIALECTS: SqlDialect[] = ['generic', 'postgresql', 'sqlite', 'mysql'];

function Toggle({ diagram, label, path, value, description }: { diagram: Diagram; label: string; path: [string, string]; value: boolean; description?: string }) {
  const t = useT();
  return <Switch label={label} description={description} checked={value} onChange={(v) => void applyDiagramOptions(diagram.id, t('properties.diagram.setOption'), { [path[0]]: { [path[1]]: v } })} />;
}

function Choice<V extends string>({ diagram, label, path, value, options }: { diagram: Diagram; label: string; path: [string, string]; value: V; options: Array<{ value: V; label: string }> }) {
  const t = useT();
  return (
    <div className="sc-field">
      <span className="sc-field-label">{label}</span>
      <SegmentedControl label={label} value={value} options={options} onChange={(v) => void applyDiagramOptions(diagram.id, t('properties.diagram.setOption'), { [path[0]]: { [path[1]]: v } })} />
    </div>
  );
}

function NumberOption({ diagram, label, path, value, min, max, suffix }: { diagram: Diagram; label: string; path: [string, string]; value: number; min: number; max: number; suffix?: string }) {
  const t = useT();
  return <NumberField label={label} value={value} min={min} max={max} suffix={suffix} onChange={(v) => v !== undefined && void applyDiagramOptions(diagram.id, t('properties.diagram.setOption'), { [path[0]]: { [path[1]]: v } })} />;
}

function TypeOptions({ diagram }: { diagram: Diagram }) {
  const t = useT();
  const o = diagram.options;
  const routing = (block: 'chen' | 'relational' | 'crowsFoot' | 'physical', value: 'straight' | 'orthogonal') => (
    <Choice diagram={diagram} label={t('properties.opt.routing')} path={[block, 'routing']} value={value} options={[{ value: 'orthogonal', label: t('properties.opt.routing.orthogonal') }, { value: 'straight', label: t('properties.opt.routing.straight') }]} />
  );
  switch (diagram.type) {
    case 'chen': {
      const c = o.chen!;
      return (
        <>
          <Toggle diagram={diagram} label={t('properties.opt.showRoles')} path={['chen', 'showRoles']} value={c.showRoles} />
          <Toggle diagram={diagram} label={t('properties.opt.showDataTypes')} path={['chen', 'showDataTypes']} value={c.showDataTypes} />
          <Choice diagram={diagram} label={t('properties.opt.cardinalityStyle')} path={['chen', 'cardinalityStyle']} value={c.cardinalityStyle} options={[{ value: 'letters', label: t('properties.opt.cardinality.letters') }, { value: 'minmax', label: t('properties.opt.cardinality.minmax') }]} />
          {routing('chen', c.routing)}
        </>
      );
    }
    case 'relational-schema': {
      const r = o.relational!;
      return (
        <>
          <div className="pp-pair">
            <NumberOption diagram={diagram} label={t('properties.opt.rowHeight')} path={['relational', 'rowHeight']} value={r.rowHeight} min={20} max={96} suffix="px" />
            <NumberOption diagram={diagram} label={t('properties.opt.cellPaddingX')} path={['relational', 'cellPaddingX']} value={r.cellPaddingX} min={2} max={48} suffix="px" />
          </div>
          <Toggle diagram={diagram} label={t('properties.opt.showDataTypes')} path={['relational', 'showDataTypes']} value={r.showDataTypes} />
          <Toggle diagram={diagram} label={t('properties.opt.nameAbove')} path={['relational', 'nameAbove']} value={r.nameAbove} />
          <Toggle diagram={diagram} label={t('properties.opt.fkLabels')} path={['relational', 'fkLabels']} value={r.fkLabels} />
          <Choice diagram={diagram} label={t('properties.opt.compositeFkStyle')} path={['relational', 'compositeFkStyle']} value={r.compositeFkStyle} options={[{ value: 'branches', label: t('properties.opt.fk.branches') }, { value: 'bracket', label: t('properties.opt.fk.bracket') }]} />
          {routing('relational', r.routing)}
        </>
      );
    }
    case 'crows-foot': {
      const c = o.crowsFoot!;
      return (
        <>
          <Choice diagram={diagram} label={t('properties.opt.orientation')} path={['crowsFoot', 'orientation']} value={c.orientation} options={[{ value: 'vertical', label: t('properties.opt.orientation.vertical') }, { value: 'horizontal', label: t('properties.opt.orientation.horizontal') }]} />
          <Toggle diagram={diagram} label={t('properties.opt.showTypes')} path={['crowsFoot', 'showTypes']} value={c.showTypes} />
          <Toggle diagram={diagram} label={t('properties.opt.showNullability')} path={['crowsFoot', 'showNullability']} value={c.showNullability} />
          {routing('crowsFoot', c.routing)}
        </>
      );
    }
    case 'physical': {
      const p = o.physical!;
      return (
        <>
          <Toggle diagram={diagram} label={t('properties.opt.showIndexes')} path={['physical', 'showIndexes']} value={p.showIndexes} />
          <Toggle diagram={diagram} label={t('properties.opt.showConstraints')} path={['physical', 'showConstraints']} value={p.showConstraints} />
          {routing('physical', p.routing)}
        </>
      );
    }
  }
}

function counts(model: Model): Array<[string, number]> {
  if (model.kind === 'er') return [['entities', Object.keys(model.entities).length], ['relationships', Object.keys(model.relationships).length], ['attributes', Object.keys(model.attributes).length]];
  return [['tables', Object.keys(model.relations).length], ['columns', Object.values(model.relations).reduce((n, r) => n + r.columns.length, 0)], ['foreignKeys', Object.keys(model.foreignKeys).length]];
}

export function DiagramForm({ diagram, model }: { diagram: Diagram; model: Model | undefined }) {
  const t = useT();
  const grid = diagram.options.grid;
  const typo = diagram.options.typography;
  const family = typo.fontFamily === FONT_STACKS.sans ? 'sans' : typo.fontFamily === FONT_STACKS.mono ? 'mono' : 'custom';
  const setOpt = (patch: Parameters<typeof ops.setDiagramOptions>[2]): void => void applyDiagramOptions(diagram.id, t('properties.diagram.setOption'), patch);
  return (
    <>
      <Section title={t('properties.diagram.general')} testId="diagram-general">
        <CommitInput label={t('properties.diagram.name')} required value={displayDiagramName(diagram)} onCommit={(name) => runEdit(t('properties.diagram.rename'), (d) => ops.renameDiagram(d, diagram.id, name))} />
        <div className="pp-owner">
          <span className="pp-owner-label">{t('properties.diagram.type')}</span>
          <Badge tone="key">{t(TYPE_KEY[diagram.type])}</Badge>
        </div>
        {model ? <CommitInput label={t('properties.diagram.modelName')} required value={model.name} onCommit={(name) => setModelMeta(model.id, { name })} /> : null}
        {model?.kind === 'relational' ? (
          <Select label={t('properties.diagram.dialect')} value={model.dialect} description={t('properties.diagram.dialectDesc')} options={DIALECTS.map((v) => ({ value: v, label: t(`properties.dialect.${v}`) }))} onChange={(dialect) => void setModelMeta(model.id, { dialect: dialect as SqlDialect })} />
        ) : null}
        {model ? (
          <dl className="pp-counts" data-testid="diagram-counts">
            {counts(model).map(([k, n]) => (
              <div key={k}>
                <dt>{t(`properties.count.${k}`)}</dt>
                <dd>{n}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Section>
      <Section title={t('properties.diagram.grid')} testId="diagram-grid">
        <Switch label={t('properties.grid.visible')} checked={grid.visible} onChange={(visible) => setOpt({ grid: { visible } })} />
        <Switch label={t('properties.grid.snap')} checked={grid.snap} onChange={(snap) => setOpt({ grid: { snap } })} />
        <NumberField label={t('properties.grid.size')} value={grid.size} min={4} max={200} step={2} suffix="px" onChange={(size) => size !== undefined && setOpt({ grid: { size } })} />
      </Section>
      <Section title={t('properties.diagram.typography')} testId="diagram-typography">
        <div className="pp-pair">
          <Select
            label={t('properties.style.fontFamily')}
            value={family}
            options={[{ value: 'sans', label: t('properties.font.sans') }, { value: 'mono', label: t('properties.font.mono') }, ...(family === 'custom' ? [{ value: 'custom', label: t('properties.font.custom') }] : [])]}
            onChange={(v) => v !== 'custom' && setOpt({ typography: { fontFamily: FONT_STACKS[v as 'sans' | 'mono'] } })}
          />
          <NumberField label={t('properties.style.fontSize')} value={typo.fontSize} min={8} max={32} suffix="px" onChange={(fontSize) => fontSize !== undefined && setOpt({ typography: { fontSize } })} />
        </div>
      </Section>
      <Section title={t('properties.diagram.options')} testId="diagram-options">
        <TypeOptions diagram={diagram} />
      </Section>
    </>
  );
}

/** The panel body when nothing is selected. */
export function DiagramPanel() {
  const t = useT();
  const { diagram, model } = useActive();
  if (!diagram) return <Note>{t('properties.noDiagram')}</Note>;
  return (
    <>
      <div className="pp-head">
        <div className="pp-head-text">
          <div className="pp-head-kind">{t('properties.kind.diagram')}</div>
          <div className="pp-head-title" title={displayDiagramName(diagram)}>
            {displayDiagramName(diagram)}
          </div>
        </div>
      </div>
      <DiagramForm diagram={diagram} model={model} />
    </>
  );
}

export function DiagramOptionsDialog({ onClose }: DialogComponentProps) {
  const t = useT();
  const { diagram, model } = useActive();
  return (
    <Dialog title={t('properties.diagram.dialogTitle')} size="md" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('common.close')}</Button>}>
      <div className="pp pp-dialog">
        <EditError />
        {diagram ? <DiagramForm diagram={diagram} model={model} /> : <Note>{t('properties.noDiagram')}</Note>}
      </div>
    </Dialog>
  );
}
