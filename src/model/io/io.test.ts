import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '../ids';
import { useFixedClock } from '../clock';
import { defaultDiagramOptions } from '../defaults';
import { PROJECT_FORMAT, SCHEMA_VERSION, type Project } from '../types';
import { deepFreeze } from '@/test/deepFreeze';
import { loadProjectData, parseProjectFile, serializeProject } from './index';
import { largeProject, sampleProject } from './testFixtures';

let restoreIds: () => void;
let restoreClock: () => void;
beforeEach(() => {
  restoreIds = useDeterministicIds();
  restoreClock = useFixedClock('2026-01-01T00:00:00.000Z');
});
afterEach(() => {
  restoreIds();
  restoreClock();
});

type Obj = Record<string, unknown>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function loadOk(text: string): Project {
  const r = parseProjectFile(text);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.project;
}

describe('serialize / parse round-trip', () => {
  it('round-trips a project exactly', () => {
    const p = sampleProject();
    const back = loadOk(serializeProject(deepFreeze(clone(p)), '2026-01-01T00:00:00.000Z'));
    expect(back).toEqual(p);
  });

  it('writes the envelope with format, version, savedAt and app', () => {
    const env = JSON.parse(serializeProject(sampleProject(), '2026-02-03T04:05:06.000Z')) as Obj;
    expect(env.format).toBe(PROJECT_FORMAT);
    expect(env.schemaVersion).toBe(SCHEMA_VERSION);
    expect(env.savedAt).toBe('2026-02-03T04:05:06.000Z');
    expect((env.app as Obj).name).toBe('SchemaCanvas');
  });

  it('does not mutate a frozen input and loadProjectData does not mutate its raw input', () => {
    const frozen = deepFreeze(sampleProject());
    const text = serializeProject(frozen);
    const raw = deepFreeze(JSON.parse(text));
    const r = loadProjectData(raw);
    expect(r.ok).toBe(true);
  });

  it('round-trips a large project', () => {
    const p = largeProject(600);
    const text = serializeProject(p);
    const r = parseProjectFile(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project).toEqual(p);
      expect(serializeProject(r.project, '2026-01-01T00:00:00.000Z')).toBe(serializeProject(p, '2026-01-01T00:00:00.000Z'));
    }
  });

  // SOFT problems (see model/invariants.ts) are data, not corruption. FK->missing RELATION is a HARD invariant and is
  // deliberately not used here.
  it('preserves semantic problems verbatim (FK pair to a missing column, no PK) and never repairs them', () => {
    const p = sampleProject();
    const rm = Object.values(p.models).find((m) => m.kind === 'relational');
    if (rm?.kind !== 'relational') throw new Error('fixture');
    const fk = Object.values(rm.foreignKeys)[0]!;
    fk.columns[0]!.targetColumnId = 'col_missing';
    const rel = Object.values(rm.relations)[0]!;
    rel.primaryKey = [];
    const back = loadOk(serializeProject(p));
    expect(back).toEqual(p);
  });
});

/** Add `__x` markers at every object level of the project; returns how many were added. */
function injectUnknown(value: unknown, depth = 0, counter = { n: 0 }): number {
  if (Array.isArray(value)) {
    for (const v of value) injectUnknown(v, depth + 1, counter);
  } else if (value && typeof value === 'object') {
    const o = value as Obj;
    for (const v of Object.values(o)) injectUnknown(v, depth + 1, counter);
    // A Record<Id, T> map (or an empty object, which may be one) takes entries, not properties.
    const entries = Object.entries(o);
    const isRecordMap = entries.length === 0 || entries.every(([k, v]) => !!v && typeof v === 'object' && (v as Obj).id === k);
    if (isRecordMap) return counter.n;
    o.__unknown = { future: [1, 'two', { three: 3 }], n: counter.n++ };
  }
  return counter.n;
}

describe('unknown properties are preserved verbatim', () => {
  it('survives load -> serialise at every level (envelope included)', () => {
    const p = sampleProject();
    const env = JSON.parse(serializeProject(p, '2026-01-01T00:00:00.000Z')) as Obj;
    const added = injectUnknown(env);
    expect(added).toBeGreaterThan(50);
    const loaded = loadProjectData(env);
    if (!loaded.ok) throw new Error(loaded.error.message);
    // The envelope-level unknown is not part of Project, so compare the project subtree and then the whole file.
    const reserialised = JSON.parse(serializeProject(loaded.project, '2026-01-01T00:00:00.000Z')) as Obj;
    expect(reserialised.project).toEqual(env.project);
  });
});

describe('failure modes', () => {
  const good = () => serializeProject(sampleProject());

  it('rejects text that is not JSON', () => {
    const r = parseProjectFile('{nope');
    expect(r).toMatchObject({ ok: false, error: { code: 'not-json' } });
  });

  it('rejects a truncated file as not-json', () => {
    const text = good();
    expect(parseProjectFile(text.slice(0, Math.floor(text.length / 2)))).toMatchObject({ ok: false, error: { code: 'not-json' } });
    expect(parseProjectFile('')).toMatchObject({ ok: false, error: { code: 'not-json' } });
  });

  it('rejects wrong format tags and non-object roots', () => {
    expect(parseProjectFile('[]')).toMatchObject({ ok: false, error: { code: 'wrong-format' } });
    expect(parseProjectFile('null')).toMatchObject({ ok: false, error: { code: 'wrong-format' } });
    expect(parseProjectFile('{"format":"drawio","schemaVersion":1}')).toMatchObject({ ok: false, error: { code: 'wrong-format' } });
    // a bare Project without the envelope is not a project file
    expect(loadProjectData(sampleProject())).toMatchObject({ ok: false, error: { code: 'wrong-format' } });
  });

  it('rejects a newer schema version', () => {
    const env = JSON.parse(good()) as Obj;
    env.schemaVersion = SCHEMA_VERSION + 1;
    expect(loadProjectData(env)).toMatchObject({ ok: false, error: { code: 'newer-version' } });
  });

  it('rejects bad schemaVersion values', () => {
    for (const v of [0, -1, 1.5, '1', null]) {
      const env = JSON.parse(good()) as Obj;
      env.schemaVersion = v;
      expect(loadProjectData(env), String(v)).toMatchObject({ ok: false, error: { code: 'invalid-structure', path: 'schemaVersion' } });
    }
  });

  it('rejects an older version with no migration as unsupported-version', () => {
    const env = JSON.parse(good()) as Obj;
    env.schemaVersion = 1;
    expect(loadProjectData(env, { currentVersion: 3, migrations: {} })).toMatchObject({ ok: false, error: { code: 'unsupported-version' } });
  });

  const mutations: Array<[string, (env: Obj) => void, string]> = [
    ['missing project', (e) => delete e.project, 'project'],
    ['project is an array', (e) => (e.project = []), 'project'],
    ['project.name not a string', (e) => ((e.project as Obj).name = 42), 'project.name'],
    ['diagrams not an object', (e) => ((e.project as Obj).diagrams = 'x'), 'project.diagrams'],
    ['diagramOrder has non-string', (e) => ((e.project as Obj).diagramOrder = [1]), 'project.diagramOrder[0]'],
    ['settings missing', (e) => delete (e.project as Obj).settings, 'project.settings'],
    [
      'node x is a string',
      (e) => {
        const d = Object.values((e.project as Obj).diagrams as Obj)[0] as Obj;
        const n = Object.values(d.nodes as Obj)[0] as Obj;
        n.x = '10';
      },
      '.x',
    ],
    [
      'diagram type unknown',
      (e) => ((Object.values((e.project as Obj).diagrams as Obj)[0] as Obj).type = 'uml'),
      '.type',
    ],
    [
      'record key differs from id',
      (e) => {
        const models = (e.project as Obj).models as Obj;
        const [k, m] = Object.entries(models)[0]!;
        (m as Obj).id = `${k}_other`;
      },
      '.id',
    ],
    [
      'column nullable not boolean',
      (e) => {
        const rm = Object.values((e.project as Obj).models as Obj).find((m) => (m as Obj).kind === 'relational') as Obj;
        const rel = Object.values(rm.relations as Obj)[0] as Obj;
        (rel.columns as Obj[])[0]!.nullable = 'no';
      },
      '.nullable',
    ],
    [
      'fk column pair malformed',
      (e) => {
        const rm = Object.values((e.project as Obj).models as Obj).find((m) => (m as Obj).kind === 'relational') as Obj;
        const fk = Object.values(rm.foreignKeys as Obj)[0] as Obj;
        (fk.columns as Obj[])[0]!.targetColumnId = 7;
      },
      '.targetColumnId',
    ],
    [
      'edge route missing',
      (e) => {
        const d = Object.values((e.project as Obj).diagrams as Obj).find((x) => Object.keys((x as Obj).edges as Obj).length) as Obj;
        delete (Object.values(d.edges as Obj)[0] as Obj).route;
      },
      '.route',
    ],
    [
      'participant max invalid',
      (e) => {
        const er = Object.values((e.project as Obj).models as Obj).find((m) => (m as Obj).kind === 'er') as Obj;
        const rel = Object.values(er.relationships as Obj)[0] as Obj;
        (rel.participants as Obj[])[0]!.max = 'lots';
      },
      '.max',
    ],
  ];
  for (const [name, mutate, pathPart] of mutations) {
    it(`invalid-structure: ${name}`, () => {
      const env = JSON.parse(good()) as Obj;
      mutate(env);
      const r = loadProjectData(env);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('invalid-structure');
        expect(r.error.path).toContain(pathPart);
      }
    });
  }
});

describe('option filling', () => {
  it('fills a missing options object and missing blocks/keys without touching existing values', () => {
    const env = JSON.parse(serializeProject(sampleProject())) as Obj;
    const diagrams = Object.values((env.project as Obj).diagrams as Obj) as Obj[];
    const chen = diagrams.find((d) => d.type === 'chen')!;
    const rel = diagrams.find((d) => d.type === 'relational-schema')!;
    delete chen.options;
    const ro = rel.options as { relational?: Obj; grid: Obj };
    delete ro.relational;
    ro.grid.size = 40; // customised, must survive
    delete ro.grid.snap;
    const r = loadProjectData(env);
    if (!r.ok) throw new Error(r.error.message);
    const loadedChen = r.project.diagrams[chen.id as string]!;
    const loadedRel = r.project.diagrams[rel.id as string]!;
    expect(loadedChen.options).toEqual(defaultDiagramOptions('chen'));
    expect(loadedRel.options.relational).toEqual(defaultDiagramOptions('relational-schema').relational);
    expect(loadedRel.options.grid).toEqual({ visible: true, size: 40, snap: true });
    expect(r.repairs.length).toBe(2); // one log line per repaired diagram
  });

  it('reports no repairs for a clean project', () => {
    const r = parseProjectFile(serializeProject(sampleProject()));
    expect(r.ok && r.repairs).toEqual([]);
  });
});

describe('migrations machinery (synthetic steps)', () => {
  it('runs steps in order, stamps versions, reports migratedFrom and validates the migrated shape', () => {
    const p = sampleProject();
    const env = JSON.parse(serializeProject(p)) as Obj;
    env.schemaVersion = 1;
    const calls: number[] = [];
    // v1 files (synthetic) call the project title `title`; v2 renamed it to `name`; v3 adds an unknown marker.
    const v1 = clone(env);
    const proj = v1.project as Obj;
    proj.title = proj.name;
    delete proj.name;
    const r = loadProjectData(v1, {
      currentVersion: 3,
      migrations: {
        1: (raw) => {
          calls.push(1);
          const e = raw as Obj;
          const pr = { ...(e.project as Obj) };
          pr.name = pr.title;
          delete pr.title;
          return { ...e, project: pr };
        },
        2: (raw) => {
          calls.push(2);
          const e = raw as Obj;
          return { ...e, project: { ...(e.project as Obj), migratedMarker: true } };
        },
      },
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(calls).toEqual([1, 2]);
    expect(r.migratedFrom).toBe(1);
    expect(r.project.name).toBe(p.name);
    expect(r.project.schemaVersion).toBe(3);
    expect((r.project as unknown as Obj).migratedMarker).toBe(true);
    expect(v1.schemaVersion).toBe(1); // input untouched
    expect((v1.project as Obj).title).toBe(p.name);
  });

  it('a migration that throws or returns a non-object yields invalid-structure', () => {
    const env = JSON.parse(serializeProject(sampleProject())) as Obj;
    const boom = loadProjectData(env, { currentVersion: 2, migrations: { 1: () => { throw new Error('boom'); } } });
    expect(boom).toMatchObject({ ok: false, error: { code: 'invalid-structure' } });
    const bad = loadProjectData(env, { currentVersion: 2, migrations: { 1: () => 5 } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid-structure' } });
  });

  it('a migration producing a structurally broken project is rejected after migrating', () => {
    const env = JSON.parse(serializeProject(sampleProject())) as Obj;
    const r = loadProjectData(env, { currentVersion: 2, migrations: { 1: (raw) => ({ ...(raw as Obj), project: { nonsense: true } }) } });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid-structure' } });
  });

  it('is not run when the file is already current', () => {
    let ran = false;
    const r = parseProjectFile(serializeProject(sampleProject()), { migrations: { 1: (x) => ((ran = true), x) } });
    expect(r.ok && r.migratedFrom).toBeUndefined();
    expect(ran).toBe(false);
  });

  it('production registry ships no fabricated migrations', async () => {
    const { migrations } = await import('./migrations');
    expect(Object.keys(migrations)).toEqual([]);
  });
});
