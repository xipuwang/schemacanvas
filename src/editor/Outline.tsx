/**
 * The diagram's text alternative: a nested-list outline of everything the canvas draws (entities with their attributes,
 * relationships with their participants, tables with their columns and foreign keys). It is visually hidden until it
 * receives focus (skip link / `view.outline`), then shows as a small panel. Every item announces itself and, when
 * activated, selects and focuses its shape on the canvas. It is rendered OUTSIDE the canvas' `role="application"` so
 * screen readers keep their list / heading navigation here.
 */
import { useMemo, type KeyboardEvent as ReactKeyEvent, type ReactNode } from 'react';
import { displayDiagramName, t, tp } from '@/i18n';
import { cardinalityText } from '@/model/erSemantics';
import { attributesOf, columnRole, describeForeignKey, foreignKeysOf, ownGet } from '@/model/queries';
import type { Diagram, ErAttribute, ErModel, Id, Project, RelationalModel, SemanticRef } from '@/model/types';

export interface OutlineProps {
  project: Project;
  diagramId: Id;
  onActivate(id: Id, sub?: SemanticRef): void;
  onClose(): void;
}

const nodeIdOf = (d: Diagram, kind: string, id: Id): Id | undefined => Object.entries(d.nodes).find(([, n]) => n.ref.kind === kind && n.ref.id === id)?.[0];
const sortedNodes = (d: Diagram, ids: Array<{ id: Id; node: Id }>): Array<{ id: Id; node: Id }> =>
  [...ids].sort((a, b) => d.nodes[a.node]!.y - d.nodes[b.node]!.y || d.nodes[a.node]!.x - d.nodes[b.node]!.x);

/** Item = a button when the shape exists in this diagram, plain text otherwise. */
function Item({ label, target, sub, onActivate, children }: { label: string; target?: Id; sub?: SemanticRef; onActivate: OutlineProps['onActivate']; children?: ReactNode }) {
  return (
    <li>
      {target ? (
        // a link, not a button: "go to this shape". (Also keeps the outline out of `button` queries for the real controls.)
        <a
          href="#"
          className="sc-outline__item"
          data-outline-id={target}
          onClick={(e) => {
            e.preventDefault();
            onActivate(target, sub);
          }}
        >
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      {children}
    </li>
  );
}

const attrLabel = (a: ErAttribute, composite: boolean): string =>
  t(a.key === 'primary' ? 'editor.outline.attr.key' : a.key === 'partial' ? 'editor.outline.attr.partial' : a.multivalued ? 'editor.outline.attr.multivalued' : a.derived ? 'editor.outline.attr.derived' : composite ? 'editor.outline.attr.composite' : 'editor.outline.attr.simple', { name: a.name });

function Attributes({ model, diagram, owner, onActivate }: { model: ErModel; diagram: Diagram; owner: { kind: 'entity' | 'relationship' | 'attribute'; id: Id }; onActivate: OutlineProps['onActivate'] }) {
  const attrs = attributesOf(model, owner);
  if (attrs.length === 0) return null;
  return (
    <ul>
      {attrs.map((a) => {
        const kids = attributesOf(model, { kind: 'attribute', id: a.id });
        return (
          <Item key={a.id} label={attrLabel(a, kids.length > 0)} target={nodeIdOf(diagram, 'attribute', a.id)} onActivate={onActivate}>
            {kids.length > 0 && <Attributes model={model} diagram={diagram} owner={{ kind: 'attribute', id: a.id }} onActivate={onActivate} />}
          </Item>
        );
      })}
    </ul>
  );
}

function ErOutline({ model, diagram, onActivate }: { model: ErModel; diagram: Diagram; onActivate: OutlineProps['onActivate'] }) {
  const entities = sortedNodes(diagram, Object.values(model.entities).flatMap((e) => { const node = nodeIdOf(diagram, 'entity', e.id); return node ? [{ id: e.id, node }] : []; }));
  const rels = sortedNodes(diagram, Object.values(model.relationships).flatMap((r) => { const node = nodeIdOf(diagram, 'relationship', r.id); return node ? [{ id: r.id, node }] : []; }));
  return (
    <>
      {entities.length > 0 && (
        <section>
          <h3>{t('editor.outline.entities')}</h3>
          <ul>
            {entities.map(({ id, node }) => {
              const e = model.entities[id]!;
              return (
                <Item key={id} label={t(e.weak ? 'editor.outline.weakEntity' : 'editor.outline.entity', { name: e.name })} target={node} onActivate={onActivate}>
                  <Attributes model={model} diagram={diagram} owner={{ kind: 'entity', id }} onActivate={onActivate} />
                </Item>
              );
            })}
          </ul>
        </section>
      )}
      {rels.length > 0 && (
        <section>
          <h3>{t('editor.outline.relationships')}</h3>
          <ul>
            {rels.map(({ id, node }) => {
              const r = model.relationships[id]!;
              return (
                <Item key={id} label={t(r.identifying ? 'editor.outline.identifyingRelationship' : 'editor.outline.relationship', { name: r.name })} target={node} onActivate={onActivate}>
                  <ul>
                    {r.participants.map((p) => {
                      const edgeId = Object.entries(diagram.edges).find(([, e]) => e.ref.kind === 'participant' && e.ref.participantId === p.id)?.[0];
                      const role = p.role?.trim();
                      const label = t('editor.outline.participant', {
                        entity: model.entities[p.entityId]?.name ?? '?',
                        card: cardinalityText(r, p.id),
                        participation: t(p.participation === 'total' ? 'editor.outline.total' : 'editor.outline.partial'),
                        role: role ? t('editor.outline.participant.role', { role }) : '',
                      });
                      return <Item key={p.id} label={label} target={edgeId} onActivate={onActivate} />;
                    })}
                  </ul>
                  <Attributes model={model} diagram={diagram} owner={{ kind: 'relationship', id }} onActivate={onActivate} />
                </Item>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function RelationalOutline({ model, diagram, onActivate }: { model: RelationalModel; diagram: Diagram; onActivate: OutlineProps['onActivate'] }) {
  const tables = sortedNodes(diagram, Object.values(model.relations).flatMap((r) => { const node = nodeIdOf(diagram, 'relation', r.id); return node ? [{ id: r.id, node }] : []; }));
  const fks = Object.entries(diagram.edges).flatMap(([edgeId, e]) => (e.ref.kind === 'foreignKey' && model.foreignKeys[e.ref.foreignKeyId] ? [{ edgeId, fk: model.foreignKeys[e.ref.foreignKeyId]! }] : []));
  return (
    <>
      {tables.length > 0 && (
        <section>
          <h3>{t('editor.outline.tables')}</h3>
          <ul>
            {tables.map(({ id, node }) => {
              const rel = model.relations[id]!;
              return (
                <Item key={id} label={t('editor.outline.table', { name: rel.name })} target={node} onActivate={onActivate}>
                  <ul>
                    {rel.columns.map((c) => {
                      const role = columnRole(model, id, c.id);
                      const fk = foreignKeysOf(model, id).find((f) => f.columns.some((x) => x.sourceColumnId === c.id));
                      const target = fk ? (describeForeignKey(model, fk).split(' → ')[1] ?? '?') : '';
                      const key = role === 'pk' ? 'pk' : role === 'fk' ? 'fk' : role === 'pk+fk' ? 'pkfk' : 'plain';
                      const label = t(`editor.outline.column.${key}`, { name: c.name, target }) + (c.dataType ? t('editor.outline.column.type', { type: c.dataType }) : '') + (c.nullable ? '' : t('editor.outline.column.notNull'));
                      return <Item key={c.id} label={label} target={node} sub={{ kind: 'column', relationId: id, id: c.id }} onActivate={onActivate} />;
                    })}
                  </ul>
                </Item>
              );
            })}
          </ul>
        </section>
      )}
      {fks.length > 0 && (
        <section>
          <h3>{t('editor.outline.foreignKeys')}</h3>
          <ul>
            {fks.map(({ edgeId, fk }) => (
              <Item key={edgeId} label={describeForeignKey(model, fk)} target={edgeId} sub={{ kind: 'foreignKey', id: fk.id }} onActivate={onActivate} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export const OUTLINE_ID_ATTR = 'data-diagram-outline';

export function Outline({ project, diagramId, onActivate, onClose }: OutlineProps) {
  const diagram = Object.hasOwn(project.diagrams, diagramId) ? project.diagrams[diagramId] : undefined;
  const model = diagram ? ownGet(project.models, diagram.modelId) : undefined;
  const body = useMemo(() => {
    if (!diagram || !model) return null;
    return model.kind === 'er' ? <ErOutline model={model} diagram={diagram} onActivate={onActivate} /> : <RelationalOutline model={model} diagram={diagram} onActivate={onActivate} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, model]);
  const onKeyDown = (e: ReactKeyEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  const empty = !diagram || Object.keys(diagram.nodes).length === 0;
  return (
    <nav className="sc-outline" {...{ [OUTLINE_ID_ATTR]: '' }} aria-label={t('editor.outline.title')} data-testid="diagram-outline" onKeyDown={onKeyDown}>
      <h2>{t('editor.outline.title')}</h2>
      <p>{t('editor.outline.hint')}</p>
      {empty ? <p>{t('editor.outline.none')}</p> : body}
    </nav>
  );
}

/** `{count} entities, {count} attributes ...` for the canvas' text alternative. */
export function summarizeDiagram(project: Project, diagramId: Id): { kind: 'chen' | 'relational' | 'crowsfoot' | 'generic'; summary: string; empty: boolean; name: string } {
  const diagram = Object.hasOwn(project.diagrams, diagramId) ? project.diagrams[diagramId] : undefined;
  const model = diagram ? ownGet(project.models, diagram.modelId) : undefined;
  if (!diagram || !model) return { kind: 'generic', summary: '', empty: true, name: '' };
  const count = (kind: string): number => Object.values(diagram.nodes).filter((n) => n.ref.kind === kind).length;
  const parts: string[] = [];
  let kind: 'chen' | 'relational' | 'crowsfoot' | 'generic' = 'generic';
  if (model.kind === 'er') {
    kind = 'chen';
    parts.push(tp('editor.canvas.count.entities', count('entity')), tp('editor.canvas.count.relationships', count('relationship')), tp('editor.canvas.count.attributes', count('attribute')));
  } else {
    kind = diagram.type === 'relational-schema' ? 'relational' : /crow/i.test(diagram.type) ? 'crowsfoot' : 'generic';
    const fks = Object.values(diagram.edges).filter((e) => e.ref.kind === 'foreignKey').length;
    parts.push(tp('editor.canvas.count.tables', count('relation')), tp('editor.canvas.count.foreignKeys', fks));
  }
  return { kind, summary: parts.join(', '), empty: Object.keys(diagram.nodes).length === 0, name: displayDiagramName(diagram) };
}
