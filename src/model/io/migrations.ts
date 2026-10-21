/**
 * Schema migrations. Each step upgrades the WHOLE raw `ProjectFile` envelope from version n to n+1 and must be
 * pure (return a new value; never mutate the input) and operate on untyped JSON — the TypeScript types describe only
 * the CURRENT version, so a step cannot rely on them.
 *
 * The registry is intentionally empty while `SCHEMA_VERSION === 1`: no migration exists until a breaking change
 * ships. When bumping the version, register `migrations[<old>] = step` here and add a fixture test of the old shape.
 */
export type MigrationStep = (raw: unknown) => unknown;
export type MigrationRegistry = Record<number, MigrationStep>;

export const migrations: MigrationRegistry = {};

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly fromVersion: number,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Run steps `from → target`. The machinery (not the step) stamps `schemaVersion` on the envelope after each step so a
 * step cannot forget it. Throws `MigrationError` when a step is missing or throws.
 */
export function runMigrations(raw: Record<string, unknown>, from: number, target: number, registry: MigrationRegistry): Record<string, unknown> {
  let current: unknown = raw;
  for (let v = from; v < target; v++) {
    const step = registry[v];
    if (!step) throw new MigrationError(`No migration registered from schema version ${v} to ${v + 1}`, v);
    try {
      current = step(current);
    } catch (e) {
      throw new MigrationError(`Migration ${v} → ${v + 1} failed: ${e instanceof Error ? e.message : String(e)}`, v);
    }
    if (!isObject(current)) throw new MigrationError(`Migration ${v} → ${v + 1} did not return an object`, v);
    current = { ...current, schemaVersion: v + 1 };
  }
  return current as Record<string, unknown>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
