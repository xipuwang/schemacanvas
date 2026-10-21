/**
 * Attribute -> column rules shared by entities and relationships: composite flattening, derived omission /
 * materialisation, key handling, and the hand-off of multivalued attributes to `multivalued.ts`.
 */
import { attributesOf, leafAttributes, sqlNameKey } from '@/model/queries';
import type { ConversionRuleId } from '@/model/conversionRules';
import type { ErAttribute, Id, RelColumn, SemanticRef } from '@/model/types';
import { colRef, eRef, type Ctx, type RelState } from './context';
import { listColumns, pascal } from './names';
import { buildMultivalued } from './multivalued';

/** Where a multivalued attribute's own relation hangs off. */
export interface MvHost {
  st: RelState;
  /** Prefix of the multivalued relation's name (`Student` in `Student_Phones`). */
  label: string;
  /** Entity-ish name used by the FK column naming rule for the host's key columns. */
  keyName: string;
  /** Resolved lazily: the host key is final only after all translations ran. */
  keyIds: () => Id[];
}

/**
 * How `ErAttribute.key` is read (types.ts `ErKeyKind`): strong entity: `primary`; weak: `primary` and `partial`;
 * relationship relation: `primary` (discriminator); folded relationship (FK translation): ignored.
 */
export type KeyMode = 'strong' | 'weak' | 'relationship' | 'folded';

export interface Placement {
  ruleId: ConversionRuleId;
  /** Id used in column origin keys (entity or relationship id). */
  ownerKey: string;
  ownerName: string;
  st: RelState;
  keyMode: KeyMode;
  /** Every produced column nullable (merged non-key side, attributes of an optional relationship). */
  forceNullable?: boolean;
  host: MvHost;
}

export interface Placed {
  keyColumns: RelColumn[];
  otherColumns: RelColumn[];
  /** Top-level `primary` attributes that were ignored because the relationship was folded into an FK. */
  ignoredKeyAttributes: ErAttribute[];
}

interface Unit {
  leaf: ErAttribute;
  /** Ancestors from the top-level attribute down to the leaf's parent (empty for a top-level simple attribute). */
  chain: ErAttribute[];
  top: ErAttribute;
  materialized: boolean;
  isKey: boolean;
}

function subtree(c: Ctx, attr: ErAttribute, seen = new Set<Id>()): ErAttribute[] {
  if (seen.has(attr.id)) return [];
  seen.add(attr.id);
  return [attr, ...attributesOf(c.er, { kind: 'attribute', id: attr.id }).flatMap((ch) => subtree(c, ch, seen))];
}

function chainOf(c: Ctx, leaf: ErAttribute, top: ErAttribute): ErAttribute[] {
  const chain: ErAttribute[] = [];
  let cur = leaf;
  const seen = new Set<Id>();
  while (cur.id !== top.id && cur.owner.kind === 'attribute' && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = c.er.attributes[cur.owner.id];
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

/** Derived attribute that is not materialised: nothing is stored; every attribute of its subtree is traced as omitted. */
function omitDerived(c: Ctx, attr: ErAttribute): void {
  const from = (attr.derivedFrom ?? []).map((id) => c.er.attributes[id]?.name).filter((n): n is string => !!n);
  c.decide({
    ruleId: 'derived-omitted',
    tag: attr.id,
    title: `Derived attribute ${attr.name} is not stored`,
    explanation:
      `${attr.name} can be computed${from.length ? ` from ${from.join(', ')}` : ' from other data'}, so storing it would duplicate information ` +
      'and let it go out of date. Compute it in queries or a view instead; to store it anyway, add it to the "materialise derived attributes" option.',
    sources: [eRef.attribute(attr.id)],
    params: { kind: from.length ? 'derived-omitted' : 'derived-omitted.nosource', name: attr.name, from: from.join(', ') },
  });
  for (const a of subtree(c, attr)) c.trace(eRef.attribute(a.id), [], 'derived-omitted');
}

export function storeAttributes(c: Ctx, tops: ErAttribute[], p: Placement): Placed {
  const materialize = new Set(c.options.materializeDerived);
  const units: Unit[] = [];
  const ignoredKeyAttributes: ErAttribute[] = [];
  const composites: ErAttribute[] = [];

  const keyOf = (top: ErAttribute): boolean => {
    if (top.multivalued) return false;
    switch (p.keyMode) {
      case 'strong':
      case 'relationship':
        return top.key === 'primary';
      case 'weak':
        return top.key !== 'none';
      case 'folded':
        if (top.key === 'primary') ignoredKeyAttributes.push(top);
        return false;
    }
  };

  const queueMv = (attr: ErAttribute): void => {
    c.mvQueue.push(() => buildMultivalued(c, attr, p.host));
  };

  for (const top of tops) {
    if (top.derived && !materialize.has(top.id)) {
      omitDerived(c, top);
      continue;
    }
    if (top.multivalued) {
      queueMv(top);
      continue;
    }
    const isKey = keyOf(top);
    const leaves = attributesOf(c.er, { kind: 'attribute', id: top.id }).length === 0 ? [top] : leafAttributes(c.er, top, { stopAtMultivalued: true });
    for (const leaf of leaves) {
      const chain = chainOf(c, leaf, top);
      const derivedInChain = [...chain, leaf].filter((a) => a.derived);
      const materialized = derivedInChain.length > 0 && derivedInChain.some((a) => materialize.has(a.id));
      if (derivedInChain.length > 0 && !materialized) {
        omitDerived(c, derivedInChain[0]!);
        continue;
      }
      if (leaf.multivalued && leaf.id !== top.id) {
        queueMv(leaf);
        continue;
      }
      units.push({ leaf, chain, top, materialized, isKey });
    }
    if (attributesOf(c.er, { kind: 'attribute', id: top.id }).length > 0) composites.push(top);
  }

  // A leaf name shared by several units (or by an earlier column) is disambiguated by its parent's name.
  const counts = new Map<string, number>();
  for (const u of units) counts.set(sqlNameKey(u.leaf.name), (counts.get(sqlNameKey(u.leaf.name)) ?? 0) + 1);

  const ordered = [...units.filter((u) => u.isKey), ...units.filter((u) => !u.isKey)];
  const placed: Placed = { keyColumns: [], otherColumns: [], ignoredKeyAttributes };
  for (const u of ordered) {
    const parent = u.chain[u.chain.length - 1];
    const duplicate = (counts.get(sqlNameKey(u.leaf.name)) ?? 0) > 1;
    const name = duplicate && parent ? pascal(parent.name) + pascal(u.leaf.name) : u.leaf.name;
    const nullable = !u.isKey && (p.forceNullable === true || [...u.chain, u.leaf].some((a) => a.optional === true));
    const ruleId: ConversionRuleId = u.materialized ? 'derived-materialized' : u.chain.length > 0 ? 'composite-flatten' : p.ruleId;
    const col = c.addColumn(p.st, {
      key: `column:${p.ownerKey}:${u.leaf.id}`,
      name,
      alts: [pascal(p.ownerName) + pascal(u.leaf.name)],
      ruleId,
      sources: [eRef.attribute(u.leaf.id)],
      ...(c.options.carryDataTypes && u.leaf.dataType ? { dataType: u.leaf.dataType } : {}),
      nullable: p.forceNullable === true && u.isKey ? true : nullable,
      ...(u.leaf.description ? { description: u.leaf.description } : {}),
      ...(u.chain.length > 0 ? { note: `Flattened from composite attribute ${u.chain.map((a) => a.name).join('.')}` } : {}),
    });
    if (duplicate && parent && name !== u.leaf.name) {
      c.decide({
        ruleId: 'composite-flatten',
        tag: `collision:${u.leaf.id}`,
        title: `Sub-attribute ${u.leaf.name} prefixed with ${parent.name}`,
        explanation: `Several attributes of ${p.ownerName} flatten to a column called "${u.leaf.name}"; the one under ${parent.name} became "${col.name}" so every column name stays unique.`,
        sources: [eRef.attribute(u.leaf.id)],
        targets: [colRef(p.st, col)],
        params: { kind: 'composite-flatten.collision', leaf: u.leaf.name, parent: parent.name, owner: p.ownerName, column: col.name },
      });
    }
    const target: SemanticRef = colRef(p.st, col);
    c.trace(eRef.attribute(u.leaf.id), [target], ruleId);
    for (const a of u.chain) c.trace(eRef.attribute(a.id), [target], 'composite-flatten');
    // A materialised derived attribute that sits inside a composite also counts for the composite's trace above.
    if (u.materialized) {
      c.decide({
        ruleId: 'derived-materialized',
        tag: u.leaf.id,
        title: `Derived attribute ${u.leaf.name} is stored`,
        explanation: `${u.leaf.name} is derived, but it was explicitly chosen for storage and became the ordinary column ${p.st.relation.name}.${col.name}. The database will not keep it in sync with the attributes it is computed from.`,
        sources: [eRef.attribute(u.leaf.id)],
        targets: [target],
        params: { name: u.leaf.name, relation: p.st.relation.name, column: col.name },
      });
    }
    (u.isKey ? placed.keyColumns : placed.otherColumns).push(col);
  }
  for (const top of composites) explainFlatten(c, top, p);
  return placed;
}

function explainFlatten(c: Ctx, top: ErAttribute, p: Placement): void {
  const cols = p.st.relation.columns.filter((col) => col.origin?.sources.some((s) => s.kind === 'attribute' && subtreeIds(c, top).has(s.id)));
  if (cols.length === 0) return;
  c.decide({
    ruleId: 'composite-flatten',
    tag: top.id,
    title: `Composite attribute ${top.name} is flattened`,
    explanation: `${top.name} has sub-attributes, which become separate atomic columns of ${p.st.relation.name}: ${listColumns(cols.map((x) => x.name))}. The composite itself is not a column.`,
    sources: [eRef.attribute(top.id)],
    targets: cols.map((col) => colRef(p.st, col)),
    params: { name: top.name, relation: p.st.relation.name, columns: listColumns(cols.map((x) => x.name)) },
  });
}

function subtreeIds(c: Ctx, attr: ErAttribute): Set<Id> {
  return new Set(subtree(c, attr).map((a) => a.id));
}
