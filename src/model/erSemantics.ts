/**
 * Shared ER interpretation. The converter, the validator, the Chen renderer and the properties panel
 * ALL derive cardinality / identification / key facts through these functions — never re-derive them.
 *
 * Conventions (see types.ts): `ErParticipant.max` is LOOK-ACROSS ("how many instances of THIS entity per one
 * combination of all the OTHER participants"); `participation` is NEAR-SIDE ("must every instance of this
 * entity take part").
 */
import { ownGet } from './queries';
import type { ErEntity, ErModel, ErParticipant, ErRelationship, Id } from './types';

// ----- identification (weak entities) -------------------------------------

/**
 * The IDENTIFIED (dependent) participants of an identifying relationship: those flagged `identified`, else the
 * unique participant whose entity is weak. Empty for non-identifying or unresolved (ambiguous) relationships.
 */
export function identifiedParticipants(model: ErModel, rel: ErRelationship): ErParticipant[] {
  if (!rel.identifying) return [];
  const flagged = rel.participants.filter((p) => p.identified);
  if (flagged.length > 0) return flagged;
  const weak = rel.participants.filter((p) => ownGet(model.entities, p.entityId)?.weak);
  return weak.length === 1 ? weak : [];
}

export interface OwnershipLink {
  relationship: ErRelationship;
  weakParticipant: ErParticipant;
  ownerParticipant: ErParticipant;
  owner: ErEntity;
}

/** Every owner→dependent link of ALL weak entities, keyed by the dependent entity (one pass over the relationships). */
function ownershipLinksByEntity(model: ErModel, only?: Id): Map<Id, OwnershipLink[]> {
  const out = new Map<Id, OwnershipLink[]>();
  for (const relationship of Object.values(model.relationships)) {
    const identified = identifiedParticipants(model, relationship);
    if (identified.length === 0) continue;
    const identifiedIds = new Set(identified.map((i) => i.id));
    for (const weakParticipant of identified) {
      if (only !== undefined && weakParticipant.entityId !== only) continue;
      for (const ownerParticipant of relationship.participants) {
        if (identifiedIds.has(ownerParticipant.id)) continue;
        const owner = ownGet(model.entities, ownerParticipant.entityId);
        if (!owner) continue;
        let list = out.get(weakParticipant.entityId);
        if (!list) out.set(weakParticipant.entityId, (list = []));
        list.push({ relationship, weakParticipant, ownerParticipant, owner });
      }
    }
  }
  return out;
}

/** Every owner→dependent link of one weak entity, including degenerate self-ownership (for validation). */
function rawOwnershipLinks(model: ErModel, weakEntityId: Id): OwnershipLink[] {
  return ownershipLinksByEntity(model, weakEntityId).get(weakEntityId) ?? [];
}

/**
 * Owners of a weak entity, in relationship/participant order (multi-owner identification supported; a weak entity
 * may itself own another weak entity). Self-ownership is excluded here and reported via `identificationOrder`.
 */
export function weakEntityOwners(model: ErModel, weakEntityId: Id): OwnershipLink[] {
  return rawOwnershipLinks(model, weakEntityId).filter((l) => l.owner.id !== weakEntityId);
}

/** Minimal binary min-heap of numbers. */
class MinHeap {
  private a: number[] = [];
  get size(): number {
    return this.a.length;
  }
  push(v: number): void {
    const a = this.a;
    let i = a.push(v) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]! <= v) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = v;
  }
  pop(): number {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1]! < a[c]!) c++;
        if (a[c]! >= last) break;
        a[i] = a[c]!;
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

/**
 * Entities ordered so every owner precedes the entities it identifies (the order the converter must process
 * them in, because a dependent's key contains its owners' FULL keys). `cycles` lists strongly-connected groups
 * (including self-ownership) — validation reports them as `er.weak-ownership-cycle`; entities inside or
 * downstream of a cycle are appended at the end of `order`.
 *
 * O(V + E) (plus a log for the pass heap): the order is that of repeated left-to-right passes over the entities,
 * placing every entity whose owners are all placed (so a dependent LATER in entity order than its owner is placed in
 * the same pass, an earlier one in the next). Cycles come from an iterative Tarjan over the unplaced entities.
 */
export function identificationOrder(model: ErModel): { order: Id[]; cycles: Id[][] } {
  const ids = Object.keys(model.entities);
  const n = ids.length;
  const indexOf = new Map<Id, number>(ids.map((id, i) => [id, i]));
  const links = ownershipLinksByEntity(model);
  // owners[i]: distinct owner indices in first-seen order (dependent -> its owners)
  const owners: number[][] = ids.map((id) => {
    const seen = new Set<number>();
    for (const l of links.get(id) ?? []) {
      const o = indexOf.get(l.owner.id);
      if (o !== undefined) seen.add(o);
    }
    return [...seen];
  });
  const dependents: number[][] = Array.from({ length: n }, () => []);
  const pending = new Array<number>(n).fill(0);
  owners.forEach((os, i) => {
    pending[i] = os.length;
    for (const o of os) dependents[o]!.push(i);
  });

  const order: Id[] = [];
  const placed = new Array<boolean>(n).fill(false);
  let nextPass: number[] = [];
  for (let i = 0; i < n; i++) if (pending[i] === 0) nextPass.push(i);
  while (nextPass.length > 0) {
    const heap = new MinHeap();
    for (const i of nextPass) heap.push(i);
    nextPass = [];
    let cursor = -1;
    while (heap.size > 0) {
      const i = heap.pop();
      cursor = i;
      placed[i] = true;
      order.push(ids[i]!);
      for (const d of dependents[i]!) {
        if (--pending[d]! === 0) {
          if (d > cursor) heap.push(d);
          else nextPass.push(d);
        }
      }
    }
  }

  const blocked: number[] = [];
  for (let i = 0; i < n; i++) if (!placed[i]) blocked.push(i);

  // Iterative Tarjan restricted to blocked nodes (edges dependent -> owner).
  let counter = 0;
  const idx = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const cycles: Id[][] = [];
  for (const root of blocked) {
    if (idx[root]! >= 0) continue;
    const work: Array<{ v: number; next: number }> = [{ v: root, next: 0 }];
    idx[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const v = frame.v;
      const os = owners[v]!;
      if (frame.next < os.length) {
        const w = os[frame.next++]!;
        if (placed[w]) continue;
        if (idx[w]! < 0) {
          idx[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          work.push({ v: w, next: 0 });
        } else if (onStack[w]) {
          low[v] = Math.min(low[v]!, idx[w]!);
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]!.v;
        low[parent] = Math.min(low[parent]!, low[v]!);
      }
      if (low[v] === idx[v]) {
        const comp: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = false;
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1 || owners[v]!.includes(v)) cycles.push(comp.reverse().map((k) => ids[k]!));
      }
    }
  }
  return { order: [...order, ...blocked.map((k) => ids[k]!)], cycles };
}

// ----- associative entities ------------------------------------------------

export function associativeEntityOf(model: ErModel, relationshipId: Id): ErEntity | undefined {
  return Object.values(model.entities).find((e) => e.associativeOf === relationshipId);
}

// ----- keys & cardinality shape --------------------------------------------

/**
 * Candidate keys implied by LOOK-ACROSS `max` (participant-id sets, in participant order): for every participant P
 * with max='one', ALL OTHER participants form a key (they functionally determine P); if no participant has
 * max='one', all participants together are the only key. Examples: 1:N A(one)–B(many) ⇒ [{B}]; 1:1 ⇒ [{B},{A}];
 * M:N ⇒ [{A,B}]; ternary with one 'one' participant ⇒ [{the other two}]. Key-flagged relationship attributes are
 * appended to every key by the converter (types.ts `ErKeyKind`).
 */
export function relationshipCandidateKeys(rel: ErRelationship): Id[][] {
  const all = rel.participants.map((p) => p.id);
  const ones = rel.participants.filter((p) => p.max === 'one');
  if (ones.length === 0) return [all];
  const seen = new Set<string>();
  const keys: Id[][] = [];
  for (const p of ones) {
    const key = all.filter((id) => id !== p.id);
    const sig = key.join('|');
    if (!seen.has(sig)) {
      seen.add(sig);
      keys.push(key);
    }
  }
  return keys;
}

/** True when `participantIds` contains at least one candidate key. */
export function isRelationshipSuperkey(rel: ErRelationship, participantIds: Id[]): boolean {
  return relationshipCandidateKeys(rel).some((key) => key.every((id) => participantIds.includes(id)));
}

export type RelationshipShape = 'binary-1:1' | 'binary-1:N' | 'binary-M:N' | 'n-ary';

export interface RelationshipAnalysis {
  shape: RelationshipShape;
  recursive: boolean;
  identifying: boolean;
  oneSide: ErParticipant[];
  manySide: ErParticipant[];
  candidateKeys: Id[][];
  /** `keyParticipantIds` verbatim when set, else the first candidate key. */
  chosenKey: Id[];
  keySource: 'user' | 'derived';
  /** False when a user-chosen key does not contain any candidate key (validation `er.relationship-key-vs-cardinality`). */
  chosenKeyValid: boolean;
}

/** Undefined when the relationship is missing or has fewer than 2 participants (a soft-invalid state). */
export function analyzeRelationship(model: ErModel, relationshipId: Id): RelationshipAnalysis | undefined {
  const rel = ownGet(model.relationships, relationshipId);
  if (!rel || rel.participants.length < 2) return undefined;
  const oneSide = rel.participants.filter((p) => p.max === 'one');
  const manySide = rel.participants.filter((p) => p.max === 'many');
  let shape: RelationshipShape = 'n-ary';
  if (rel.participants.length === 2) {
    shape = oneSide.length === 2 ? 'binary-1:1' : oneSide.length === 1 ? 'binary-1:N' : 'binary-M:N';
  }
  const entityIds = rel.participants.map((p) => p.entityId);
  const candidateKeys = relationshipCandidateKeys(rel);
  const user = rel.keyParticipantIds && rel.keyParticipantIds.length > 0;
  const chosenKey = user ? [...rel.keyParticipantIds!] : candidateKeys[0]!;
  return {
    shape,
    recursive: new Set(entityIds).size < entityIds.length,
    identifying: rel.identifying,
    oneSide,
    manySide,
    candidateKeys,
    chosenKey,
    keySource: user ? 'user' : 'derived',
    chosenKeyValid: isRelationshipSuperkey(rel, chosenKey),
  };
}

// ----- cardinality labels --------------------------------------------------

/**
 * NEAR-side (min,max) of participant P — the notation used by `cardinalityStyle: 'minmax'`.
 *  min = P.participation === 'total' ? 1 : 0;  max = the OTHER participant's look-across max (binary only).
 * Dept(1)–Works_for–Employee(N, total): Employee=(1,1), Dept=(0,N). Returns undefined for n-ary relationships:
 * the near-side max is not derivable from look-across maxima and no constraint may be invented.
 */
export function minMaxOf(rel: ErRelationship, participantId: Id): { min: 0 | 1; max: '1' | 'N' } | undefined {
  if (rel.participants.length !== 2) return undefined;
  const p = rel.participants.find((x) => x.id === participantId);
  const other = rel.participants.find((x) => x.id !== participantId);
  if (!p || !other) return undefined;
  return { min: p.participation === 'total' ? 1 : 0, max: other.max === 'one' ? '1' : 'N' };
}

const MANY_LETTERS = ['M', 'N', 'P', 'Q', 'R', 'S'];

/** Default letters for `many` participants: one many ⇒ `N`; several ⇒ `M`, `N`, `P`, … in participant order. */
function derivedLetter(rel: ErRelationship, p: ErParticipant): string {
  if (p.max === 'one') return '1';
  const manies = rel.participants.filter((x) => x.max === 'many');
  if (manies.length === 1) return 'N';
  const i = manies.findIndex((x) => x.id === p.id);
  return MANY_LETTERS[i] ?? 'N';
}

/**
 * The label drawn at the participant's entity end. `letters`: the participant's `cardinalityLabel` when it is
 * consistent with `max` ('1' iff max='one'), otherwise derived (`1` / `N` / `M`…). `minmax`: `(min,max)` via
 * `minMaxOf`; n-ary relationships fall back to `letters`.
 */
export function cardinalityText(rel: ErRelationship, participantId: Id, style: 'letters' | 'minmax' = 'letters'): string {
  const p = rel.participants.find((x) => x.id === participantId);
  if (!p) return '';
  if (style === 'minmax') {
    const mm = minMaxOf(rel, participantId);
    if (mm) return `(${mm.min},${mm.max})`;
  }
  const label = p.cardinalityLabel?.trim();
  if (label && (label === '1') === (p.max === 'one')) return label;
  return derivedLetter(rel, p);
}
