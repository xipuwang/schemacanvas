/** Selected connector: foreign key (constraint editor + route editor), participation line and attribute link (route editor). */
import * as ops from '@/model/ops';
import { describeForeignKey } from '@/model/queries';
import type { AnchorSide, AnchorSpec, Diagram, DiagramEdge, Id, RelationalModel } from '@/model/types';
import { editorStore } from '@/store';
import { buildScene } from '@/scene/registry';
import { useT } from '@/i18n';
import { Button, NumberField, SegmentedControl, Select } from '../../components';
import { FkCard } from './FkForms';
import { issuesOf, runEdit, useIssueMap } from './edit';
import { ColorControl, IssueBadges, Note, Section } from './parts';

const SIDES_H: AnchorSide[] = ['auto', 'top', 'bottom'];
const SIDES_ALL: AnchorSide[] = ['auto', 'top', 'right', 'bottom', 'left'];

function AnchorEditor({ title, anchor, sides, onChange }: { title: string; anchor: AnchorSpec | undefined; sides: AnchorSide[]; onChange: (next: AnchorSpec | undefined) => boolean }) {
  const t = useT();
  const side = anchor?.side ?? 'auto';
  return (
    <fieldset className="pp-fieldset" data-testid={`anchor-${title}`}>
      <legend>{t(`properties.route.${title}`)}</legend>
      <div className="pp-pair">
        <Select
          label={t('properties.route.side')}
          value={side}
          options={sides.map((s) => ({ value: s, label: t(`properties.route.side.${s}`) }))}
          onChange={(v) => void onChange(v === 'auto' ? undefined : { side: v as AnchorSide, ...(anchor?.offset !== undefined ? { offset: anchor.offset } : {}) })}
        />
        <NumberField
          label={t('properties.route.offset')}
          value={anchor?.offset === undefined ? undefined : Math.round(anchor.offset * 100)}
          placeholder={t('properties.auto')}
          min={0}
          max={100}
          suffix="%"
          disabled={side === 'auto'}
          onChange={(v) => void onChange({ side, ...(v === undefined ? {} : { offset: v / 100 }) })}
        />
      </div>
    </fieldset>
  );
}

export function EdgeRouteSection({ diagram, edge }: { diagram: Diagram; edge: DiagramEdge }) {
  const t = useT();
  const fk = edge.ref.kind === 'foreignKey';
  const sides = fk && diagram.type === 'relational-schema' ? SIDES_H : SIDES_ALL;
  const route = edge.route;
  const setRoute = (label: string, patch: ops.EdgeRoutePatch): boolean => runEdit(label, (d) => ops.setEdgeRoute(d, diagram.id, edge.id, patch));
  const setMode = (mode: 'auto' | 'manual'): void => {
    if (mode === route.mode) return;
    if (mode === 'manual') {
      // start from the route the router currently draws, so switching to manual never moves the connector
      const s = editorStore.getState();
      const geom = buildScene(s.project, diagram.id).edges[edge.id];
      setRoute(t('properties.route.toManual'), { mode, waypoints: route.waypoints.length ? route.waypoints : (geom?.autoWaypoints ?? []) });
    } else setRoute(t('properties.route.toAuto'), { mode });
  };
  const style = edge.style ?? {};
  const setStyle = (label: string, patch: Parameters<typeof ops.setEdgeStyle>[3]): boolean => runEdit(label, (d) => ops.setEdgeStyle(d, diagram.id, edge.id, patch));
  return (
    <Section title={t('properties.route.title')} testId="route-section">
      <div className="sc-field">
        <span className="sc-field-label" id={`route-mode-${edge.id}`}>
          {t('properties.route.mode')}
        </span>
        <SegmentedControl
          label={t('properties.route.mode')}
          value={route.mode}
          onChange={setMode}
          options={[
            { value: 'auto', label: t('properties.route.auto') },
            { value: 'manual', label: t('properties.route.manual') },
          ]}
        />
      </div>
      <AnchorEditor title="source" anchor={route.sourceAnchor} sides={sides} onChange={(sourceAnchor) => setRoute(t('properties.route.setAnchor'), { sourceAnchor })} />
      <AnchorEditor title="target" anchor={route.targetAnchor} sides={sides} onChange={(targetAnchor) => setRoute(t('properties.route.setAnchor'), { targetAnchor })} />
      {fk ? <Note>{t('properties.route.anchorHint')}</Note> : null}
      <div className="pp-owner">
        <span className="pp-owner-label">{t('properties.route.bends', { count: route.waypoints.length })}</span>
        <Button size="sm" disabled={route.waypoints.length === 0} onClick={() => void setRoute(t('properties.route.clearBends'), { waypoints: [] })}>
          {t('properties.route.clearBends')}
        </Button>
      </div>
      <div className="pp-actions">
        <Button size="sm" onClick={() => void runEdit(t('properties.route.reset'), (d) => ops.resetEdgeRoute(d, diagram.id, edge.id))}>
          {t('properties.route.reset')}
        </Button>
      </div>
      {fk ? (
        <Select
          label={t('properties.route.label')}
          value={edge.labelVisible === undefined ? 'default' : edge.labelVisible ? 'show' : 'hide'}
          options={[
            { value: 'default', label: t('properties.route.label.default') },
            { value: 'show', label: t('properties.route.label.show') },
            { value: 'hide', label: t('properties.route.label.hide') },
          ]}
          onChange={(v) => void runEdit(t('properties.route.setLabel'), (d) => ops.setEdgeLabelVisible(d, diagram.id, edge.id, v === 'default' ? undefined : v === 'show'))}
        />
      ) : null}
      <ColorControl label={t('properties.style.stroke')} value={style.stroke} placeholder={t('properties.style.inherit')} onCommit={(stroke) => setStyle(t('properties.style.setStroke'), { stroke })} />
      <div className="pp-pair">
        <Select
          label={t('properties.route.dash')}
          value={style.dash ?? ''}
          options={[
            { value: '', label: t('properties.route.dash.default') },
            { value: 'solid', label: t('properties.route.dash.solid') },
            { value: 'dashed', label: t('properties.route.dash.dashed') },
            { value: 'dotted', label: t('properties.route.dash.dotted') },
          ]}
          onChange={(v) => void setStyle(t('properties.style.setDash'), { dash: v === '' ? undefined : (v as 'solid' | 'dashed' | 'dotted') })}
        />
        <NumberField label={t('properties.route.width')} value={style.strokeWidth} placeholder={t('properties.auto')} min={0.5} max={8} step={0.5} onChange={(v) => void setStyle(t('properties.style.setWidth'), { strokeWidth: v })} />
      </div>
    </Section>
  );
}

export function FkPanel({ model, diagram, edge, foreignKeyId }: { model: RelationalModel; diagram: Diagram; edge: DiagramEdge; foreignKeyId: Id }) {
  const t = useT();
  const issueMap = useIssueMap();
  const fk = model.foreignKeys[foreignKeyId];
  if (!fk) return <Note tone="warning">{t('properties.fk.missing')}</Note>;
  return (
    <>
      <div className="pp-head">
        <div className="pp-head-text">
          <div className="pp-head-kind">{t('properties.kind.foreignKey')}</div>
          <div className="pp-head-title pp-mono" title={describeForeignKey(model, fk)}>
            {describeForeignKey(model, fk)}
          </div>
        </div>
      </div>
      <IssueBadges issues={issuesOf(issueMap, { kind: 'foreignKey', id: fk.id })} />
      <Section title={t('properties.fk.constraint')} testId="fk-panel">
        <ul className="pp-cards">
          <FkCard key={fk.id} model={model} fk={fk} defaultOpen />
        </ul>
      </Section>
      <EdgeRouteSection diagram={diagram} edge={edge} />
    </>
  );
}
