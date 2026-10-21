/** Node style (fill, stroke, text, font, size) for one or many nodes, and the arrange/lock/order buttons for a multi-selection. */
import * as ops from '@/model/ops';
import { FONT_STACKS } from '@/model/defaults';
import type { Diagram, Id } from '@/model/types';
import { useCommand } from '@/editor';
import { useT } from '@/i18n';
import { Button, IconButton, NumberField, Select } from '../../components';
import { runEdit } from './edit';
import { ColorControl, Section } from './parts';

export function NodeStyleSection({ diagram, nodeIds }: { diagram: Diagram; nodeIds: readonly Id[] }) {
  const t = useT();
  const nodes = nodeIds.map((id) => diagram.nodes[id]).filter((n) => !!n);
  const first = nodes[0];
  if (!first) return null;
  const style = first.style ?? {};
  const single = nodes.length === 1;
  const setStyle = (label: string, patch: Parameters<typeof ops.setNodeStyle>[3]): boolean => runEdit(label, (d) => ops.setNodeStyle(d, diagram.id, [...nodeIds], patch));
  const setSize = (patch: { width?: number | undefined; height?: number | undefined }): boolean => runEdit(t('properties.style.setSize'), (d) => ops.setNodeSize(d, diagram.id, first.id, patch));
  const family = style.fontFamily === FONT_STACKS.sans ? 'sans' : style.fontFamily === FONT_STACKS.mono ? 'mono' : style.fontFamily ? 'custom' : '';
  return (
    <Section title={t('properties.style.title')} collapsible defaultOpen={false} testId="style-section">
      <div className="pp-pair">
        <ColorControl label={t('properties.style.fill')} value={style.fill} placeholder={t('properties.style.inherit')} onCommit={(fill) => setStyle(t('properties.style.setFill'), { fill })} />
        <ColorControl label={t('properties.style.stroke')} value={style.stroke} placeholder={t('properties.style.inherit')} onCommit={(stroke) => setStyle(t('properties.style.setStroke'), { stroke })} />
      </div>
      <ColorControl label={t('properties.style.text')} value={style.textColor} placeholder={t('properties.style.inherit')} onCommit={(textColor) => setStyle(t('properties.style.setText'), { textColor })} />
      <div className="pp-pair">
        <Select
          label={t('properties.style.fontFamily')}
          value={family}
          options={[
            { value: '', label: t('properties.style.fontDefault') },
            { value: 'sans', label: t('properties.font.sans') },
            { value: 'mono', label: t('properties.font.mono') },
            ...(family === 'custom' ? [{ value: 'custom', label: t('properties.font.custom') }] : []),
          ]}
          onChange={(v) => void setStyle(t('properties.style.setFont'), { fontFamily: v === 'sans' ? FONT_STACKS.sans : v === 'mono' ? FONT_STACKS.mono : v === 'custom' ? style.fontFamily : undefined })}
        />
        <NumberField label={t('properties.style.fontSize')} value={style.fontSize} placeholder={String(diagram.options.typography.fontSize)} min={6} max={64} onChange={(v) => void setStyle(t('properties.style.setFontSize'), { fontSize: v })} />
      </div>
      <div className="pp-actions" role="group" aria-label={t('properties.style.emphasis')}>
        <Button size="sm" aria-pressed={style.fontWeight === 'bold'} className={style.fontWeight === 'bold' ? 'is-on' : ''} onClick={() => void setStyle(t('properties.style.setBold'), { fontWeight: style.fontWeight === 'bold' ? undefined : 'bold' })}>
          <b>{t('properties.style.bold')}</b>
        </Button>
        <Button size="sm" aria-pressed={style.fontStyle === 'italic'} className={style.fontStyle === 'italic' ? 'is-on' : ''} onClick={() => void setStyle(t('properties.style.setItalic'), { fontStyle: style.fontStyle === 'italic' ? undefined : 'italic' })}>
          <i>{t('properties.style.italic')}</i>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void setStyle(t('properties.style.reset'), { fill: undefined, stroke: undefined, strokeWidth: undefined, textColor: undefined, fontFamily: undefined, fontSize: undefined, fontWeight: undefined, fontStyle: undefined })}>
          {t('properties.style.reset')}
        </Button>
      </div>
      {single ? (
        <div className="pp-pair">
          <NumberField label={t('properties.style.width')} value={first.width} placeholder={t('properties.auto')} min={20} max={2000} suffix="px" onChange={(width) => void setSize({ width })} />
          <NumberField label={t('properties.style.height')} value={first.height} placeholder={t('properties.auto')} min={12} max={1000} suffix="px" onChange={(height) => void setSize({ height })} />
        </div>
      ) : null}
      {single && (first.width !== undefined || first.height !== undefined) ? (
        <div>
          <Button size="sm" onClick={() => void setSize({ width: undefined, height: undefined })}>
            {t('properties.style.resetSize')}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function CommandButton({ id, icon }: { id: string; icon: string }) {
  const t = useT();
  const c = useCommand(id);
  if (!c.command) return null;
  return <IconButton icon={icon} label={t(c.command.labelKey)} shortcut={Array.isArray(c.command.shortcut) ? c.command.shortcut[0] : c.command.shortcut} disabled={!c.enabled} onClick={() => c.run()} data-command={id} />;
}

const GROUPS: Array<{ key: string; items: Array<[string, string]> }> = [
  { key: 'align', items: [['arrange.alignLeft', 'align-left'], ['arrange.alignCenter', 'align-center'], ['arrange.alignRight', 'align-right'], ['arrange.alignTop', 'align-top'], ['arrange.alignMiddle', 'align-middle'], ['arrange.alignBottom', 'align-bottom']] },
  { key: 'distribute', items: [['arrange.distributeH', 'distribute-h'], ['arrange.distributeV', 'distribute-v']] },
  { key: 'size', items: [['arrange.matchWidth', 'match-width'], ['arrange.matchHeight', 'match-height']] },
  { key: 'order', items: [['arrange.bringToFront', 'front'], ['arrange.sendToBack', 'back'], ['arrange.lock', 'lock'], ['arrange.unlock', 'unlock']] },
];

export function MultiPanel({ diagram, selectedIds }: { diagram: Diagram; selectedIds: readonly Id[] }) {
  const t = useT();
  const nodeIds = selectedIds.filter((id) => diagram.nodes[id]);
  const edgeCount = selectedIds.length - nodeIds.length;
  return (
    <>
      <div className="pp-head">
        <div className="pp-head-text">
          <div className="pp-head-kind">{t('properties.multi.kind')}</div>
          <div className="pp-head-title" data-testid="multi-title">
            {t('properties.multi.title', { count: selectedIds.length })}
          </div>
        </div>
      </div>
      <Section title={t('properties.multi.arrange')} testId="arrange-section">
        {nodeIds.length === 0 ? <p className="pp-note pp-note-muted">{t('properties.multi.noNodes')}</p> : null}
        {edgeCount > 0 && nodeIds.length > 0 ? <p className="pp-note pp-note-muted">{t('properties.multi.connectors', { count: edgeCount })}</p> : null}
        {GROUPS.map((g) => (
          <div key={g.key} className="pp-toolrow" role="group" aria-label={t(`properties.multi.group.${g.key}`)}>
            {g.items.map(([id, icon]) => (
              <CommandButton key={id} id={id} icon={icon} />
            ))}
          </div>
        ))}
      </Section>
      <NodeStyleSection diagram={diagram} nodeIds={nodeIds} />
    </>
  );
}
