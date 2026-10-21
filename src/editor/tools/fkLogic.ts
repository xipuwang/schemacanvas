/**
 * Foreign-key tool, pure part: which target columns a drop means, and whether it may become a constraint at all.
 *
 * The tool never creates an invalid FK by default: the target columns must form a key of the referenced relation
 * (primary key, UNIQUE constraint or unique index) and have as many columns as the source selection. When that is not
 * the case the verdict carries a reason (explained to the user with the way to fix it) instead of "Create anyway".
 */
import { describeForeignKey, relationColumn } from '@/model/queries';
import { dataTypesCompatible } from '@/model/relationalFacts';
import type { ForeignKey, ForeignKeyColumnPair, Id, Relation, RelationalModel } from '@/model/types';

export interface KeyCandidate {
  kind: 'primary' | 'unique' | 'index';
  /** Constraint / index name when it has one. */
  name?: string;
  /** Columns in the KEY's own order. */
  columnIds: Id[];
}

/** Keys of `rel` that a foreign key may reference: PK first, then UNIQUE constraints, then plain unique indexes. */
export function candidateKeys(rel: Relation): KeyCandidate[] {
  const out: KeyCandidate[] = [];
  if (rel.primaryKey.length > 0) out.push({ kind: 'primary', columnIds: [...rel.primaryKey] });
  for (const u of rel.uniques) if (u.columnIds.length > 0) out.push({ kind: 'unique', ...(u.name ? { name: u.name } : {}), columnIds: [...u.columnIds] });
  for (const i of rel.indexes) if (i.unique && !i.where && i.columnIds.length > 0) out.push({ kind: 'index', ...(i.name ? { name: i.name } : {}), columnIds: [...i.columnIds] });
  return out;
}

export type FkReject =
  | { reason: 'no-sources' }
  | { reason: 'no-key'; relation: string }
  | { reason: 'not-key-cell'; relation: string; column: string }
  | { reason: 'length-mismatch'; relation: string; keyLength: number; selected: number }
  | { reason: 'self-column'; relation: string; column: string }
  | { reason: 'duplicate'; text: string };

export type FkTargetVerdict =
  | {
      ok: true;
      /** Keys of the target with exactly `sources.length` columns; `keyIndex` is the chosen one. */
      keys: KeyCandidate[];
      keyIndex: number;
      /** Target column per source column (same order as the sources): a permutation of the chosen key. */
      targetColumnIds: Id[];
    }
  | ({ ok: false } & FkReject);

const norm = (s: string): string => s.trim().toLowerCase();

/** Source columns sorted into the relation's own column order (deterministic whatever order the user picked). */
export function inTableOrder(rel: Relation, columnIds: readonly Id[]): Id[] {
  const rank = new Map(rel.columns.map((c, i) => [c.id, i]));
  return [...new Set(columnIds)].filter((id) => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!);
}

/**
 * Pair every source column with one key column. Name hints first (equal names, or one name ending with the other:
 * `DrugTradeName` -> `TradeName`), then the remaining columns in order. Always a permutation of `keyIds`.
 */
export function suggestMapping(source: Relation, sourceIds: readonly Id[], target: Relation, keyIds: readonly Id[]): Id[] {
  const nameOf = (rel: Relation, id: Id): string => norm(relationColumn(rel, id)?.name ?? '');
  const free = new Set(keyIds);
  const pick = new Map<Id, Id>();
  const tryMatch = (match: (s: string, k: string) => boolean): void => {
    for (const s of sourceIds) {
      if (pick.has(s)) continue;
      const k = keyIds.find((kid) => free.has(kid) && match(nameOf(source, s), nameOf(target, kid)));
      if (k) {
        pick.set(s, k);
        free.delete(k);
      }
    }
  };
  tryMatch((s, k) => s === k);
  tryMatch((s, k) => s.length > 2 && k.length > 2 && (s.endsWith(k) || k.endsWith(s)));
  const rest = keyIds.filter((k) => free.has(k));
  let i = 0;
  for (const s of sourceIds) if (!pick.has(s)) pick.set(s, rest[i++]!);
  return sourceIds.map((s) => pick.get(s)!);
}

const pairKey = (p: ForeignKeyColumnPair): string => `${p.sourceColumnId}>${p.targetColumnId}`;

/** `Patient.DoctorSSN → Doctor.SSN`, `Prescription.(A, B) → Drug.(C, D)` for a not-yet-created foreign key. */
export function describePairs(model: RelationalModel, sourceRelationId: Id, targetRelationId: Id, pairs: readonly ForeignKeyColumnPair[]): string {
  const fk: ForeignKey = { id: 'preview', sourceRelationId, targetRelationId, columns: pairs.map((p) => ({ sourceColumnId: p.sourceColumnId, targetColumnId: p.targetColumnId })) };
  return describeForeignKey(model, fk);
}

/** An existing FK with the same relations and the same set of pairs (order-insensitive), if any. */
export function findDuplicateFk(model: RelationalModel, sourceRelationId: Id, targetRelationId: Id, pairs: readonly ForeignKeyColumnPair[]): ForeignKey | undefined {
  const want = pairs.map(pairKey).sort().join('|');
  return Object.values(model.foreignKeys).find(
    (fk) => fk.sourceRelationId === sourceRelationId && fk.targetRelationId === targetRelationId && fk.columns.map(pairKey).sort().join('|') === want,
  );
}

/** Pairs in source order for a chosen mapping. */
export const pairsOf = (sourceIds: readonly Id[], targetIds: readonly Id[]): ForeignKeyColumnPair[] =>
  sourceIds.map((s, i) => ({ sourceColumnId: s, targetColumnId: targetIds[i]! }));

/**
 * Decide what dropping `sourceIds` (columns of `sourceRelationId`) on `targetRelationId` means. `dropColumnId` is the
 * target cell under the pointer, when there is one. Pure: never mutates, never throws.
 */
export function resolveFkTarget(model: RelationalModel, sourceRelationId: Id, sourceIds: readonly Id[], targetRelationId: Id, dropColumnId?: Id): FkTargetVerdict {
  const source = model.relations[sourceRelationId];
  const target = model.relations[targetRelationId];
  if (!source || !target || sourceIds.length === 0) return { ok: false, reason: 'no-sources' };
  const ordered = inTableOrder(source, sourceIds);
  const all = candidateKeys(target);
  if (all.length === 0) return { ok: false, reason: 'no-key', relation: target.name };

  let pool = all;
  if (dropColumnId !== undefined) {
    const containing = all.filter((k) => k.columnIds.includes(dropColumnId));
    if (containing.length === 0) {
      return { ok: false, reason: 'not-key-cell', relation: target.name, column: relationColumn(target, dropColumnId)?.name ?? '?' };
    }
    pool = containing;
  }
  const fitting = pool.filter((k) => k.columnIds.length === ordered.length);
  if (fitting.length === 0) {
    const k = pool[0]!;
    return { ok: false, reason: 'length-mismatch', relation: target.name, keyLength: k.columnIds.length, selected: ordered.length };
  }
  // keep every fitting key of the relation selectable in the popover, the one under the pointer / the PK first
  const others = all.filter((k) => k.columnIds.length === ordered.length && !fitting.includes(k));
  const keys = [...fitting, ...others];
  const chosen = keys[0]!;
  const targetColumnIds = suggestMapping(source, ordered, target, chosen.columnIds);
  const pairs = pairsOf(ordered, targetColumnIds);
  if (source.id === target.id) {
    const bad = pairs.find((p) => p.sourceColumnId === p.targetColumnId);
    if (bad) return { ok: false, reason: 'self-column', relation: source.name, column: relationColumn(source, bad.sourceColumnId)?.name ?? '?' };
  }
  const dup = findDuplicateFk(model, source.id, target.id, pairs);
  if (dup) return { ok: false, reason: 'duplicate', text: describeForeignKey(model, dup) };
  return { ok: true, keys, keyIndex: 0, targetColumnIds };
}

/** Re-map after the user picks `newTargetId` for source column `i`: the previous owner of it receives the freed column (a permutation). */
export function remapTarget(targetColumnIds: readonly Id[], i: number, newTargetId: Id): Id[] {
  const next = [...targetColumnIds];
  const j = next.indexOf(newTargetId);
  if (j === i) return next;
  if (j >= 0) next[j] = next[i]!;
  next[i] = newTargetId;
  return next;
}

/** Type mismatch note for a pair, or undefined when compatible / unknown. */
export function pairTypeNote(source: Relation, target: Relation, pair: ForeignKeyColumnPair): { source: string; target: string } | undefined {
  const s = relationColumn(source, pair.sourceColumnId)?.dataType;
  const t = relationColumn(target, pair.targetColumnId)?.dataType;
  return dataTypesCompatible(s, t) === 'mismatch' ? { source: s ?? '', target: t ?? '' } : undefined;
}

/**
 * Which cells of `target` are valid drop targets for a selection of `count` source columns: every cell of a key of that length.
 * Used for the highlight while dragging. Returns column ids.
 */
export function validTargetColumns(target: Relation, count: number): Id[] {
  const ids = new Set<Id>();
  for (const k of candidateKeys(target)) if (k.columnIds.length === count) for (const id of k.columnIds) ids.add(id);
  return [...ids];
}
