/**
 * STRUCTURAL validation of a raw project: required fields and their JSON types, plus `record key === element.id`.
 * It never looks at meaning (dangling FK, missing PK, … load as-is) and it never copies/strips anything, so unknown
 * properties other modules add later survive a load → save cycle verbatim.
 */

export interface StructuralProblem {
  path: string;
  message: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const DIAGRAM_TYPES = ['chen', 'relational-schema', 'crows-foot', 'physical'];
/** Largest |x| / |y| accepted for node positions and waypoints (the viewport offset is only required to be finite). */
export const MAX_COORD = 1e7;
const MODEL_KINDS = ['er', 'relational'];

class Check {
  problem: StructuralProblem | undefined;
  fail(path: string, message: string): false {
    this.problem ??= { path, message };
    return false;
  }
  obj(v: unknown, path: string): v is Obj {
    return isObj(v) || this.fail(path, 'expected an object');
  }
  arr(v: unknown, path: string): v is unknown[] {
    return Array.isArray(v) || this.fail(path, 'expected an array');
  }
  str(o: Obj, key: string, path: string): boolean {
    return typeof o[key] === 'string' || this.fail(`${path}.${key}`, 'expected a string');
  }
  num(o: Obj, key: string, path: string): boolean {
    const v = o[key];
    return (typeof v === 'number' && Number.isFinite(v)) || this.fail(`${path}.${key}`, 'expected a finite number');
  }
  /** A finite diagram coordinate within a sane bound (absurd values load as an invisible, unreachable canvas). */
  coord(o: Obj, key: string, path: string): boolean {
    const v = o[key];
    return (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD) || this.fail(`${path}.${key}`, `expected a coordinate within ±${MAX_COORD}`);
  }
  bool(o: Obj, key: string, path: string): boolean {
    return typeof o[key] === 'boolean' || this.fail(`${path}.${key}`, 'expected a boolean');
  }
  oneOf(o: Obj, key: string, path: string, allowed: string[]): boolean {
    const v = o[key];
    return (typeof v === 'string' && allowed.includes(v)) || this.fail(`${path}.${key}`, `expected one of ${allowed.join(', ')}`);
  }
  /** ON DELETE / ON UPDATE reach DDL text, so only the five standard actions (any case, single spaces) are accepted. */
  optReferentialAction(o: Obj, key: string, path: string): boolean {
    const v = o[key];
    if (v === undefined) return true;
    const ok = typeof v === 'string' && ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'].includes(v.trim().replace(/\s+/g, ' ').toUpperCase());
    return ok || this.fail(`${path}.${key}`, 'expected one of CASCADE, SET NULL, SET DEFAULT, RESTRICT, NO ACTION');
  }
  /** An index method reaches DDL text, so it must be a plain word. */
  optIndexMethod(o: Obj, path: string): boolean {
    const v = o.method;
    if (v === undefined) return true;
    return (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(v.trim())) || this.fail(`${path}.method`, 'expected a plain word (letters, digits, underscores)');
  }
  optStr(o: Obj, key: string, path: string): boolean {
    return o[key] === undefined || this.str(o, key, path);
  }
  /** A `Record<Id, T>` whose keys equal the element ids; `each` validates one element. */
  record(parent: Obj, key: string, path: string, each: (el: Obj, p: string) => void): void {
    const rec = parent[key];
    const p = `${path}.${key}`;
    if (!this.obj(rec, p)) return;
    for (const [k, el] of Object.entries(rec)) {
      const ep = `${p}.${k}`;
      if (!this.obj(el, ep)) return;
      if (!this.str(el, 'id', ep)) return;
      if (el.id !== k) {
        this.fail(`${ep}.id`, `record key "${k}" does not match element id "${String(el.id)}"`);
        return;
      }
      each(el, ep);
      if (this.problem) return;
    }
  }
  list(parent: Obj, key: string, path: string, each: (el: Obj, p: string) => void): void {
    const list = parent[key];
    const p = `${path}.${key}`;
    if (!this.arr(list, p)) return;
    for (let i = 0; i < list.length; i++) {
      const ep = `${p}[${i}]`;
      const el = list[i];
      if (!this.obj(el, ep)) return;
      each(el, ep);
      if (this.problem) return;
    }
  }
  strList(parent: Obj, key: string, path: string): void {
    const list = parent[key];
    const p = `${path}.${key}`;
    if (!this.arr(list, p)) return;
    list.forEach((v, i) => typeof v === 'string' || this.fail(`${p}[${i}]`, 'expected a string'));
  }
  optStrList(parent: Obj, key: string, path: string): void {
    if (parent[key] !== undefined) this.strList(parent, key, path);
  }
  /** Optional `Origin`: `sources` must be an array of refs (kind + id fields), `ruleId` a string. */
  optOrigin(parent: Obj, path: string): void {
    const origin = parent.origin;
    if (origin === undefined) return;
    const p = `${path}.origin`;
    if (!this.obj(origin, p)) return;
    this.str(origin, 'ruleId', p);
    this.optStr(origin, 'key', p);
    this.optStr(origin, 'note', p);
    const sources = origin.sources;
    if (!this.arr(sources, `${p}.sources`)) return;
    sources.forEach((src, i) => this.refValue(src, `${p}.sources[${i}]`, false));
  }
  semanticRef(o: Obj, key: string, path: string, edge = false): void {
    this.refValue(o[key], `${path}.${key}`, edge);
  }
  private refValue(value: unknown, p: string, edge: boolean): void {
    if (!this.obj(value, p)) return;
    const ref = value;
    if (!this.str(ref, 'kind', p)) return;
    // Id fields per ref kind (edge refs and node refs have different shapes).
    const idFields: Record<string, string[]> = {
      participant: ['relationshipId', 'participantId'],
      attribute: ['attributeId'],
      foreignKey: ['foreignKeyId'],
    };
    const nodeFields: Record<string, string[]> = {
      participant: ['relationshipId', 'id'],
      column: ['relationId', 'id'],
      unique: ['relationId', 'id'],
      index: ['relationId', 'id'],
    };
    for (const f of this.refFields(edge, ref, idFields, nodeFields)) this.str(ref, f, p);
  }
  private refFields(edge: boolean, ref: Obj, edgeFields: Record<string, string[]>, nodeFields: Record<string, string[]>): string[] {
    const kind = String(ref.kind);
        if (edge) return edgeFields[kind] ?? [];
    return nodeFields[kind] ?? ['id'];
  }
}

function checkErModel(c: Check, m: Obj, p: string): void {
  c.record(m, 'entities', p, (e, ep) => {
    c.str(e, 'name', ep);
    c.bool(e, 'weak', ep);
    c.optStr(e, 'associativeOf', ep);
  });
  c.record(m, 'attributes', p, (a, ap) => {
    c.str(a, 'name', ap);
    c.num(a, 'order', ap);
    c.str(a, 'key', ap);
    c.bool(a, 'multivalued', ap);
    c.bool(a, 'derived', ap);
    c.optStr(a, 'dataType', ap);
    if (c.obj(a.owner, `${ap}.owner`)) {
      c.str(a.owner as Obj, 'kind', `${ap}.owner`);
      c.str(a.owner as Obj, 'id', `${ap}.owner`);
    }
  });
  c.record(m, 'relationships', p, (r, rp) => {
    c.str(r, 'name', rp);
    c.bool(r, 'identifying', rp);
    c.optStrList(r, 'keyParticipantIds', rp);
    c.list(r, 'participants', rp, (par, pp) => {
      c.str(par, 'id', pp);
      c.str(par, 'entityId', pp);
      c.oneOf(par, 'max', pp, ['one', 'many']);
      c.oneOf(par, 'participation', pp, ['partial', 'total']);
      c.optStr(par, 'cardinalityLabel', pp);
    });
  });
}

function checkRelationalModel(c: Check, m: Obj, p: string): void {
  c.str(m, 'dialect', p);
  c.record(m, 'relations', p, (r, rp) => {
    c.str(r, 'name', rp);
    c.optStr(r, 'schemaName', rp);
    c.optOrigin(r, rp);
    c.strList(r, 'primaryKey', rp);
    c.list(r, 'columns', rp, (col, cp) => {
      c.str(col, 'id', cp);
      c.str(col, 'name', cp);
      c.bool(col, 'nullable', cp);
      c.optStr(col, 'dataType', cp);
      c.optStr(col, 'defaultValue', cp);
      c.optOrigin(col, cp);
    });
    c.list(r, 'uniques', rp, (u, up) => {
      c.str(u, 'id', up);
      c.strList(u, 'columnIds', up);
      c.optOrigin(u, up);
    });
    c.list(r, 'indexes', rp, (ix, ip) => {
      c.str(ix, 'id', ip);
      c.str(ix, 'name', ip);
      c.strList(ix, 'columnIds', ip);
      c.bool(ix, 'unique', ip);
      c.optStr(ix, 'where', ip);
      c.optIndexMethod(ix, ip);
      c.optStrList(ix, 'descendingColumnIds', ip);
    });
    if (r.checks !== undefined) {
      c.list(r, 'checks', rp, (ck, kp) => {
        c.str(ck, 'id', kp);
        c.str(ck, 'expression', kp);
        c.optStrList(ck, 'columnIds', kp);
      });
    }
  });
  c.record(m, 'foreignKeys', p, (fk, fp) => {
    c.str(fk, 'sourceRelationId', fp);
    c.str(fk, 'targetRelationId', fp);
    c.optOrigin(fk, fp);
    c.optReferentialAction(fk, 'onDelete', fp);
    c.optReferentialAction(fk, 'onUpdate', fp);
    if (fk.cardinality !== undefined) c.obj(fk.cardinality, `${fp}.cardinality`);
    c.list(fk, 'columns', fp, (pair, pp) => {
      c.str(pair, 'sourceColumnId', pp);
      c.str(pair, 'targetColumnId', pp);
    });
  });
}

function checkDiagram(c: Check, d: Obj, p: string): void {
  c.str(d, 'name', p);
  c.oneOf(d, 'type', p, DIAGRAM_TYPES);
  c.str(d, 'modelId', p);
  c.record(d, 'nodes', p, (n, np) => {
    c.semanticRef(n, 'ref', np);
    c.coord(n, 'x', np);
    c.coord(n, 'y', np);
  });
  c.record(d, 'edges', p, (e, ep) => {
    c.semanticRef(e, 'ref', ep, true);
    if (c.obj(e.route, `${ep}.route`)) {
      c.oneOf(e.route as Obj, 'mode', `${ep}.route`, ['auto', 'manual']);
      c.list(e.route as Obj, 'waypoints', `${ep}.route`, (pt, wp) => {
        c.coord(pt, 'x', wp);
        c.coord(pt, 'y', wp);
      });
    }
  });
  // `options` itself may be absent or partial: the loader fills missing blocks (fillDiagramOptions).
  if (d.options !== undefined) c.obj(d.options, `${p}.options`);
  if (d.viewport !== undefined && c.obj(d.viewport, `${p}.viewport`)) {
    // the screen offset is roughly node position x zoom (up to 4), so it is only required to be finite, not bounded
    for (const k of ['x', 'y']) c.num(d.viewport as Obj, k, `${p}.viewport`);
    c.num(d.viewport as Obj, 'zoom', `${p}.viewport`);
  }
}

/** First structural problem in `project` (a raw, already-migrated `ProjectFile.project`), or `undefined`. */
export function findStructuralProblem(project: unknown, path = 'project'): StructuralProblem | undefined {
  const c = new Check();
  if (!c.obj(project, path)) return c.problem;
  c.str(project, 'id', path);
  c.str(project, 'name', path);
  c.str(project, 'createdAt', path);
  c.str(project, 'updatedAt', path);
  c.strList(project, 'diagramOrder', path);
  if (c.obj(project.settings, `${path}.settings`)) c.str(project.settings as Obj, 'defaultDialect', `${path}.settings`);
  c.record(project, 'conversions', path, () => undefined);
  c.record(project, 'models', path, (m, mp) => {
    if (!c.oneOf(m, 'kind', mp, MODEL_KINDS)) return;
    c.str(m, 'name', mp);
    if (m.kind === 'er') checkErModel(c, m, mp);
    else checkRelationalModel(c, m, mp);
  });
  c.record(project, 'diagrams', path, (d, dp) => {
    checkDiagram(c, d, dp);
    // `models[modelId]` must be an OWN key: 'toString' etc. would otherwise resolve to a prototype member.
    if (!c.problem && !Object.hasOwn(project.models as Obj, d.modelId as string)) c.fail(`${dp}.modelId`, `refers to unknown model "${String(d.modelId)}"`);
  });
  return c.problem;
}
