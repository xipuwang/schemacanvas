/** Selection-aware properties panel: reads the store selection and shows the matching form. Every edit is an op in one commit. */
import { useEffect, type ReactNode } from 'react';
import { useEditorStore } from '@/store';
import { useT } from '@/i18n';
import { Note, EditError, SqlTypeList } from './parts';
import { DiagramPanel } from './DiagramForm';
import { AttributePanel, EntityPanel, ParticipantPanel, RelationshipPanel } from './ErPanels';
import { clearEditError, useActive } from './edit';
import { EdgeRouteSection, FkPanel } from './EdgePanels';
import { ColumnPanel } from './ColumnForms';
import { RelationPanel } from './RelationPanel';
import { MultiPanel, NodeStyleSection } from './StyleForms';
import './properties.css';

function Body(): ReactNode {
  const t = useT();
  const { diagram, model } = useActive();
  const selection = useEditorStore((s) => s.selection);
  if (!diagram || !model) return <Note>{t('properties.noDiagram')}</Note>;
  const ids = selection.ids.filter((id) => diagram.nodes[id] || diagram.edges[id]);
  if (ids.length === 0) return <DiagramPanel />;
  if (ids.length > 1) return <MultiPanel diagram={diagram} selectedIds={ids} />;
  const id = ids[0]!;
  const missing = <Note tone="warning">{t('properties.missing')}</Note>;

  const node = diagram.nodes[id];
  if (node) {
    const ref = node.ref;
    const style = <NodeStyleSection diagram={diagram} nodeIds={[id]} />;
    if (model.kind === 'er') {
      if (ref.kind === 'entity') {
        const entity = model.entities[ref.id];
        return entity ? (
          <>
            <EntityPanel model={model} entity={entity} />
            {style}
          </>
        ) : (
          missing
        );
      }
      if (ref.kind === 'attribute') {
        const attr = model.attributes[ref.id];
        return attr ? (
          <>
            <AttributePanel model={model} attr={attr} />
            {style}
          </>
        ) : (
          missing
        );
      }
      if (ref.kind === 'relationship') {
        const rel = model.relationships[ref.id];
        return rel ? (
          <>
            <RelationshipPanel model={model} rel={rel} />
            {style}
          </>
        ) : (
          missing
        );
      }
    } else if (ref.kind === 'relation') {
      const relation = model.relations[ref.id];
      if (!relation) return missing;
      const sub = selection.sub;
      const column = sub?.kind === 'column' && sub.relationId === relation.id ? relation.columns.find((c) => c.id === sub.id) : undefined;
      if (column) {
        return (
          <>
            <ColumnPanel model={model} relation={relation} column={column} nodeId={id} />
            {style}
          </>
        );
      }
      return (
        <>
          <RelationPanel model={model} relation={relation} />
          {style}
        </>
      );
    }
    return missing;
  }

  const edge = diagram.edges[id]!;
  if (edge.ref.kind === 'foreignKey' && model.kind === 'relational') return <FkPanel model={model} diagram={diagram} edge={edge} foreignKeyId={edge.ref.foreignKeyId} />;
  if (model.kind === 'er') {
    if (edge.ref.kind === 'participant') {
      const rel = model.relationships[edge.ref.relationshipId];
      const p = rel?.participants.find((x) => x.id === (edge.ref as { participantId: string }).participantId);
      return rel && p ? (
        <>
          <ParticipantPanel model={model} rel={rel} p={p} />
          <EdgeRouteSection diagram={diagram} edge={edge} />
        </>
      ) : (
        missing
      );
    }
    if (edge.ref.kind === 'attribute') {
      const attr = model.attributes[edge.ref.attributeId];
      return attr ? (
        <>
          <AttributePanel model={model} attr={attr} />
          <EdgeRouteSection diagram={diagram} edge={edge} />
        </>
      ) : (
        missing
      );
    }
  }
  return missing;
}

export function PropertiesPanel() {
  const selection = useEditorStore((s) => s.selection);
  const key = `${selection.ids.join(',')}|${selection.sub ? `${selection.sub.kind}:${selection.sub.id}` : ''}`;
  // an old refusal message must not follow the user to another element
  useEffect(() => clearEditError, []);
  useEffect(() => {
    clearEditError();
  }, [key]);
  return (
    <div className="pp" data-testid="properties-panel">
      <SqlTypeList />
      <EditError />
      <div key={key} className="pp-body">
        <Body />
      </div>
    </div>
  );
}
