import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';

const joined = (lines: ReturnType<typeof highlight>): string => lines.map((l) => l.map((t) => t.text).join('')).join('\n');

describe('highlight', () => {
  const sql = [
    '-- header comment',
    'CREATE TABLE "Student" (',
    "  SID INTEGER PRIMARY KEY, -- key",
    "  Name VARCHAR(50) DEFAULT 'it''s' NOT NULL,",
    '  GPA numeric(3, 2) /* inline */ ,',
    '  /* block',
    '  still comment */ x INT',
    ');',
  ].join('\n');

  it('is lossless', () => {
    expect(joined(highlight(sql, 'sql'))).toBe(sql);
  });

  it('classifies comments, keywords, types, strings, quoted identifiers and numbers', () => {
    const lines = highlight(sql, 'sql');
    expect(lines[0]).toEqual([{ text: '-- header comment', kind: 'com' }]);
    const kinds = (n: number): Record<string, string> => Object.fromEntries(lines[n]!.map((t) => [t.text, t.kind]));
    expect(kinds(1)).toMatchObject({ CREATE: 'kw', TABLE: 'kw', '"Student"': 'id' });
    expect(kinds(2)).toMatchObject({ INTEGER: 'type', PRIMARY: 'kw', KEY: 'kw' });
    expect(lines[2]!.at(-1)).toEqual({ text: '-- key', kind: 'com' });
    expect(kinds(3)).toMatchObject({ VARCHAR: 'type', '50': 'num', "'it''s'": 'str', NOT: 'kw', NULL: 'kw' });
  });

  it('keeps block comments open across lines', () => {
    const lines = highlight(sql, 'sql');
    expect(lines[5]!.every((t) => t.kind === 'com' || t.text.trim() === '')).toBe(true);
    expect(lines[6]![0]!.kind).toBe('com');
    expect(lines[6]!.some((t) => t.text === 'INT' && t.kind === 'type')).toBe(true);
  });

  it('highlights DBML with // comments', () => {
    const dbml = 'Table Student {\n  SID int [pk] // key\n}\nRef: A.x > B.y';
    const lines = highlight(dbml, 'dbml');
    expect(joined(lines)).toBe(dbml);
    expect(lines[0]![0]).toEqual({ text: 'Table', kind: 'kw' });
    expect(lines[1]!.some((t) => t.text === 'pk' && t.kind === 'kw')).toBe(true);
    expect(lines[1]!.at(-1)!.kind).toBe('com');
    expect(lines[3]![0]).toEqual({ text: 'Ref', kind: 'kw' });
  });

  it('copes with an unterminated string and empty input', () => {
    expect(joined(highlight("select 'oops", 'sql'))).toBe("select 'oops");
    expect(highlight('', 'sql')).toEqual([[]]);
  });
});
