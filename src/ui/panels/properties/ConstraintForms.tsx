/** Primary key order, UNIQUE constraints, indexes and CHECK constraints of a relation. */
import { useState } from 'react';
import * as ops from '@/model/ops';
import type { Id, Relation, RelationalModel } from '@/model/types';
import { useT } from '@/i18n';
import { Button, Checkbox, IconButton } from '../../components';
import { runEdit } from './edit';
import { moveInList, toggleInSet } from './forms';
import { CommitInput, Note, Section, ToggleChip } from './parts';

const colName = (rel: Relation, id: Id): string => rel.columns.find((c) => c.id === id)?.name || '?';

/** Column chips: pressed = the column is part of the constraint. Each toggle is one edit. */
function ColumnChips({ relation, columnIds, label, onChange }: { relation: Relation; columnIds: readonly Id[]; label: string; onChange: (next: Id[]) => void }) {
  const t = useT();
  return (
    <div className="pp-colchips" role="group" aria-label={label}>
      {relation.columns.map((c) => (
        <ToggleChip key={c.id} pressed={columnIds.includes(c.id)} onToggle={(on) => onChange(toggleInSet(columnIds, c.id, on))} label={`${label}: ${c.name}`} title={t('properties.cons.toggleColumn', { name: c.name })}>
          {c.name || '?'}
        </ToggleChip>
      ))}
    </div>
  );
}

export function PrimaryKeySection({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  const pk = relation.primaryKey;
  const set = (ids: Id[]): void => void runEdit(t('properties.pk.reorder'), (d) => ops.setPrimaryKey(d, model.id, relation.id, ids));
  return (
    <Section title={t('properties.pk.title')} testId="pk-section">
      {pk.length === 0 ? <Note tone="warning">{t('properties.pk.none')}</Note> : null}
      {pk.length > 0 ? (
        <ol className="pp-pk-order" aria-label={t('properties.pk.order')}>
          {pk.map((id, i) => (
            <li key={id} className="pp-pk-item" data-testid="pk-item">
              <span className="pp-pk-name">{colName(relation, id)}</span>
              <IconButton size="sm" icon="chevron-left" label={t('properties.pk.moveEarlier', { name: colName(relation, id) })} disabled={i === 0} onClick={() => set(moveInList(pk, i, -1))} />
              <IconButton size="sm" icon="chevron-right" label={t('properties.pk.moveLater', { name: colName(relation, id) })} disabled={i === pk.length - 1} onClick={() => set(moveInList(pk, i, 1))} />
            </li>
          ))}
        </ol>
      ) : null}
      {pk.length > 1 ? <Note>{t('properties.pk.compositeHint')}</Note> : null}
      <CommitInput label={t('properties.pk.name')} mono value={relation.primaryKeyName ?? ''} placeholder={t('properties.pk.namePlaceholder')} onCommit={(v) => runEdit(t('properties.pk.rename'), (d) => ops.updateRelation(d, model.id, relation.id, { primaryKeyName: v === '' ? undefined : v }))} />
    </Section>
  );
}

export function UniqueSection({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  return (
    <Section
      title={t('properties.uq.title')}
      collapsible
      defaultOpen={relation.uniques.length > 0}
      testId="unique-section"
      actions={
        <Button
          size="sm"
          icon="plus"
          disabled={relation.columns.length === 0}
          onClick={() => void runEdit(t('properties.uq.addLabel'), (d) => void ops.addUnique(d, model.id, relation.id, { columnIds: [relation.columns[0]!.id] }))}
        >
          {t('properties.uq.add')}
        </Button>
      }
    >
      {relation.uniques.length === 0 ? <Note>{t('properties.uq.empty')}</Note> : null}
      <ul className="pp-cards">
        {relation.uniques.map((u, i) => (
          <li key={u.id} className="pp-card" data-unique-id={u.id}>
            <div className="pp-card-head">
              <CommitInput
                label={t('properties.uq.name', { n: i + 1 })}
                hideLabel
                mono
                className="pp-grow"
                value={u.name ?? ''}
                placeholder={t('properties.uq.namePlaceholder')}
                onCommit={(v) => runEdit(t('properties.uq.rename'), (d) => ops.updateUnique(d, model.id, relation.id, u.id, { name: v === '' ? undefined : v }))}
              />
              <IconButton size="sm" icon="trash" label={t('properties.uq.remove', { n: i + 1 })} onClick={() => void runEdit(t('properties.uq.removeLabel'), (d) => ops.removeUnique(d, model.id, relation.id, u.id))} />
            </div>
            <ColumnChips relation={relation} columnIds={u.columnIds} label={t('properties.uq.columns', { n: i + 1 })} onChange={(columnIds) => void runEdit(t('properties.uq.setColumns'), (d) => ops.updateUnique(d, model.id, relation.id, u.id, { columnIds }))} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function IndexSection({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  return (
    <Section
      title={t('properties.idx.title')}
      collapsible
      defaultOpen={relation.indexes.length > 0}
      testId="index-section"
      actions={
        <Button size="sm" icon="plus" disabled={relation.columns.length === 0} onClick={() => void runEdit(t('properties.idx.addLabel'), (d) => void ops.addIndex(d, model.id, relation.id, { columnIds: [relation.columns[0]!.id] }))}>
          {t('properties.idx.add')}
        </Button>
      }
    >
      {relation.indexes.length === 0 ? <Note>{t('properties.idx.empty')}</Note> : null}
      <ul className="pp-cards">
        {relation.indexes.map((ix, i) => (
          <li key={ix.id} className="pp-card" data-index-id={ix.id}>
            <div className="pp-card-head">
              <CommitInput
                label={t('properties.idx.name', { n: i + 1 })}
                hideLabel
                required
                mono
                className="pp-grow"
                value={ix.name}
                onCommit={(v) => runEdit(t('properties.idx.rename'), (d) => ops.updateIndex(d, model.id, relation.id, ix.id, { name: v }))}
              />
              <IconButton size="sm" icon="trash" label={t('properties.idx.remove', { name: ix.name })} onClick={() => void runEdit(t('properties.idx.removeLabel'), (d) => ops.removeIndex(d, model.id, relation.id, ix.id))} />
            </div>
            <ColumnChips relation={relation} columnIds={ix.columnIds} label={t('properties.idx.columns', { name: ix.name })} onChange={(columnIds) => void runEdit(t('properties.idx.setColumns'), (d) => ops.updateIndex(d, model.id, relation.id, ix.id, { columnIds }))} />
            <Checkbox label={t('properties.idx.unique')} checked={ix.unique} onChange={(unique) => void runEdit(t('properties.idx.toggleUnique'), (d) => ops.updateIndex(d, model.id, relation.id, ix.id, { unique }))} />
            <div className="pp-pair">
              <CommitInput label={t('properties.idx.method')} mono value={ix.method ?? ''} placeholder="btree" onCommit={(v) => runEdit(t('properties.idx.setMethod'), (d) => ops.updateIndex(d, model.id, relation.id, ix.id, { method: v === '' ? undefined : v }))} />
              <CommitInput label={t('properties.idx.where')} mono value={ix.where ?? ''} placeholder={t('properties.idx.wherePlaceholder')} onCommit={(v) => runEdit(t('properties.idx.setWhere'), (d) => ops.updateIndex(d, model.id, relation.id, ix.id, { where: v === '' ? undefined : v }))} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function CheckSection({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  const checks = relation.checks ?? [];
  const [expr, setExpr] = useState('');
  const [name, setName] = useState('');
  const add = (): void => {
    if (expr.trim() === '') return;
    if (runEdit(t('properties.chk.addLabel'), (d) => void ops.addCheck(d, model.id, relation.id, { expression: expr.trim(), ...(name.trim() ? { name: name.trim() } : {}) }))) {
      setExpr('');
      setName('');
    }
  };
  return (
    <Section title={t('properties.chk.title')} collapsible defaultOpen={checks.length > 0} testId="check-section">
      {checks.length === 0 ? <Note>{t('properties.chk.empty')}</Note> : null}
      <ul className="pp-cards">
        {checks.map((c, i) => (
          <li key={c.id} className="pp-card">
            <div className="pp-card-head">
              <code className="pp-code pp-grow" title={c.expression}>
                {c.name ? `${c.name}: ` : ''}
                {c.expression}
              </code>
              <IconButton size="sm" icon="trash" label={t('properties.chk.remove', { n: i + 1 })} onClick={() => void runEdit(t('properties.chk.removeLabel'), (d) => ops.removeCheck(d, model.id, relation.id, c.id))} />
            </div>
          </li>
        ))}
      </ul>
      <div className="pp-add-check">
        <label className="sc-field">
          <span className="sc-field-label">{t('properties.chk.expression')}</span>
          <input className="sc-input is-mono" value={expr} placeholder={t('properties.chk.expressionPlaceholder')} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <label className="sc-field">
          <span className="sc-field-label">{t('properties.chk.name')}</span>
          <input className="sc-input is-mono" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <div>
          <Button size="sm" icon="plus" disabled={expr.trim() === ''} onClick={add}>
            {t('properties.chk.add')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
