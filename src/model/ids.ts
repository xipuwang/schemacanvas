import type { Id } from './types';

/**
 * Stable id generation. Ids are `<prefix>_<token>`; never derived from names, so renaming
 * anything can never break references.
 *
 * Prefixes: prj model(mdl) dgm nod edg ent att rel(relationship) par(participant)
 *           rln(relation) col fk uq idx cnv
 */
export type IdGenerator = (prefix: string) => Id;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomToken(len: number): string {
  const bytes = new Uint8Array(len);
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

const randomGenerator: IdGenerator = (prefix) => `${prefix}_${randomToken(10)}`;

let generator: IdGenerator = randomGenerator;

/** Create a new project-unique id. */
export function newId(prefix: string): Id {
  return generator(prefix);
}

/**
 * Tests / fixtures: switch to a deterministic counter (`ent_1`, `att_2`, …) so snapshots and
 * assertions are stable. Returns a function that restores the previous generator.
 */
export function useDeterministicIds(start = 1): () => void {
  const previous = generator;
  let n = start;
  generator = (prefix) => `${prefix}_${n++}`;
  return () => {
    generator = previous;
  };
}

export function setIdGenerator(g: IdGenerator | null): void {
  generator = g ?? randomGenerator;
}
