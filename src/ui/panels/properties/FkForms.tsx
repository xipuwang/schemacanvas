/**
 * Foreign keys. A composite FK is ONE constraint with ordered column pairs; the editor maps source column to target column
 * pair by pair and every change is one `updateForeignKey` (never several FKs). The referenced table is fixed once the FK
 * exists (the op refuses to change it), so the card shows it read-only.
 */
import { useState } from 'react';
import * as ops from '@/model/ops';
import { describeForeignKey, fkCardinality, foreignKeysOf, foreignKeysReferencing } from '@/model/queries';
import { fkTargetKey } from '@/model/relationalFacts';
import type { ForeignKey, ForeignKeyColumnPair, Id, ReferentialAction, Relation, RelationalModel } from '@/model/types';
import { useT } from '@/i18n';
import { Badge, Button, IconButton, Select } from '../../components';
import { Icon } from '../../icons';
import { issuesOf, runEdit, useIssueMap } from './edit';
import { nextFreePair, pairsForTargetKey, setPairColumn, type PairSide } from './forms';
import { selectForeignKeyEdge } from './nav';
import { CommitInput, IssueDot, Note, Section } from './parts';

const ACTIONS: ReferentialAction[] = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

function ColumnSelect({ label, relation, value, onChange }: { label: string; relation: Relation; value: Id; onChange: (id: Id) => void }) {
  return <Select label={label} hideLabel className="pp-grow" value={value} options={relation.columns.map((c) => ({ value: c.id, label: c.name || '?' }))} onChange={onChange} />;
}

/** The pair rows shared by the card of an existing FK and the creation form. */
function PairEditor({ source, target, pairs, onChange, idPrefix }: { source: Relation; target: Relation; pairs: readonly ForeignKeyColumnPair[]; onChange: (next: ForeignKeyColumnPair[]) => void; idPrefix: string }) {
  const t = useT();
  const free = nextFreePair(pairs, source, target);
  return (
    <div className="pp-pairs" data-testid={`${idPrefix}-pairs`}>
      <ol className="pp-pair-list">
        {pairs.map((p, i) => (
          <li key={i} className="pp-pair-row" data-pair-index={i}>
            <ColumnSelect label={t('properties.fk.sourceColumn', { n: i + 1 })} relation={source} value={p.sourceColumnId} onChange={(id) => onChange(setPairColumn(pairs, i, 'source' satisfies PairSide, id))} />
            <div className="pp-pair-target">
              <Icon name="chevron-right" size={14} className="pp-pair-arrow" />
              <ColumnSelect label={t('properties.fk.targetColumn', { n: i + 1 })} relation={target} value={p.targetColumnId} onChange={(id) => onChange(setPairColumn(pairs, i, 'target' satisfies PairSide, id))} />
              <IconButton size="sm" icon="trash" label={t('properties.fk.removePair', { n: i + 1 })} disabled={pairs.length <= 1} onClick={() => onChange(pairs.filter((_, j) => j !== i))} />
            </div>
          </li>
        ))}
      </ol>
      <Button size="sm" icon="plus" disabled={!free} onClick={() => free && onChange([...pairs, free])}>
        {t('properties.fk.addPair')}
      </Button>
    </div>
  );
}

const cardinalityOptions = (t: ReturnType<typeof useT>, derived: string, values: Array<[string, string]>) => [{ value: '', label: t('properties.fk.card.auto', { value: derived }) }, ...values.map(([value, label]) => ({ value, label }))];

export function FkCard({ model, fk, defaultOpen = false }: { model: RelationalModel; fk: ForeignKey; defaultOpen?: boolean }) {
  const t = useT();
  const issueMap = useIssueMap();
  const [open, setOpen] = useState(defaultOpen);
  const source = model.relations[fk.sourceRelationId];
  const target = model.relations[fk.targetRelationId];
  const eff = fkCardinality(model, fk);
  const key = target ? fkTargetKey(target, fk).kind : 'none';
  const update = (label: string, patch: Parameters<typeof ops.updateForeignKey>[3]): boolean => runEdit(label, (d) => ops.updateForeignKey(d, model.id, fk.id, patch));
  const setCard = (field: 'childMax' | 'childMin' | 'parentMin', raw: string): boolean => {
    const cur = { ...(fk.cardinality ?? {}) } as Record<string, unknown>;
    if (raw === '') delete cur[field];
    else cur[field] = field === 'childMax' ? raw : Number(raw);
    return update(t('properties.fk.setCardinality'), { cardinality: Object.keys(cur).length ? (cur as ForeignKey['cardinality']) : undefined });
  };
  return (
    <li className="pp-card pp-fk" data-fk-id={fk.id}>
      <div className="pp-card-head">
        <button type="button" className="pp-fk-title" aria-expanded={open} title={describeForeignKey(model, fk)} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
          <span className="pp-fk-text">{describeForeignKey(model, fk)}</span>
        </button>
        <IssueDot issues={issuesOf(issueMap, { kind: 'foreignKey', id: fk.id })} />
        <IconButton size="sm" icon="cursor" label={t('properties.fk.select', { name: describeForeignKey(model, fk) })} onClick={() => selectForeignKeyEdge(fk.id)} />
        <IconButton size="sm" icon="trash" label={t('properties.fk.remove', { name: describeForeignKey(model, fk) })} onClick={() => void runEdit(t('properties.fk.removeLabel'), (d) => ops.removeForeignKey(d, model.id, fk.id))} />
      </div>
      <div className="pp-fk-badges">
        <Badge tone={key === 'none' ? 'warning' : 'fk'}>{t(`properties.fk.key.${key}`)}</Badge>
        {fk.columns.length > 1 ? <Badge tone="neutral">{t('properties.fk.composite', { count: fk.columns.length })}</Badge> : null}
      </div>
      {open && source && target ? (
        <div className="pp-fk-body" data-testid="fk-editor">
          <div className="pp-owner">
            <span className="pp-owner-label">{t('properties.fk.references')}</span>
            <span className="pp-mono">{target.name}</span>
          </div>
          <PairEditor source={source} target={target} pairs={fk.columns} idPrefix={fk.id} onChange={(columns) => void update(t('properties.fk.setPairs'), { columns })} />
          <div className="pp-pair">
            <Select label={t('properties.fk.onDelete')} value={fk.onDelete ?? ''} options={[{ value: '', label: t('properties.fk.actionDefault') }, ...ACTIONS.map((a) => ({ value: a, label: a }))]} onChange={(v) => update(t('properties.fk.setAction'), { onDelete: v === '' ? undefined : (v as ReferentialAction) })} />
            <Select label={t('properties.fk.onUpdate')} value={fk.onUpdate ?? ''} options={[{ value: '', label: t('properties.fk.actionDefault') }, ...ACTIONS.map((a) => ({ value: a, label: a }))]} onChange={(v) => update(t('properties.fk.setAction'), { onUpdate: v === '' ? undefined : (v as ReferentialAction) })} />
          </div>
          <div className="pp-pair">
            <CommitInput label={t('properties.fk.name')} mono value={fk.name ?? ''} onCommit={(v) => update(t('properties.fk.rename'), { name: v === '' ? undefined : v })} />
            <CommitInput label={t('properties.fk.label')} value={fk.label ?? ''} onCommit={(v) => update(t('properties.fk.setLabel'), { label: v === '' ? undefined : v })} />
          </div>
          <fieldset className="pp-fieldset">
            <legend>{t('properties.fk.cardinality')}</legend>
            <Select label={t('properties.fk.childMax')} value={fk.cardinality?.childMax ?? ''} options={cardinalityOptions(t, t(`properties.fk.max.${eff.childMax}`), [['one', t('properties.fk.max.one')], ['many', t('properties.fk.max.many')]])} onChange={(v) => setCard('childMax', v)} />
            <div className="pp-pair">
              <Select label={t('properties.fk.childMin')} value={fk.cardinality?.childMin === undefined ? '' : String(fk.cardinality.childMin)} options={cardinalityOptions(t, String(eff.childMin), [['0', '0'], ['1', '1']])} onChange={(v) => setCard('childMin', v)} />
              <Select label={t('properties.fk.parentMin')} value={fk.cardinality?.parentMin === undefined ? '' : String(fk.cardinality.parentMin)} options={cardinalityOptions(t, String(eff.parentMin), [['0', '0'], ['1', '1']])} onChange={(v) => setCard('parentMin', v)} />
            </div>
          </fieldset>
        </div>
      ) : null}
    </li>
  );
}

/** Creation form: choose the referenced table and map columns, or let the panel create the FK columns for you. */
function NewFkForm({ model, relation, onCreated, onCancel }: { model: RelationalModel; relation: Relation; onCreated: (id: Id) => void; onCancel: () => void }) {
  const t = useT();
  const relations = Object.values(model.relations).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const firstOther = relations.find((r) => r.id !== relation.id) ?? relation;
  const [targetId, setTargetId] = useState(firstOther.id);
  const target = model.relations[targetId] ?? firstOther;
  const initial = (tg: Relation): ForeignKeyColumnPair[] => {
    const byKey = pairsForTargetKey(relation, tg);
    if (byKey.length) return byKey;
    const one = nextFreePair([], relation, tg);
    return one ? [one] : [];
  };
  const [pairs, setPairs] = useState<ForeignKeyColumnPair[]>(() => initial(firstOther));
  const canCreateColumns = target.primaryKey.length > 0;
  const create = (): void => {
    let id: Id | undefined;
    const ok = runEdit(t('properties.fk.createLabel'), (d) => {
      id = ops.addForeignKey(d, model.id, { sourceRelationId: relation.id, targetRelationId: target.id, columns: pairs }).refs[0]!.id;
    });
    if (ok && id) onCreated(id);
  };
  const createWithColumns = (): void => {
    let id: Id | undefined;
    const ok = runEdit(t('properties.fk.createWithColumnsLabel'), (d) => {
      const made = ops.createFkColumns(d, model.id, { sourceRelationId: relation.id, targetRelationId: target.id });
      id = ops.addForeignKey(d, model.id, { sourceRelationId: relation.id, targetRelationId: target.id, columns: made.pairs }).refs[0]!.id;
    });
    if (ok && id) onCreated(id);
  };
  return (
    <div className="pp-card pp-newfk" data-testid="new-fk-form">
      <Select
        label={t('properties.fk.target')}
        value={targetId}
        options={relations.map((r) => ({ value: r.id, label: r.id === relation.id ? t('properties.fk.selfOption', { name: r.name }) : r.name }))}
        onChange={(id) => {
          setTargetId(id);
          const tg = model.relations[id];
          if (tg) setPairs(initial(tg));
        }}
      />
      {pairs.length > 0 ? (
        <PairEditor source={relation} target={target} pairs={pairs} idPrefix="new" onChange={setPairs} />
      ) : (
        <Note tone="warning">{t('properties.fk.noFreeColumns')}</Note>
      )}
      <div className="pp-actions">
        <Button size="sm" variant="primary" disabled={pairs.length === 0} onClick={create}>
          {t('properties.fk.create')}
        </Button>
        <Button size="sm" disabled={!canCreateColumns} title={canCreateColumns ? undefined : t('properties.fk.noTargetKey')} onClick={createWithColumns}>
          {t('properties.fk.createColumns')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
      <Note>{t('properties.fk.createColumnsHint')}</Note>
    </div>
  );
}

export function ForeignKeySection({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  const fks = foreignKeysOf(model, relation.id).sort((a, b) => describeForeignKey(model, a).localeCompare(describeForeignKey(model, b)) || a.id.localeCompare(b.id));
  const [adding, setAdding] = useState(false);
  const [justCreated, setJustCreated] = useState<Id | undefined>();
  return (
    <Section
      title={t('properties.fk.title')}
      testId="fk-section"
      actions={
        <Button size="sm" icon="plus" data-testid="add-fk" disabled={adding} onClick={() => setAdding(true)}>
          {t('properties.fk.add')}
        </Button>
      }
    >
      {fks.length === 0 && !adding ? <Note>{t('properties.fk.empty')}</Note> : null}
      <ul className="pp-cards">
        {fks.map((fk) => (
          <FkCard key={fk.id} model={model} fk={fk} defaultOpen={fk.id === justCreated} />
        ))}
      </ul>
      {adding ? (
        <NewFkForm
          model={model}
          relation={relation}
          onCancel={() => setAdding(false)}
          onCreated={(id) => {
            setJustCreated(id);
            setAdding(false);
          }}
        />
      ) : null}
    </Section>
  );
}

export function IncomingFkSection({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  const incoming = foreignKeysReferencing(model, relation.id);
  if (incoming.length === 0) return null;
  return (
    <Section title={t('properties.fk.incoming')} collapsible defaultOpen={false} testId="incoming-fk-section">
      <ul className="pp-plain-list">
        {incoming.map((fk) => (
          <li key={fk.id}>
            <button type="button" className="pp-link" onClick={() => selectForeignKeyEdge(fk.id)}>
              {describeForeignKey(model, fk)}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
