/** Attribute list of an entity, relationship or composite attribute: add (with flavour), rename, reorder, flags, nesting. */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import * as ops from '@/model/ops';
import { attributesOf } from '@/model/queries';
import type { ErAttribute, ErAttributeOwner, ErKeyKind, ErModel, Id, SemanticRef } from '@/model/types';
import { editorStore } from '@/store';
import { useT } from '@/i18n';
import { Button, Checkbox, IconButton, MenuButton, Select, type MenuEntry } from '../../components';
import { Icon } from '../../icons';
import { issuesOf, runEdit, useIssueMap } from './edit';
import { CommitInput, IssueDot, SQL_TYPES_ID } from './parts';
import { canMoveTo, moveAttributeTo } from './attrMove';
import { placeBesideOwner } from './placement';

type Flavor = 'simple' | 'key' | 'partial-key' | 'multivalued' | 'derived' | 'composite';

/** Module-level on purpose: the row to focus is created by a commit and mounts after it. */
let pendingFocus: Id | null = null;
const wantFocus = (id: Id): void => {
  pendingFocus = id;
};

const DRAG_MIME = 'application/x-schemacanvas-attribute';

/** Drop handlers that re-parent a dragged attribute row onto `owner` (one commit, one undo step). */
function useAttributeDrop(model: ErModel, owner: ErAttributeOwner, setOver: (v: boolean) => void) {
  const dragged = (e: DragEvent): Id | undefined => (e.dataTransfer.types.includes(DRAG_MIME) ? (e.dataTransfer.getData(DRAG_MIME) || dragId || undefined) : undefined);
  return {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      // the id is only readable on drop; the live drag id (module state) lets us refuse impossible targets while hovering
      if (dragId && !canMoveTo(model, dragId, owner)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      setOver(false);
      const id = dragged(e);
      if (!id || !canMoveTo(model, id, owner)) return;
      e.preventDefault();
      e.stopPropagation();
      moveAttributeTo(model.id, id, owner, editorStore.getState().activeDiagramId);
    },
  };
}
let dragId: Id | null = null;

const ownerRef = (owner: ErAttributeOwner): SemanticRef => ({ kind: owner.kind, id: owner.id });

export function addAttributeOfFlavor(modelId: Id, owner: ErAttributeOwner, flavor: Flavor, label: string): Id | undefined {
  const diagramId = editorStore.getState().activeDiagramId;
  let created: Id | undefined;
  runEdit(label, (d) => {
    const init =
      flavor === 'key'
        ? { key: 'primary' as const, name: undefined }
        : flavor === 'partial-key'
          ? { key: 'partial' as const }
          : flavor === 'multivalued'
            ? { multivalued: true }
            : flavor === 'derived'
              ? { derived: true }
              : {};
    const res = ops.addAttribute(d, modelId, owner, flavor === 'composite' ? { name: 'Composite' } : init);
    created = res.refs[0]!.id;
    const nodeIds = diagramId ? [...(res.nodeIds[diagramId] ?? [])] : [];
    if (flavor === 'composite') {
      for (const n of ['Part 1', 'Part 2']) {
        const child = ops.addAttribute(d, modelId, { kind: 'attribute', id: created }, { name: n });
        if (diagramId) nodeIds.push(...(child.nodeIds[diagramId] ?? []));
      }
    }
    if (diagramId) placeBesideOwner(d, diagramId, ownerRef(owner), nodeIds);
  });
  if (created) wantFocus(created);
  return created;
}

export function AddAttributeMenu({ model, owner }: { model: ErModel; owner: ErAttributeOwner }) {
  const t = useT();
  const entity = owner.kind === 'entity' ? model.entities[owner.id] : undefined;
  const entries = (): MenuEntry[] => {
    const add = (flavor: Flavor, key: string): MenuEntry => ({ id: flavor, label: t(key), onSelect: () => void addAttributeOfFlavor(model.id, owner, flavor, t(`properties.attrs.add.${flavor}`)) });
    const list: MenuEntry[] = [add('simple', 'properties.flavor.simple')];
    if (owner.kind === 'entity') list.push(add('key', 'properties.flavor.key'));
    if (entity?.weak) list.push(add('partial-key', 'properties.flavor.partialKey'));
    list.push(add('multivalued', 'properties.flavor.multivalued'), add('derived', 'properties.flavor.derived'), add('composite', 'properties.flavor.composite'));
    return list;
  };
  return (
    <MenuButton
      label={t('properties.attrs.addMenu')}
      entries={entries}
      trigger={
        <Button size="sm" icon="plus" data-testid="add-attribute">
          {t('properties.attrs.add')}
        </Button>
      }
    />
  );
}

function AttributeRow({ model, attr, index, count, depth }: { model: ErModel; attr: ErAttribute; index: number; count: number; depth: number }) {
  const t = useT();
  const issueMap = useIssueMap();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const drop = useAttributeDrop(model, { kind: 'attribute', id: attr.id }, setOver);
  const input = useRef<HTMLInputElement>(null);
  const topLevel = attr.owner.kind !== 'attribute';
  const children = attributesOf(model, { kind: 'attribute', id: attr.id });
  useEffect(() => {
    if (pendingFocus === attr.id) {
      pendingFocus = null;
      input.current?.focus();
      input.current?.select();
    }
  });
  const patch = (label: string, p: ops.AttributePatch): boolean => runEdit(label, (d) => ops.updateAttribute(d, model.id, attr.id, p));
  const move = (delta: number): void => {
    if (index + delta < 0 || index + delta >= count) return;
    wantFocus(attr.id);
    runEdit(t('properties.attrs.reorder'), (d) => ops.reorderAttribute(d, model.id, attr.id, index + delta));
  };
  const flags = [attr.key === 'primary' ? t('properties.attr.keyShort') : attr.key === 'partial' ? t('properties.attr.partialShort') : '', attr.multivalued ? t('properties.attr.multiShort') : '', attr.derived ? t('properties.attr.derivedShort') : ''].filter(Boolean);
  return (
    <li className={`pp-row${over ? ' is-drop' : ''}`} data-attr-id={attr.id} data-depth={depth} {...(children.length > 0 ? drop : {})}>
      <div className="pp-row-main">
        <button
          type="button"
          draggable
          className="pp-handle"
          aria-hidden="true"
          tabIndex={-1}
          title={t('properties.attrs.dragHint')}
          data-testid="attr-drag-handle"
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, attr.id);
            e.dataTransfer.effectAllowed = 'move';
            dragId = attr.id;
          }}
          onDragEnd={() => {
            dragId = null;
          }}
        >
          <Icon name="more" size={14} />
        </button>
        <button type="button" className="pp-row-toggle" aria-expanded={open} aria-label={t('properties.attrs.details', { name: attr.name })} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
        <CommitInput
          label={t('properties.attrs.name')}
          hideLabel
          required
          value={attr.name}
          inputRef={input}
          inputClassName={attr.key === 'primary' ? 'is-key' : attr.key === 'partial' ? 'is-partial' : undefined}
          onCommit={(name) => patch(t('properties.attrs.rename'), { name })}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault();
              move(e.key === 'ArrowUp' ? -1 : 1);
            }
          }}
          className="pp-grow"
        />
        <span className="pp-flags" aria-hidden="true">
          {flags.join(' ')}
        </span>
        <IssueDot issues={issuesOf(issueMap, { kind: 'attribute', id: attr.id })} />
        <IconButton size="sm" icon="chevron-up" label={t('properties.attrs.moveUp', { name: attr.name })} disabled={index === 0} onClick={() => move(-1)} />
        <IconButton size="sm" icon="chevron-down" label={t('properties.attrs.moveDown', { name: attr.name })} disabled={index === count - 1} onClick={() => move(1)} />
        <IconButton size="sm" icon="trash" label={t('properties.attrs.remove', { name: attr.name })} onClick={() => runEdit(t('properties.attrs.removeLabel'), (d) => ops.removeAttribute(d, model.id, attr.id))} />
      </div>
      {open ? (
        <div className="pp-row-details">
          {topLevel ? (
            <Select
              label={t('properties.attr.key')}
              value={attr.key}
              options={[
                { value: 'none', label: t('properties.key.none') },
                { value: 'primary', label: t('properties.key.primary') },
                { value: 'partial', label: t('properties.key.partial') },
              ]}
              onChange={(v) => patch(t('properties.attrs.setKey'), { key: v as ErKeyKind })}
            />
          ) : null}
          <div className="pp-checks">
            <Checkbox label={t('properties.attr.multivalued')} checked={attr.multivalued} onChange={(v) => patch(t('properties.attrs.toggle'), { multivalued: v })} />
            <Checkbox label={t('properties.attr.derived')} checked={attr.derived} onChange={(v) => patch(t('properties.attrs.toggle'), { derived: v })} />
            <Checkbox label={t('properties.attr.optional')} checked={!!attr.optional} disabled={attr.key !== 'none'} onChange={(v) => patch(t('properties.attrs.toggle'), { optional: v ? true : undefined })} />
          </div>
          <CommitInput label={t('properties.attr.dataType')} mono list={SQL_TYPES_ID} value={attr.dataType ?? ''} placeholder={t('properties.attr.dataTypePlaceholder')} onCommit={(v) => patch(t('properties.attrs.setType'), { dataType: v || undefined })} />
          <div>
            <Button size="sm" icon="plus" onClick={() => void addAttributeOfFlavor(model.id, { kind: 'attribute', id: attr.id }, 'simple', t('properties.attrs.add.sub'))}>
              {t('properties.attrs.addSub')}
            </Button>
          </div>
        </div>
      ) : null}
      {children.length > 0 ? <AttributeList model={model} owner={{ kind: 'attribute', id: attr.id }} depth={depth + 1} /> : null}
    </li>
  );
}

export function AttributeList({ model, owner, depth = 0 }: { model: ErModel; owner: ErAttributeOwner; depth?: number }) {
  const attrs = attributesOf(model, owner);
  const [over, setOver] = useState(false);
  // the top-level list stands for its entity / relationship: dropping a nested attribute on it moves that attribute out to the owner
  const drop = useAttributeDrop(model, owner, setOver);
  if (attrs.length === 0) return null;
  return (
    <ul className={`pp-list${depth > 0 ? ' pp-list-nested' : ''}${over && depth === 0 ? ' is-drop' : ''}`} data-testid={depth === 0 ? 'attribute-list' : undefined} {...(depth === 0 ? drop : {})}>
      {attrs.map((a, i) => (
        <AttributeRow key={a.id} model={model} attr={a} index={i} count={attrs.length} depth={depth} />
      ))}
    </ul>
  );
}
