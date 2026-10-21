import { describe, expect, it } from 'vitest';
import { lex } from './lexer';
import { ident, isReservedWord, needsQuoting, quoteIdent } from './identifiers';
import { mapType } from './typeMap';
import { SqlParseError } from './types';

describe('identifiers', () => {
  it('quotes only when needed', () => {
    expect(ident('users', 'postgresql')).toBe('users');
    expect(ident('Users', 'postgresql')).toBe('"Users"');
    expect(ident('a b', 'mysql')).toBe('`a b`');
    expect(ident('1abc', 'sqlite')).toBe('"1abc"');
    expect(ident('select', 'sqlite')).toBe('"select"');
    expect(ident('x', 'sqlite', true)).toBe('"x"');
  });
  it('escapes the quote character by doubling', () => {
    expect(quoteIdent('a"b', 'postgresql')).toBe('"a""b"');
    expect(quoteIdent('a`b', 'mysql')).toBe('`a``b`');
    expect(quoteIdent('a"b', 'mysql')).toBe('`a"b`');
  });
  it('reserved words are dialect aware; generic is the union', () => {
    expect(isReservedWord('ORDER', 'postgresql')).toBe(true);
    expect(isReservedWord('autoincrement', 'sqlite')).toBe(true);
    expect(isReservedWord('autoincrement', 'postgresql')).toBe(false);
    expect(needsQuoting('autoincrement', 'generic')).toBe(true);
    expect(isReservedWord('ilike', 'generic')).toBe(true);
  });
});

describe('typeMap', () => {
  it('keeps native spellings, maps foreign ones, drops integer display widths', () => {
    expect(mapType('int(11)', 'mysql').sql).toBe('INT');
    expect(mapType('INT4', 'mysql').sql).toBe('INT');
    expect(mapType('TIMESTAMP', 'mysql').sql).toBe('TIMESTAMP');
    expect(mapType('TIMESTAMPTZ', 'mysql').sql).toBe('DATETIME');
    expect(mapType('varchar(20)', 'postgresql').sql).toBe('VARCHAR(20)');
    expect(mapType('decimal(10,2)', 'sqlite').sql).toBe('DECIMAL(10, 2)');
    expect(mapType('BOOLEAN', 'mysql').sql).toBe('BOOLEAN');
  });
  it('flags unknown and modified types as verbatim', () => {
    expect(mapType('hstore', 'postgresql')).toMatchObject({ kind: 'unknown', sql: 'hstore' });
    expect(mapType('int unsigned', 'mysql')).toMatchObject({ kind: 'modifier', sql: 'int unsigned' });
    expect(mapType('integer[]', 'postgresql')).toMatchObject({ kind: 'modifier' });
  });
});

describe('lexer', () => {
  const o = { backtick: true, bracket: true, hashComment: false, backslashEscapes: false };
  it('tracks line/column and reports unterminated constructs with position', () => {
    const { tokens } = lex('a\n  bb', o);
    expect(tokens.slice(0, 2).map((t) => [t.value, t.line, t.col])).toEqual([['a', 1, 1], ['bb', 2, 3]]);
    try {
      lex("x\n 'abc", o);
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SqlParseError);
      expect([(e as SqlParseError).line, (e as SqlParseError).column]).toEqual([2, 2]);
    }
  });
  it('strings: doubled quotes, E-strings, dollar quoting; arrays are not bracket identifiers', () => {
    const t = lex(`'it''s' E'a\\'b' $tag$x;y$tag$ int[] [id]`, o).tokens.filter((x) => x.type !== 'eof');
    expect(t.map((x) => [x.type, x.value])).toEqual([
      ['string', "it's"], ['string', "a'b"], ['string', 'x;y'], ['ident', 'int'], ['punct', '['], ['punct', ']'], ['qident', 'id'],
    ]);
  });
});
