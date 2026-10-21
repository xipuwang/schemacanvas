/**
 * Pure modules (scene, conversion, validation, sql, layout) receive DEEPLY FROZEN projects in the app (zustand+immer
 * auto-freezes). Freeze fixtures in their tests so an accidental in-place mutation fails here, not only in the browser.
 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
