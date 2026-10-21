/** Selected table (relation): name, columns, keys, foreign keys, uniques, indexes, checks. */
import * as ops from '@/model/ops';
import type { Relation, RelationalModel } from '@/model/types';
import { useT } from '@/i18n';
import { BulkDataType } from './BulkDataType';
import { ColumnList } from './ColumnForms';
import { CheckSection, IndexSection, PrimaryKeySection, UniqueSection } from './ConstraintForms';
import { ForeignKeySection, IncomingFkSection } from './FkForms';
import { TableHeader } from './Header';
import { issuesOf, runEdit, useIssueMap } from './edit';
import { CommitInput, CommitTextarea, IssueBadges, Section } from './parts';

export function RelationPanel({ model, relation }: { model: RelationalModel; relation: Relation }) {
  const t = useT();
  const issueMap = useIssueMap();
  const patch = (label: string, p: Parameters<typeof ops.updateRelation>[3]): boolean => runEdit(label, (d) => ops.updateRelation(d, model.id, relation.id, p));
  return (
    <>
      <TableHeader model={model} relation={relation} kind={t('properties.kind.table')} />
      <IssueBadges issues={issuesOf(issueMap, { kind: 'relation', id: relation.id })} />
      <Section title={t('properties.section.general')}>
        <CommitInput label={t('properties.name')} required value={relation.name} onCommit={(name) => patch(t('properties.rename'), { name })} />
        <CommitInput label={t('properties.table.schema')} mono value={relation.schemaName ?? ''} placeholder={t('properties.table.schemaPlaceholder')} onCommit={(v) => patch(t('properties.table.setSchema'), { schemaName: v === '' ? undefined : v })} />
        <CommitTextarea label={t('properties.description')} value={relation.description ?? ''} onCommit={(v) => patch(t('properties.describe'), { description: v.trim() === '' ? undefined : v })} />
      </Section>
      <ColumnList model={model} relation={relation} />
      <BulkDataType model={model} relationIds={[relation.id]} />
      <PrimaryKeySection model={model} relation={relation} />
      <ForeignKeySection model={model} relation={relation} />
      <IncomingFkSection model={model} relation={relation} />
      <UniqueSection model={model} relation={relation} />
      <IndexSection model={model} relation={relation} />
      <CheckSection model={model} relation={relation} />
    </>
  );
}
