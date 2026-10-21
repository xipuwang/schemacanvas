/**
 * Multivalued attribute -> its own relation: the owner's key columns as ONE composite FK plus the attribute's
 * (flattened) columns; PK = owner key + every attribute column (a value can occur once per owner).
 */
import { leafAttributes } from '@/model/queries';
import type { ErAttribute, Id, RelColumn } from '@/model/types';
import { colRef, eRef, fkRef, relRef, type Ctx } from './context';
import type { MvHost } from './attributes';
import { listColumns, pascal } from './names';

export function buildMultivalued(c: Ctx, attr: ErAttribute, host: MvHost): void {
  const materialize = new Set(c.options.materializeDerived);
  // Flatten fully: derived leaves are dropped unless materialised.
  const leaves = leafAttributes(c.er, attr).filter((l) => {
    if (!l.derived || materialize.has(l.id)) return true;
    c.decide({
      ruleId: 'derived-omitted',
      tag: l.id,
      title: `Derived attribute ${l.name} is not stored`,
      explanation: `${l.name} is derived (computed from other data), so it is not stored in the relation of multivalued attribute ${attr.name}.`,
      sources: [eRef.attribute(l.id)],
      params: { kind: 'derived-omitted.multivalued', name: l.name, attribute: attr.name },
    });
    c.trace(eRef.attribute(l.id), [], 'derived-omitted');
    return false;
  });

  const key = `multivalued-relation:${attr.id}`;
  const st = c.newRelation(`${host.label}_${attr.name}`, { ruleId: 'multivalued-relation', sources: [eRef.attribute(attr.id)], key });
  const hostKeys = c.keyColsOf(host.st, host.keyIds());

  let fkCols: RelColumn[] = [];
  const targets = [relRef(st)];
  if (hostKeys.length > 0) {
    fkCols = hostKeys.map((k) => {
      const name = k.propagated ? k.name : pascal(host.keyName) + pascal(k.attrName);
      return c.addColumn(st, {
        key: `fk:mv:${attr.id}:${k.originKey}`,
        name,
        alts: [`${name}_${pascal(host.keyName)}`],
        ruleId: 'multivalued-relation',
        sources: [eRef.attribute(attr.id)],
        ...(c.options.carryDataTypes && k.dataType ? { dataType: k.dataType } : {}),
        nullable: false,
        isFk: true,
      });
    });
    const fk = c.addForeignKey({
      key: `fk:mv:${attr.id}`,
      source: st,
      target: host.st,
      pairs: fkCols.map((col, i) => ({ sourceColumnId: col.id, targetColumnId: hostKeys[i]!.id })),
      ruleId: 'multivalued-relation',
      sources: [eRef.attribute(attr.id)],
    });
    targets.push(fkRef(fk));
  }

  const chainOf = (leaf: ErAttribute): ErAttribute[] => {
    const chain: ErAttribute[] = [];
    for (let cur = leaf; cur.id !== attr.id && cur.owner.kind === 'attribute'; ) {
      const parent = c.er.attributes[cur.owner.id];
      if (!parent) break;
      chain.unshift(parent);
      cur = parent;
    }
    return chain;
  };
  // An optional leaf cannot be part of a primary key (key columns are NOT NULL). It stays nullable and out of the key
  // when at least one required leaf can carry the key; with no required leaf all columns must key the relation.
  const isOptional = (leaf: ErAttribute): boolean => [...chainOf(leaf), leaf].some((a) => a.optional === true);
  const requiredExist = leaves.some((l) => !isOptional(l));
  const inKey = (leaf: ErAttribute): boolean => !requiredExist || !isOptional(leaf);
  const optionalOut = leaves.filter((l) => !inKey(l));
  const optionalForcedIn = !requiredExist ? leaves.filter(isOptional) : [];

  const valueCols: RelColumn[] = [];
  const keyValueCols: RelColumn[] = [];
  for (const leaf of leaves) {
    const chain = chainOf(leaf);
    const parentName = chain[chain.length - 1]?.name;
    const col = c.addColumn(st, {
      key: `column:mv:${attr.id}:${leaf.id}`,
      name: leaf.name,
      alts: parentName ? [pascal(parentName) + pascal(leaf.name)] : [],
      ruleId: chain.length > 0 ? 'composite-flatten' : 'multivalued-relation',
      sources: [eRef.attribute(leaf.id)],
      ...(c.options.carryDataTypes && leaf.dataType ? { dataType: leaf.dataType } : {}),
      nullable: !inKey(leaf),
      ...(leaf.description ? { description: leaf.description } : {}),
    });
    valueCols.push(col);
    if (inKey(leaf)) keyValueCols.push(col);
    targets.push(colRef(st, col));
    c.trace(eRef.attribute(leaf.id), [colRef(st, col)], chain.length > 0 ? 'composite-flatten' : 'multivalued-relation');
    for (const a of chain) c.trace(eRef.attribute(a.id), [colRef(st, col)], 'composite-flatten');
  }
  const pk: Id[] = [...fkCols.map((x) => x.id), ...keyValueCols.map((x) => x.id)];
  c.setPrimaryKey(st, pk);
  c.trace(eRef.attribute(attr.id), targets, 'multivalued-relation');

  const names = [...fkCols, ...keyValueCols].map((x) => x.name);
  const optionalNote =
    optionalOut.length > 0
      ? ` The optional sub-attribute${optionalOut.length === 1 ? '' : 's'} ${listColumns(optionalOut.map((l) => l.name))} stay${optionalOut.length === 1 ? 's' : ''} nullable and outside the key (a key column cannot be NULL), so two values that differ only there are not both allowed.`
      : optionalForcedIn.length > 0
        ? ` ${listColumns(optionalForcedIn.map((l) => l.name))} ${optionalForcedIn.length === 1 ? 'is' : 'are'} optional but, as no required sub-attribute exists, had to become part of the key and therefore NOT NULL.`
        : '';
  if (optionalOut.length > 0 || optionalForcedIn.length > 0) {
    c.warn({
      code: 'conv.multivalued-optional-leaf',
      severity: 'info',
      title: `Optional part of multivalued ${attr.name} and the key of ${st.relation.name}`,
      explanation: optionalNote.trim(),
      suggestion: 'Make the sub-attribute required, or accept the stated key.',
      affected: [eRef.attribute(attr.id), relRef(st)],
      params: {
        attribute: attr.name,
        relation: st.relation.name,
        variant: `${optionalOut.length > 0 ? 'out' : 'forced'}.${(optionalOut.length > 0 ? optionalOut : optionalForcedIn).length === 1 ? 'one' : 'other'}`,
        columns: listColumns((optionalOut.length > 0 ? optionalOut : optionalForcedIn).map((l) => l.name)),
      },
    });
  }
  c.decide({
    ruleId: 'multivalued-relation',
    tag: attr.id,
    title: `Multivalued attribute ${attr.name} becomes relation ${st.relation.name}`,
    explanation:
      hostKeys.length > 0
        ? `A column cannot hold a set of values, so ${attr.name} gets its own relation ${st.relation.name}. It holds ${host.label}'s key as one foreign key ` +
          `(${listColumns(fkCols.map((x) => x.name))}) and the value column(s) ${listColumns(valueCols.map((x) => x.name))}; ` +
          `the primary key is ${listColumns(names)}, so each value appears at most once per ${host.label}.${optionalNote}`
        : `${attr.name} is multivalued and gets its own relation ${st.relation.name}, but ${host.label} has no key to reference, so no foreign key could be created.`,
    sources: [eRef.attribute(attr.id)],
    targets,
    level: hostKeys.length > 0 ? 'info' : 'warning',
    params: {
      kind: hostKeys.length > 0 ? 'multivalued-relation' : 'multivalued-relation.nokey',
      name: attr.name,
      relation: st.relation.name,
      host: host.label,
      fkColumns: listColumns(fkCols.map((x) => x.name)),
      valueColumns: listColumns(valueCols.map((x) => x.name)),
      pk: listColumns(names),
      noteMode: optionalOut.length > 0 ? `out.${optionalOut.length === 1 ? 'one' : 'many'}` : optionalForcedIn.length > 0 ? `forced.${optionalForcedIn.length === 1 ? 'one' : 'many'}` : 'none',
      noteColumns: listColumns((optionalOut.length > 0 ? optionalOut : optionalForcedIn).map((l) => l.name)),
    },
  });
}
