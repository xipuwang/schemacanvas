/** Name helpers for generated relations / columns. Pure. */

/** `Capitalise` every whitespace-separated word and join: `dept name` -> `DeptName`, `SSN` -> `SSN`. */
export function pascal(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** `A` or `(A, B)` — how key column lists are written in explanations. */
export function listColumns(names: string[]): string {
  return names.length === 1 ? names[0]! : `(${names.join(', ')})`;
}
