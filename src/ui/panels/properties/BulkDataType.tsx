/** Bulk fix for "column without a data type": pick ONE type, apply it to every untyped column of the given tables in one commit. */
import { useState } from 'react';
import * as ops from '@/model/ops';
import type { Id, Project, RelationalModel } from '@/model/types';
import { tp, useT } from '@/i18n';
import { Button, Select } from '../../components';
import { uiStore } from '../../uiStore';
import { runEdit } from './edit';
import { SQL_TYPES } from './parts';

export interface UntypedColumn {
  relationId: Id;
  columnId: Id;
}

export const isUntyped = (dataType: string | undefined): boolean => dataType === undefined || dataType.trim() === '';

/** Every column without a data type in the given relations (all relations when `relationIds` is undefined). */
export function untypedColumns(model: RelationalModel, relationIds?: readonly Id[]): UntypedColumn[] {
  const out: UntypedColumn[] = [];
  for (const r of Object.values(model.relations)) {
    if (relationIds && !relationIds.includes(r.id)) continue;
    for (const c of r.columns) if (isUntyped(c.dataType)) out.push({ relationId: r.id, columnId: c.id });
  }
  return out;
}

/** ONE undoable commit giving `dataType` to every listed column; returns how many were changed (0 when the edit failed). */
export function applyBulkDataType(modelId: Id, columns: readonly UntypedColumn[], dataType: string, label: string): number {
  const ok = runEdit(label, (d: Project) => {
    for (const c of columns) ops.updateColumn(d, modelId, c.relationId, c.columnId, { dataType });
  });
  return ok ? columns.length : 0;
}

export function BulkDataType({ model, relationIds, testId = 'bulk-type' }: { model: RelationalModel; relationIds?: readonly Id[]; testId?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('VARCHAR(255)');
  const cols = untypedColumns(model, relationIds);
  if (cols.length === 0) return null;
  if (!open)
    return (
      <div className="pp-bulk" data-testid={testId}>
        <Button size="sm" icon="rename" onClick={() => setOpen(true)} data-testid={`${testId}-open`}>
          {t('properties.bulkType.open')}
        </Button>
      </div>
    );
  return (
    <div className="pp-bulk" data-testid={testId} role="group" aria-label={t('properties.bulkType.open')}>
      <Select label={t('properties.bulkType.type')} value={type} options={SQL_TYPES.map((v) => ({ value: v, label: v }))} onChange={setType} data-testid={`${testId}-select`} />
      <div className="pp-bulk-actions">
        <Button
          size="sm"
          variant="primary"
          data-testid={`${testId}-apply`}
          onClick={() => {
            const n = applyBulkDataType(model.id, cols, type, t('properties.bulkType.label'));
            if (n > 0) uiStore.getState().pushToast({ kind: 'success', message: tp('properties.bulkType.done', n, { type }) });
            setOpen(false);
          }}
        >
          {tp('properties.bulkType.apply', cols.length, { type })}
        </Button>
        <Button size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
