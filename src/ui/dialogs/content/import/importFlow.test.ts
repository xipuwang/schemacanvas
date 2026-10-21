import { describe, expect, it } from 'vitest';
import { createEditorStore } from '@/store';
import { createBareProject } from '@/model/defaults';
import { generateDdl, exportDbml } from '@/sql';
import { buildExample } from '@/examples';
import { serializeProject } from '@/model/io';
import { applyModelImport, buildExcerpt, parseImport, parseProjectText } from './importFlow';

const GOOD = `CREATE TABLE Doctor (SSN CHAR(9) PRIMARY KEY, Name VARCHAR(50) NOT NULL);
CREATE TABLE Patient (SSN CHAR(9) PRIMARY KEY, DoctorSSN CHAR(9) REFERENCES Doctor (SSN));`;

describe('parseImport', () => {
  it('summarises a valid DDL import and reports nothing silently', () => {
    const r = parseImport('sql', GOOD);
    if (r.status !== 'ok') throw new Error(JSON.stringify(r));
    expect(r.summary).toEqual({ tables: 2, foreignKeys: 1, columns: 4 });
  });

  it('reports parse errors with line and column and an excerpt marking the offending line', () => {
    const bad = 'CREATE TABLE A (id INT PRIMARY KEY);\nCREATE TABLE B (id INT PRIMARY KEY, x INT REFERENCES );\n';
    const r = parseImport('sql', bad);
    if (r.status !== 'error') throw new Error('expected an error');
    expect(r.line).toBe(2);
    expect(r.column).toBeGreaterThan(1);
    expect(r.message).not.toMatch(/\(line \d+, column \d+\)/);
    const marked = r.excerpt.find((l) => l.caret !== undefined)!;
    expect(marked.line).toBe(2);
    expect(r.excerpt.map((l) => l.line)).toEqual([1, 2, 3].slice(0, r.excerpt.length));
  });

  it('treats blank text as empty and reports DBML errors too', () => {
    expect(parseImport('sql', '  \n ').status).toBe('empty');
    const r = parseImport('dbml', 'Table A {\n  id int [pk\n}');
    expect(r.status).toBe('error');
  });

  it('then accepts the fixed text', () => {
    expect(parseImport('sql', 'CREATE TABLE A (id INT PRIMARY KEY, x INT REFERENCES ').status).toBe('error');
    expect(parseImport('sql', 'CREATE TABLE A (id INT PRIMARY KEY);').status).toBe('ok');
  });

  it('exported SQL and DBML re-import to the same tables and keys', () => {
    const project = buildExample('pharmacy');
    const rel = Object.values(project.models).find((m) => m.kind === 'relational')!;
    if (rel.kind !== 'relational') throw new Error();
    const ddl = generateDdl(rel, 'postgresql').sql;
    const viaSql = parseImport('sql', ddl, 'postgresql');
    const viaDbml = parseImport('dbml', exportDbml(rel));
    if (viaSql.status !== 'ok' || viaDbml.status !== 'ok') throw new Error('round trip failed');
    const names = (m: typeof viaSql.model): string[] => Object.values(m.relations).map((r) => r.name).sort();
    expect(names(viaSql.model)).toEqual(names(rel));
    expect(names(viaDbml.model)).toEqual(names(rel));
    expect(viaSql.summary.foreignKeys).toBe(Object.keys(rel.foreignKeys).length);
    expect(viaDbml.summary.foreignKeys).toBe(Object.keys(rel.foreignKeys).length);
  });
});

describe('buildExcerpt', () => {
  it('windows very long lines around the caret', () => {
    const long = 'x'.repeat(500) + ' BAD ' + 'y'.repeat(500);
    const ex = buildExcerpt(long, 1, 502);
    expect(ex[0]!.text.length).toBeLessThan(260);
    expect(ex[0]!.text.slice(ex[0]!.caret!, ex[0]!.caret! + 3)).toBe('BAD');
  });
});

describe('applyModelImport', () => {
  it('adds the model and a laid-out diagram in ONE commit, activates it, and undo removes it', async () => {
    const store = createEditorStore({ project: createBareProject() });
    const parsed = parseImport('sql', GOOD);
    if (parsed.status !== 'ok') throw new Error();
    const before = store.getState().undoStack.length;
    const r = await applyModelImport(parsed.model, { diagramName: 'Imported', label: 'Import SQL', store });
    const s = store.getState();
    expect(s.undoStack.length).toBe(before + 1);
    expect(s.activeDiagramId).toBe(r.diagramId);
    const d = s.project.diagrams[r.diagramId]!;
    expect(d.type).toBe('relational-schema');
    expect(d.name).toBe('Imported');
    expect(Object.keys(d.nodes)).toHaveLength(2);
    expect(Object.keys(d.edges)).toHaveLength(1);
    const xs = Object.values(d.nodes).map((n) => `${n.x},${n.y}`);
    expect(new Set(xs).size).toBe(2); // laid out, not stacked at the origin
    s.undo();
    expect(store.getState().project.models[r.modelId]).toBeUndefined();
  });
});

describe('parseProjectText', () => {
  it('loads a serialized project and reports malformed files with a message', () => {
    const ok = parseProjectText(serializeProject(buildExample('recursive-1n')));
    expect(ok.ok).toBe(true);
    const bad = parseProjectText('{ not json');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message.length).toBeGreaterThan(3);
  });
});
