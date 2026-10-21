/**
 * Pure form logic of the properties panel: given the current semantic state and the user's intent, compute the argument
 * of the op to call. Kept free of React so every rule is unit-tested; the components only wire events to these functions.
 */
import { currentLocale, formatList } from '@/i18n';
import { identifiedParticipants, analyzeRelationship } from '@/model/erSemantics';
import { ownGet } from '@/model/queries';
import type { ErModel, ErParticipant, ErRelationship, ForeignKeyColumnPair, Id, Relation } from '@/model/types';

/** Move `id` by `delta` positions inside `list` (clamped); returns the same array when nothing changes. */
export function moveInList<T>(list: readonly T[], from: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (from < 0 || from >= list.length || to === from) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** New primary-key list when the PK toggle of `columnId` is switched. Adding appends (PK order is meaningful). */
export function togglePrimaryKey(primaryKey: readonly Id[], columnId: Id, on: boolean): Id[] {
  const without = primaryKey.filter((x) => x !== columnId);
  return on ? [...without, columnId] : without;
}

/** Add/remove one column from an ordered column set (unique constraints, indexes). */
export function toggleInSet(columnIds: readonly Id[], columnId: Id, on: boolean): Id[] {
  return on ? (columnIds.includes(columnId) ? [...columnIds] : [...columnIds, columnId]) : columnIds.filter((x) => x !== columnId);
}

// ----- foreign key pairs -----------------------------------------------------------------------------------------------

export type PairSide = 'source' | 'target';
const keyOf = (side: PairSide): 'sourceColumnId' | 'targetColumnId' => (side === 'source' ? 'sourceColumnId' : 'targetColumnId');

/**
 * Assign `columnId` to one side of pair `index`. A column may appear only once per side, so picking one that another pair
 * already uses SWAPS the two (reordering the mapping never needs a forbidden intermediate state).
 */
export function setPairColumn(pairs: readonly ForeignKeyColumnPair[], index: number, side: PairSide, columnId: Id): ForeignKeyColumnPair[] {
  const k = keyOf(side);
  const next = pairs.map((p) => ({ ...p }));
  const cur = next[index];
  if (!cur || cur[k] === columnId) return next;
  const other = next.findIndex((p, i) => i !== index && p[k] === columnId);
  if (other >= 0) next[other]![k] = cur[k];
  cur[k] = columnId;
  return next;
}

/** A new pair using the first column of each side that no pair uses yet; undefined when a side has none left. */
export function nextFreePair(pairs: readonly ForeignKeyColumnPair[], source: Relation, target: Relation): ForeignKeyColumnPair | undefined {
  const s = source.columns.find((c) => !pairs.some((p) => p.sourceColumnId === c.id));
  const t = target.columns.find((c) => !pairs.some((p) => p.targetColumnId === c.id));
  return s && t ? { sourceColumnId: s.id, targetColumnId: t.id } : undefined;
}

/**
 * Pairs for the target's key (primary key by default): each target key column is matched with the source column of the
 * same name when it exists and is free, otherwise with the first free source column. Source columns may run out (then the
 * list is shorter than the key; the caller reports it).
 */
export function pairsForTargetKey(source: Relation, target: Relation, targetColumnIds: readonly Id[] = target.primaryKey): ForeignKeyColumnPair[] {
  const used = new Set<Id>();
  const out: ForeignKeyColumnPair[] = [];
  const lower = (s: string): string => s.trim().toLowerCase();
  for (const tid of targetColumnIds) {
    const tcol = target.columns.find((c) => c.id === tid);
    if (!tcol) continue;
    const free = source.columns.filter((c) => !used.has(c.id));
    const tn = lower(tcol.name);
    // same name, then a name that contains the other (`DrugTradeName` for `TradeName`), then a non-key column, then any free column
    const related = (c: { name: string }): boolean => {
      const sn = lower(c.name);
      return sn.length >= 3 && tn.length >= 3 && (sn.endsWith(tn) || tn.endsWith(sn));
    };
    const match = free.find((c) => lower(c.name) === tn) ?? free.find(related) ?? free.find((c) => !source.primaryKey.includes(c.id)) ?? free[0];
    if (!match) break;
    used.add(match.id);
    out.push({ sourceColumnId: match.id, targetColumnId: tid });
  }
  return out;
}

// ----- relationship (ER) ------------------------------------------------------------------------------------------------

export function participantLabel(model: ErModel, p: ErParticipant): string {
  const name = ownGet(model.entities, p.entityId)?.name ?? '?';
  return p.role ? `${name} (${p.role})` : name;
}

/**
 * Turning a relationship identifying needs an explicit identified participant unless exactly one participant's entity is
 * weak (the rule `identifiedParticipants` applies). Returns the participants the user can choose from, or [] when no choice
 * is needed.
 */
export function identifiedChoices(model: ErModel, rel: ErRelationship): ErParticipant[] {
  const weak = rel.participants.filter((p) => ownGet(model.entities, p.entityId)?.weak);
  if (weak.length === 1) return [];
  return rel.participants;
}

/** The identified participant of an identifying relationship, or undefined when unresolved/ambiguous. */
export function currentIdentified(model: ErModel, rel: ErRelationship): ErParticipant | undefined {
  const list = identifiedParticipants(model, rel);
  return list.length === 1 ? list[0] : undefined;
}

/**
 * English plural of a participant label ("Company" -> "Companies"). Only the name before an optional " (role)" changes.
 * Deliberately conservative: a name that already ends in a single "s" or in a non-letter is kept as typed, so it is never mangled.
 */
export function pluralizeLabel(label: string): string {
  const m = /^(.*?)(\s+\([^)]*\))?$/.exec(label);
  const name = m?.[1] ?? label;
  const role = m?.[2] ?? '';
  let out = name;
  if (/[^aeiou]y$/i.test(name)) out = `${name.slice(0, -1)}ies`;
  else if (/(ss|x|z|ch|sh)$/i.test(name)) out = `${name}es`;
  else if (/[a-z]$/i.test(name) && !/[^s]s$/i.test(name)) out = `${name}s`;
  return out + role;
}

/** Plural forms exist in English only; Chinese uses the label as is. */
const plural = (label: string): string => (currentLocale() === 'en' ? pluralizeLabel(label) : label);

export interface EffectLine {
  /** i18n key under `properties.rel.effect.*`. */
  key: 'one' | 'many' | 'oneNary' | 'manyNary' | 'total';
  params: { entity: string; entityPlural: string; others: string; relationship: string };
}

/**
 * Sentences describing the stored cardinality (look-across `max`) and participation. `max='one'` on participant P means:
 * for one combination of the OTHER participants there is at most one P. Nothing is invented: every sentence restates a stored field.
 */
export function effectLines(model: ErModel, rel: ErRelationship): EffectLine[] {
  const out: EffectLine[] = [];
  if (rel.participants.length < 2) return out;
  for (const p of rel.participants) {
    const others = rel.participants.filter((x) => x.id !== p.id).map((x) => participantLabel(model, x));
    const entity = participantLabel(model, p);
    const params = { entity, entityPlural: plural(entity), others: formatList(others), relationship: rel.name };
    const nary = rel.participants.length > 2;
    out.push({ key: p.max === 'one' ? (nary ? 'oneNary' : 'one') : nary ? 'manyNary' : 'many', params });
  }
  for (const p of rel.participants) {
    if (p.participation === 'total') out.push({ key: 'total', params: { entity: participantLabel(model, p), entityPlural: plural(participantLabel(model, p)), others: '', relationship: rel.name } });
  }
  return out;
}

/** Whether the "key participants" picker is meaningful: only relationships that produce their own relation. */
export function needsKeyPicker(model: ErModel, rel: ErRelationship): boolean {
  if (rel.identifying) return false;
  const a = analyzeRelationship(model, rel.id);
  return !!a && (a.shape === 'binary-M:N' || a.shape === 'n-ary');
}

/** New `keyParticipantIds` after toggling one participant, in participant order. */
export function toggleKeyParticipant(rel: ErRelationship, chosen: readonly Id[], participantId: Id, on: boolean): Id[] {
  const set = new Set(chosen);
  if (on) set.add(participantId);
  else set.delete(participantId);
  return rel.participants.map((p) => p.id).filter((id) => set.has(id));
}

/** Default entity for a new participant: the first entity not used yet, else the first entity. */
export function defaultParticipantEntity(model: ErModel, rel: ErRelationship): Id | undefined {
  const entities = Object.values(model.entities).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const used = new Set(rel.participants.map((p) => p.entityId));
  return (entities.find((e) => !used.has(e.id)) ?? entities[0])?.id;
}
