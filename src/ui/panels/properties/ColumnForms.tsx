/** Columns of a relation: the editable list (table panel) and the focused editor of one selected cell. */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import * as ops from '@/model/ops';
import { columnRole, describeForeignKey, foreignKeysOf, foreignKeysReferencing } from '@/model/queries';
import type { Id, RelColumn, Relation, RelationalModel } from '@/model/types';
import { editorStore } from '@/store';
import { useT } from '@/i18n';
import { Button, Checkbox, IconButton, NumberField } from '../../components';
import { Icon } from '../../icons';
import { issuesOf, runEdit, useActive, useIssueMap } from './edit';
import { togglePrimaryKey } from './forms';
import { TableHeader } from './Header';
import { selectForeignKeyEdge, selectRef } from './nav';
import { CommitInput, IssueBadges, IssueDot, Note, Section, SQL_TYPES_ID, ToggleChip } from './parts';

let pendingFocus: Id | null = null;
/** A just-added column: focus (and select) its NAME field rather than the drag handle. */
let pendingNameFocus: Id | null = null;
const DRAG_MIME = 'application/x-schemacanvas-column';

/** All edits of one column, shared by the list rows and the focused editor. */
export function useColumnActions(model: RelationalModel, relation: Relation, column: RelColumn) {
  const t = useT();
  const index = relation.columns.findIndex((c) => c.id === column.id);
  const update = (label: string, patch: ops.ColumnPatch): boolean => runEdit(label, (d) => ops.updateColumn(d, model.id, relation.id, column.id, patch));
  const isPk = relation.primaryKey.includes(column.id);
  const isUnique = relation.uniques.some((u) => u.columnIds.length === 1 && u.columnIds[0] === column.id);
  return {
    index,
    isPk,
    isUnique,
    rename: (name: string) => update(t('properties.col.rename'), { name }),
    setType: (v: string) => update(t('properties.col.setType'), { dataType: v === '' ? undefined : v }),
    setDefault: (v: string) => update(t('properties.col.setDefault'), { defaultValue: v === '' ? undefined : v }),
    setDescription: (v: string) => update(t('properties.col.describe'), { description: v === '' ? undefined : v }),
    togglePk: (on: boolean) => runEdit(t('properties.col.togglePk'), (d) => ops.setPrimaryKey(d, model.id, relation.id, togglePrimaryKey(relation.primaryKey, column.id, on))),
    toggleNotNull: (on: boolean) => update(t('properties.col.toggleNotNull'), { nullable: !on }),
    toggleUnique: (on: boolean) => runEdit(t('properties.col.toggleUnique'), (d) => void ops.setColumnUnique(d, model.id, relation.id, column.id, on)),
    toggleAuto: (on: boolean) => update(t('properties.col.toggleAuto'), { autoIncrement: on ? true : undefined }),
    move: (toIndex: number) => {
      if (toIndex < 0 || toIndex >= relation.columns.length || toIndex === index) return;
      pendingFocus = column.id;
      runEdit(t('properties.col.reorder'), (d) => ops.reorderColumn(d, model.id, relation.id, column.id, toIndex));
    },
    remove: () => runEdit(t('properties.col.removeLabel'), (d) => ops.removeColumn(d, model.id, relation.id, column.id)),
  };
}

function ColumnRow({ model, relation, column, dragState }: { model: RelationalModel; relation: Relation; column: RelColumn; dragState: { over: number | null; setOver(i: number | null): void } }) {
  const t = useT();
  const issueMap = useIssueMap();
  const [open, setOpen] = useState(false);
  const handle = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const a = useColumnActions(model, relation, column);
  const role = columnRole(model, relation.id, column.id);
  const count = relation.columns.length;
  useEffect(() => {
    if (pendingFocus === column.id) {
      pendingFocus = null;
      handle.current?.focus();
    }
    if (pendingNameFocus === column.id) {
      pendingNameFocus = null;
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  });
  const onDrop = (e: DragEvent): void => {
    const from = e.dataTransfer.getData(DRAG_MIME);
    dragState.setOver(null);
    if (!from || from === column.id) return;
    e.preventDefault();
    runEdit(t('properties.col.reorder'), (d) => ops.reorderColumn(d, model.id, relation.id, from, a.index));
  };
  const refs = issuesOf(issueMap, { kind: 'column', relationId: relation.id, id: column.id });
  return (
    <li
      className={`pp-row${dragState.over === a.index ? ' is-drop' : ''}`}
      data-column-id={column.id}
      data-role={role}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          dragState.setOver(a.index);
        }
      }}
      onDragLeave={() => dragState.setOver(null)}
      onDrop={onDrop}
    >
      <div className="pp-row-main">
        <button
          ref={handle}
          type="button"
          draggable
          className="pp-handle"
          aria-label={t('properties.col.handle', { name: column.name })}
          title={t('properties.col.handleHint')}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, column.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => dragState.setOver(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              a.move(a.index + (e.key === 'ArrowUp' ? -1 : 1));
            }
          }}
        >
          <Icon name="more" size={14} />
        </button>
        <CommitInput
          label={t('properties.col.name')}
          hideLabel
          required
          className="pp-grow"
          inputRef={nameInput}
          value={column.name}
          inputClassName={`is-role-${role.replace('+', '-')}`}
          onCommit={a.rename}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault();
              pendingFocus = null;
              a.move(a.index + (e.key === 'ArrowUp' ? -1 : 1));
            }
          }}
        />
        <IssueDot issues={refs} />
        <div className="pp-chips">
          <ToggleChip tone="key" pressed={a.isPk} onToggle={a.togglePk} label={t('properties.col.pk')} title={t('properties.col.pkHint')}>
            PK
          </ToggleChip>
          <ToggleChip pressed={!column.nullable} disabled={a.isPk} onToggle={a.toggleNotNull} label={t('properties.col.notNull')} title={a.isPk ? t('properties.col.notNullPk') : t('properties.col.notNullHint')}>
            NN
          </ToggleChip>
          <ToggleChip pressed={a.isUnique} onToggle={a.toggleUnique} label={t('properties.col.unique')} title={t('properties.col.uniqueHint')}>
            UQ
          </ToggleChip>
          <ToggleChip pressed={!!column.autoIncrement} onToggle={a.toggleAuto} label={t('properties.col.auto')} title={t('properties.col.autoHint')}>
            AI
          </ToggleChip>
        </div>
      </div>
      <div className="pp-row-sub">
        <CommitInput label={t('properties.col.dataType')} hideLabel mono className="pp-grow" list={SQL_TYPES_ID} value={column.dataType ?? ''} placeholder={t('properties.col.dataTypePlaceholder')} onCommit={a.setType} />
        <IconButton size="sm" icon="chevron-up" label={t('properties.col.moveUp', { name: column.name })} disabled={a.index === 0} onClick={() => a.move(a.index - 1)} />
        <IconButton size="sm" icon="chevron-down" label={t('properties.col.moveDown', { name: column.name })} disabled={a.index === count - 1} onClick={() => a.move(a.index + 1)} />
        <IconButton size="sm" icon={open ? 'chevron-up' : 'settings'} pressed={open} label={t('properties.col.details', { name: column.name })} onClick={() => setOpen(!open)} />
        <IconButton size="sm" icon="trash" label={t('properties.col.remove', { name: column.name })} onClick={a.remove} />
      </div>
      {open ? (
        <div className="pp-row-details">
          <CommitInput label={t('properties.col.default')} mono value={column.defaultValue ?? ''} placeholder={t('properties.col.defaultPlaceholder')} onCommit={a.setDefault} />
          <CommitInput label={t('properties.col.description')} value={column.description ?? ''} onCommit={a.setDescription} trim={false} />
        </div>
      ) : null}
    </li>
  );
}

export function ColumnList({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  const [over, setOver] = useState<number | null>(null);
  return (
    <Section
      title={t('properties.col.title')}
      testId="columns-section"
      actions={
        <Button
          size="sm"
          icon="plus"
          data-testid="add-column"
          onClick={() => {
            let id: Id | undefined;
            runEdit(t('properties.col.addLabel'), (d) => {
              id = ops.addColumn(d, model.id, relation.id, {}).refs[0]!.id;
            });
            if (id) pendingNameFocus = id;
          }}
        >
          {t('properties.col.add')}
        </Button>
      }
    >
      {relation.columns.length === 0 ? <Note>{t('properties.col.empty')}</Note> : null}
      <ul className="pp-list" data-testid="column-list">
        {relation.columns.map((c) => (
          <ColumnRow key={c.id} model={model} relation={relation} column={c} dragState={{ over, setOver }} />
        ))}
      </ul>
    </Section>
  );
}

/** Selection is one column cell: its own editor, with the table one click away. */
export function ColumnPanel({ model, relation, column, nodeId }: { model: RelationalModel; relation: Relation; column: RelColumn; nodeId: Id }) {
  const t = useT();
  const { diagramId } = useActive();
  const issueMap = useIssueMap();
  const a = useColumnActions(model, relation, column);
  const outgoing = foreignKeysOf(model, relation.id).filter((fk) => fk.columns.some((p) => p.sourceColumnId === column.id));
  const incoming = foreignKeysReferencing(model, relation.id).filter((fk) => fk.columns.some((p) => p.targetColumnId === column.id));
  const width = editorStore.getState().project.diagrams[diagramId ?? '']?.nodes[nodeId]?.columnWidths?.[column.id];
  const role = columnRole(model, relation.id, column.id);
  return (
    <>
      <TableHeader model={model} relation={relation} highlightColumnId={column.id} kind={t('properties.kind.column')} />
      <IssueBadges issues={issuesOf(issueMap, { kind: 'column', relationId: relation.id, id: column.id })} />
      <Section title={t('properties.section.general')} testId="column-focus">
        <CommitInput label={t('properties.col.name')} required value={column.name} inputClassName={`is-role-${role.replace('+', '-')}`} onCommit={a.rename} />
        <CommitInput label={t('properties.col.dataType')} mono list={SQL_TYPES_ID} value={column.dataType ?? ''} placeholder={t('properties.col.dataTypePlaceholder')} onCommit={a.setType} />
        <div className="pp-checks">
          <Checkbox label={t('properties.col.pk')} checked={a.isPk} onChange={a.togglePk} />
          <Checkbox label={t('properties.col.notNull')} checked={!column.nullable} disabled={a.isPk} onChange={a.toggleNotNull} />
          <Checkbox label={t('properties.col.unique')} checked={a.isUnique} onChange={a.toggleUnique} />
          <Checkbox label={t('properties.col.auto')} checked={!!column.autoIncrement} onChange={a.toggleAuto} />
        </div>
        <CommitInput label={t('properties.col.default')} mono value={column.defaultValue ?? ''} placeholder={t('properties.col.defaultPlaceholder')} onCommit={a.setDefault} />
        <CommitInput label={t('properties.col.description')} value={column.description ?? ''} onCommit={a.setDescription} trim={false} />
        {diagramId ? (
          <NumberField
            label={t('properties.col.width')}
            value={width}
            placeholder={t('properties.auto')}
            min={24}
            max={800}
            suffix="px"
            onChange={(v) => void runEdit(t('properties.col.setWidth'), (d) => ops.setColumnWidth(d, diagramId, nodeId, column.id, v))}
          />
        ) : null}
        <div>
          <button type="button" className="pp-link" onClick={() => editorStore.getState().setSelection([nodeId])}>
            {t('properties.col.backToTable', { name: relation.name })}
          </button>
        </div>
      </Section>
      {outgoing.length + incoming.length > 0 ? (
        <Section title={t('properties.col.references')}>
          <ul className="pp-plain-list">
            {outgoing.map((fk) => (
              <li key={fk.id}>
                <button type="button" className="pp-link" onClick={() => selectForeignKeyEdge(fk.id)}>
                  {describeForeignKey(model, fk)}
                </button>
              </li>
            ))}
            {incoming.map((fk) => (
              <li key={fk.id}>
                <button type="button" className="pp-link" onClick={() => selectForeignKeyEdge(fk.id) || selectRef({ kind: 'relation', id: fk.sourceRelationId })}>
                  {t('properties.col.referencedBy', { fk: describeForeignKey(model, fk) })}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
