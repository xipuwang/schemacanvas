/**
 * DBML importer: hand-written lexer + recursive-descent parser for Table / Ref / indexes / checks / Note blocks.
 * Same error discipline as the DDL importer: structure that cannot be represented is an explicit `SqlParseError` or a
 * `dbml.import.*` warning naming the construct and position, never a silent mis-parse. References resolve in a second
 * pass so a Ref may precede the tables it mentions.
 */
import { createRelationalModel } from '@/model/defaults';
import { newId } from '@/model/ids';
import { fkCardinality, sqlNameKey } from '@/model/queries';
import { fkTargetKey } from '@/model/relationalFacts';
import type { ForeignKey, Id, Issue, ReferentialAction, RelColumn, Relation, RelationalModel, SemanticRef } from '@/model/types';
import type { DbmlImportCode } from './codes';
import { importWarning } from './importWarn';
import type { Token } from './lexer';
import { SqlParseError, type ImportOptions, type ImportResult } from './types';

// ----- lexer ------------------------------------------------------------------------------------------------------

function lexDbml(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const advance = (j: number): void => {
    for (; i < j; i++) if (text[i] === '\n') (line++, (lineStart = i + 1));
  };
  const fail = (msg: string, at: number, l: number, c: number): never => {
    throw new SqlParseError(msg, l, c, at);
  };
  const push = (type: Token['type'], value: string, start: number, l: number, col: number, quote?: Token['quote']): void => {
    tokens.push({ type, value, upper: type === 'ident' ? value.toUpperCase() : '', start, end: i, line: l, col, ...(quote ? { quote } : {}) });
  };
  while (i < text.length) {
    const c = text[i]!;
    const start = i;
    const l = line;
    const col = i - lineStart + 1;
    if (/\s/.test(c) || c === '﻿') {
      advance(i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      advance(nl < 0 ? text.length : nl);
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) fail('Unterminated /* comment', start, l, col);
      advance(close + 2);
    } else if (c === "'" && text.startsWith("'''", i)) {
      const close = text.indexOf("'''", i + 3);
      if (close < 0) fail("Unterminated ''' string", start, l, col);
      const raw = text.slice(i + 3, close);
      advance(close + 3);
      push('string', raw.replace(/^\n/, '').replace(/\n[ \t]*$/, ''), start, l, col);
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= text.length || text[j] === '\n') fail(c === "'" ? 'Unterminated string' : 'Unterminated quoted name', start, l, col);
        const ch = text[j]!;
        if (ch === '\\' && j + 1 < text.length) {
          const n = text[j + 1]!;
          v += n === 'n' ? '\n' : n === "'" || n === '"' || n === '\\' ? n : `\\${n}`;
          j += 2;
          continue;
        }
        if (ch === c) break;
        v += ch;
        j++;
      }
      advance(j + 1);
      if (c === "'") push('string', v, start, l, col);
      else push('qident', v, start, l, col, '"');
    } else if (c === '`') {
      const close = text.indexOf('`', i + 1);
      if (close < 0) fail('Unterminated `expression`', start, l, col);
      const v = text.slice(i + 1, close);
      advance(close + 1);
      push('qident', v, start, l, col, '`');
    } else if (c === '<' && text[i + 1] === '>') {
      advance(i + 2);
      push('punct', '<>', start, l, col);
    } else if (/[0-9]/.test(c)) {
      const m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i))!;
      let len = m[0].length;
      // digits glued to letters (`1st_col`) are an identifier, not a number
      while (len < text.length - i && /[A-Za-z0-9_]/.test(text[i + len]!)) len++;
      const word = text.slice(i, i + len);
      advance(i + len);
      push(/^[0-9.eE+-]+$/.test(word) && word === m[0] ? 'number' : 'ident', word, start, l, col);
    } else if (/[A-Za-z_\u0080-￿#]/.test(c)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_$\u0080-￿]/.test(text[j]!)) j++;
      const word = text.slice(i, j);
      advance(j);
      push('ident', word, start, l, col);
    } else {
      advance(i + 1);
      push('punct', c, start, l, col);
    }
  }
  tokens.push({ type: 'eof', value: '', upper: '', start: text.length, end: text.length, line, col: text.length - lineStart + 1 });
  return tokens;
}

// ----- parser -----------------------------------------------------------------------------------------------------

interface Endpoint {
  schema?: string;
  table: string;
  columns: Array<{ name: string; tok: Token }>;
  tok: Token;
}
interface PendingRef {
  name?: string;
  left: Endpoint;
  op: '>' | '<' | '-' | '<>';
  right: Endpoint;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  tok: Token;
}
type Settings = Array<{ key: string; value?: Token; extra?: Endpoint & { op: PendingRef['op'] }; text?: string; tok: Token }>;

const ACTIONS: Record<string, ReferentialAction> = {
  cascade: 'CASCADE', restrict: 'RESTRICT', 'no action': 'NO ACTION', 'set null': 'SET NULL', 'set default': 'SET DEFAULT',
};
const SERIAL: Record<string, string> = { SERIAL: 'INTEGER', BIGSERIAL: 'BIGINT', SMALLSERIAL: 'SMALLINT' };

class DbmlParser {
  private pos = 0;
  readonly model: RelationalModel;
  readonly warnings: Issue[] = [];
  private readonly relations: Relation[] = [];
  private readonly aliases = new Map<string, Relation>();
  private readonly refs: PendingRef[] = [];

  constructor(
    private readonly text: string,
    private readonly tokens: Token[],
    opts: ImportOptions,
  ) {
    this.model = createRelationalModel(opts.name ?? 'Imported DBML schema', 'generic');
  }

  // ----- helpers ------------------------------------------------------------------------------------------------

  private peek(o = 0): Token {
    return this.tokens[Math.min(this.pos + o, this.tokens.length - 1)]!;
  }
  private next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.pos++;
    return t;
  }
  private fail(message: string, tok: Token = this.peek(), construct?: string): never {
    throw new SqlParseError(message, tok.line, tok.col, tok.start, construct);
  }
  private warn(
    code: DbmlImportCode,
    title: string,
    explanation: string,
    tok: Token,
    construct: string,
    affected: SemanticRef[] = [],
    params: Record<string, string | number> = {},
  ): void {
    this.warnings.push(importWarning('dbml.import', this.model.id, code, title, explanation, tok, construct, affected, params));
  }
  private describe(t: Token): string {
    return t.type === 'eof' ? 'end of input' : `'${this.text.slice(t.start, t.end)}'`;
  }
  private atP(ch: string, o = 0): boolean {
    const t = this.peek(o);
    return t.type === 'punct' && t.value === ch;
  }
  private acceptP(ch: string): boolean {
    if (this.atP(ch)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expectP(ch: string): Token {
    if (!this.atP(ch)) this.fail(`Expected '${ch}' but found ${this.describe(this.peek())}`);
    return this.next();
  }
  private isKw(t: Token, w: string): boolean {
    return t.type === 'ident' && t.upper === w;
  }
  /** Bare or quoted name (backtick expressions are not names). */
  private name(what: string): { name: string; tok: Token } {
    const t = this.peek();
    if (t.type === 'ident' || (t.type === 'qident' && t.quote === '"')) {
      this.pos++;
      return { name: t.value, tok: t };
    }
    return this.fail(`Expected ${what} but found ${this.describe(t)}`);
  }
  private stringValue(what: string): string {
    const t = this.peek();
    if (t.type !== 'string') this.fail(`Expected a quoted string for ${what} but found ${this.describe(t)}`);
    this.pos++;
    return t.value;
  }
  private skipBlock(): void {
    const open = this.expectP('{');
    let depth = 1;
    while (depth > 0) {
      const t = this.next();
      if (t.type === 'eof') this.fail('Unbalanced braces: missing }', open);
      if (t.type === 'punct' && t.value === '{') depth++;
      if (t.type === 'punct' && t.value === '}') depth--;
    }
  }

  // ----- top level ----------------------------------------------------------------------------------------------

  run(): void {
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (t.type !== 'ident') this.fail(`Unexpected ${this.describe(t)} at top level`);
      switch (t.upper) {
        case 'TABLE':
          this.table();
          break;
        case 'REF':
          this.refStatement();
          break;
        case 'PROJECT':
        case 'ENUM':
        case 'TABLEGROUP':
        case 'NOTE':
          this.pos++;
          while (!this.atP('{') && this.peek().type !== 'eof' && !this.atP(':')) this.pos++;
          if (this.acceptP(':')) this.pos++;
          else this.skipBlock();
          this.warn(
            'skipped-block',
            `${t.value} block ignored`,
            t.upper === 'ENUM'
              ? 'Enum types are not modelled; columns keep the enum name as their data type.'
              : t.upper === 'PROJECT'
                ? 'The Project block (database type, notes) is not imported.'
                : `The ${t.value} block is not imported.`,
            t,
            t.value,
            [],
            { variant: t.upper === 'ENUM' ? 'enum' : t.upper === 'PROJECT' ? 'project' : 'generic' },
          );
          break;
        case 'TABLEPARTIAL':
          this.fail('TablePartial blocks (and ~partial injection) are not supported', t, 'TablePartial');
          break;
        default:
          this.fail(`Unsupported top-level DBML keyword ${this.describe(t)}`, t, t.value);
      }
    }
    this.resolveRefs();
  }

  // ----- Table --------------------------------------------------------------------------------------------------

  private table(): void {
    this.next();
    let first = this.name('table name');
    let schema: string | undefined;
    if (this.acceptP('.')) {
      schema = first.name;
      first = this.name('table name');
    }
    let alias: string | undefined;
    if (this.isKw(this.peek(), 'AS')) {
      this.pos++;
      alias = this.name('alias').name;
    }
    const headerSettings = this.atP('[') ? this.settings() : [];
    this.expectP('{');
    if (this.relations.some((r) => sqlNameKey(r.name) === sqlNameKey(first.name) && sqlNameKey(r.schemaName ?? '') === sqlNameKey(schema ?? ''))) {
      this.fail(`Table ${first.name} is defined twice`, first.tok);
    }
    const relation: Relation = { id: newId('rln'), name: first.name, columns: [], primaryKey: [], uniques: [], indexes: [] };
    if (schema) relation.schemaName = schema;
    this.relations.push(relation);
    this.model.relations[relation.id] = relation;
    if (alias) this.aliases.set(sqlNameKey(alias), relation);
    for (const s of headerSettings) {
      if (s.key === 'note') relation.description = s.text ?? '';
      else this.warn('table-setting', 'Table setting ignored', `The table setting "${s.key}" is not modelled.`, s.tok, s.key, [{ kind: 'relation', id: relation.id }]);
    }

    while (!this.atP('}')) {
      const t = this.peek();
      if (t.type === 'eof') this.fail('Unbalanced braces: missing } for table ' + relation.name, first.tok);
      if (this.isKw(t, 'INDEXES') && this.atP('{', 1)) {
        this.pos++;
        this.indexesBlock(relation);
      } else if (this.isKw(t, 'CHECKS') && this.atP('{', 1)) {
        this.pos++;
        this.checksBlock(relation);
      } else if (this.isKw(t, 'NOTE') && (this.atP(':', 1) || this.atP('{', 1))) {
        this.pos++;
        if (this.acceptP(':')) relation.description = this.stringValue('Note');
        else {
          this.expectP('{');
          relation.description = this.stringValue('Note');
          this.expectP('}');
        }
      } else if (t.type === 'punct' && t.value === '~') {
        this.fail('TablePartial injection (~name) is not supported', t, '~partial');
      } else this.column(relation);
    }
    this.expectP('}');
  }

  private column(relation: Relation): void {
    const { name, tok } = this.name('column name');
    if (relation.columns.some((c) => sqlNameKey(c.name) === sqlNameKey(name))) this.fail(`Duplicate column ${name} in table ${relation.name}`, tok);
    const col: RelColumn = { id: newId('col'), name, nullable: true };
    const { text, serial } = this.typeName();
    col.dataType = text;
    if (serial) col.autoIncrement = true;
    relation.columns.push(col);
    const ref = { kind: 'column', relationId: relation.id, id: col.id } as const;
    let isPk = false;
    for (const s of this.atP('[') ? this.settings() : []) {
      switch (s.key) {
        case 'pk':
        case 'primary key':
          isPk = true;
          break;
        case 'not null':
          col.nullable = false;
          break;
        case 'null':
          break;
        case 'unique':
          relation.uniques.push({ id: newId('uq'), columnIds: [col.id] });
          break;
        case 'increment':
          col.autoIncrement = true;
          break;
        case 'default':
          col.defaultValue = s.text ?? '';
          break;
        case 'note':
          col.description = s.text ?? '';
          break;
        case 'ref':
          if (!s.extra) this.fail('Inline ref needs an operator and a target column', s.tok);
          this.refs.push({ left: { table: relation.name, ...(relation.schemaName ? { schema: relation.schemaName } : {}), columns: [{ name, tok }], tok }, op: s.extra.op, right: s.extra, tok: s.tok });
          break;
        default:
          this.warn('column-setting', 'Column setting ignored', `The column setting "${s.key}" on ${relation.name}.${name} is not modelled.`, s.tok, s.key, [ref], { relation: relation.name, columnName: name });
      }
    }
    if (isPk) {
      if (relation.primaryKey.length > 0) this.fail(`Table ${relation.name} declares several primary keys (use one composite key in indexes { })`, tok, 'pk');
      relation.primaryKey = [col.id];
    }
    if (col.autoIncrement || isPk) col.nullable = false;
  }

  /** Column type: name, optional `.name`, optional `(args)`, optional `[]`. Quoted names are taken verbatim. */
  private typeName(): { text: string; serial: boolean } {
    const first = this.name('column type');
    let text = first.name;
    if (this.acceptP('.')) text += `.${this.name('type name').name}`;
    if (this.atP('(')) {
      const open = this.next();
      const parts: string[] = [];
      for (;;) {
        const t = this.next();
        if (t.type === 'eof') this.fail('Unbalanced parentheses in type', open);
        if (t.type === 'punct' && t.value === ')') break;
        parts.push(t.type === 'string' ? `'${t.value.split("'").join("''")}'` : this.text.slice(t.start, t.end));
      }
      text += `(${parts.join('')})`;
    }
    while (this.atP('[') && this.atP(']', 1)) {
      this.pos += 2;
      text += '[]';
    }
    const serial = first.tok.type === 'ident' ? SERIAL[first.tok.upper] : undefined;
    return serial ? { text: serial, serial: true } : { text, serial: false };
  }

  // ----- settings -----------------------------------------------------------------------------------------------

  private settings(): Settings {
    this.expectP('[');
    const out: Settings = [];
    for (;;) {
      const words: string[] = [];
      const startTok = this.peek();
      while (this.peek().type === 'ident') words.push(this.next().value.toLowerCase());
      if (words.length === 0) this.fail(`Expected a setting name but found ${this.describe(this.peek())}`);
      const key = words.join(' ');
      const item: Settings[number] = { key, tok: startTok };
      if (this.acceptP(':')) this.settingValue(item);
      out.push(item);
      if (this.acceptP(',')) continue;
      break;
    }
    this.expectP(']');
    return out;
  }

  private settingValue(item: Settings[number]): void {
    const t = this.peek();
    switch (item.key) {
      case 'default':
        item.text = this.defaultValue();
        return;
      case 'note':
        item.text = this.stringValue('note');
        return;
      case 'ref': {
        const op = this.operator();
        const ep = this.endpoint();
        item.extra = { ...ep, op };
        return;
      }
      case 'delete':
      case 'update': {
        const words: string[] = [];
        while (this.peek().type === 'ident') words.push(this.next().value.toLowerCase());
        item.text = words.join(' ');
        return;
      }
      default:
        if (t.type === 'string' || t.type === 'ident' || t.type === 'number' || t.type === 'qident') {
          this.pos++;
          item.value = t;
          item.text = t.value;
          return;
        }
        this.fail(`Unexpected ${this.describe(t)} as the value of "${item.key}"`);
    }
  }

  /** DBML default -> raw SQL expression text (strings re-quoted SQL-style). */
  private defaultValue(): string {
    const t = this.next();
    if (t.type === 'string') return `'${t.value.split("'").join("''")}'`;
    if (t.type === 'qident' && t.quote === '`') return t.value.trim();
    if (t.type === 'number') return t.value;
    if (t.type === 'punct' && t.value === '-' && this.peek().type === 'number') return `-${this.next().value}`;
    if (t.type === 'ident' && /^(true|false|null)$/i.test(t.value)) return t.value.toLowerCase();
    return this.fail(`Unsupported default value ${this.describe(t)} (use a quoted string, a number, true/false/null or a \`backtick expression\`)`, t, 'default');
  }

  // ----- indexes / checks ---------------------------------------------------------------------------------------

  private indexesBlock(relation: Relation): void {
    this.expectP('{');
    while (!this.atP('}')) {
      const t = this.peek();
      if (t.type === 'eof') this.fail('Unbalanced braces in indexes block', t);
      if (t.type === 'qident' && t.quote === '`') {
        this.pos++;
        if (this.atP('[')) this.settings();
        this.warn('expression-index', 'Expression index skipped', `The index expression \`${t.value}\` on ${relation.name} cannot be modelled as columns.`, t, 'index expression', [{ kind: 'relation', id: relation.id }], { expression: t.value, relation: relation.name });
        continue;
      }
      const cols: Array<{ name: string; tok: Token }> = [];
      if (this.acceptP('(')) {
        for (;;) {
          const c = this.peek();
          if (c.type === 'qident' && c.quote === '`') this.fail('Expression parts inside a composite index are not supported', c, 'index expression');
          cols.push(this.name('column name'));
          if (this.acceptP(',')) continue;
          break;
        }
        this.expectP(')');
      } else cols.push(this.name('column name'));
      const settings = this.atP('[') ? this.settings() : [];
      const ids = cols.map((c) => {
        const col = relation.columns.find((x) => sqlNameKey(x.name) === sqlNameKey(c.name));
        if (!col) this.fail(`Index column ${c.name} does not exist in table ${relation.name}`, c.tok);
        return col.id;
      });
      const flag = (k: string): boolean => settings.some((s) => s.key === k);
      const val = (k: string): string | undefined => settings.find((s) => s.key === k)?.text;
      for (const s of settings) {
        if (!['pk', 'primary key', 'unique', 'name', 'type', 'note'].includes(s.key)) {
          this.warn('index-setting', 'Index setting ignored', `The index setting "${s.key}" is not modelled.`, s.tok, s.key, [{ kind: 'relation', id: relation.id }]);
        }
      }
      if (flag('pk') || flag('primary key')) {
        if (relation.primaryKey.length > 0) this.fail(`Table ${relation.name} declares several primary keys`, t, 'pk');
        relation.primaryKey = ids;
        for (const id of ids) relation.columns.find((c) => c.id === id)!.nullable = false;
        const n = val('name');
        if (n) relation.primaryKeyName = n;
      } else if (flag('unique') && !val('type')) {
        const n = val('name');
        relation.uniques.push({ id: newId('uq'), ...(n ? { name: n } : {}), columnIds: ids });
      } else {
        const method = val('type');
        relation.indexes.push({
          id: newId('idx'),
          name: val('name') ?? `idx_${relation.name}_${cols.map((c) => c.name).join('_')}`,
          columnIds: ids,
          unique: flag('unique'),
          ...(method ? { method } : {}),
        });
      }
    }
    this.expectP('}');
  }

  private checksBlock(relation: Relation): void {
    this.expectP('{');
    while (!this.atP('}')) {
      const t = this.next();
      if (!(t.type === 'qident' && t.quote === '`')) this.fail(`Expected a \`check expression\` but found ${this.describe(t)}`, t);
      const settings = this.atP('[') ? this.settings() : [];
      const n = settings.find((s) => s.key === 'name')?.text;
      const columnIds = relation.columns.filter((c) => new RegExp(`(^|[^A-Za-z0-9_])${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`, 'i').test(t.value)).map((c) => c.id);
      (relation.checks ??= []).push({ id: newId('chk'), ...(n ? { name: n } : {}), expression: t.value.trim(), ...(columnIds.length ? { columnIds } : {}) });
    }
    this.expectP('}');
  }

  // ----- Ref ----------------------------------------------------------------------------------------------------

  private operator(): PendingRef['op'] {
    const t = this.next();
    const isOp = (x: Token): boolean => x.type === 'punct' && (x.value === '>' || x.value === '<' || x.value === '-' || x.value === '<>');
    if (isOp(t) && !isOp(this.peek())) return t.value as PendingRef['op'];
    return this.fail(`Expected a relationship operator (>, <, - or <>) but found ${this.describe(t)}`, t);
  }

  private endpoint(): Endpoint {
    const parts: Array<{ name: string; tok: Token }> = [this.name('table name')];
    let columns: Endpoint['columns'] | undefined;
    while (this.acceptP('.')) {
      if (this.acceptP('(')) {
        columns = [];
        for (;;) {
          columns.push(this.name('column name'));
          if (this.acceptP(',')) continue;
          break;
        }
        this.expectP(')');
        break;
      }
      parts.push(this.name('name'));
    }
    if (!columns) {
      if (parts.length < 2) this.fail('A reference needs table.column', parts[0]!.tok);
      columns = [parts.pop()!];
    }
    if (parts.length > 2) this.fail('Too many name parts in reference', parts[0]!.tok);
    const table = parts.pop()!;
    return { ...(parts[0] ? { schema: parts[0].name } : {}), table: table.name, columns, tok: parts[0]?.tok ?? table.tok };
  }

  private refBody(name: string | undefined): void {
    const startTok = this.peek();
    const left = this.endpoint();
    const op = this.operator();
    const right = this.endpoint();
    const ref: PendingRef = { ...(name ? { name } : {}), left, op, right, tok: startTok };
    for (const s of this.atP('[') ? this.settings() : []) {
      if (s.key === 'delete' || s.key === 'update') {
        const a = ACTIONS[s.text ?? ''];
        if (!a) this.fail(`Unknown referential action "${s.text}"`, s.tok);
        if (s.key === 'delete') ref.onDelete = a;
        else ref.onUpdate = a;
      } else this.warn('ref-setting', 'Ref setting ignored', `The Ref setting "${s.key}" is not modelled.`, s.tok, s.key);
    }
    this.refs.push(ref);
  }

  private refStatement(): void {
    this.next();
    let name: string | undefined;
    const t = this.peek();
    if ((t.type === 'ident' || (t.type === 'qident' && t.quote === '"')) && (this.atP(':', 1) || this.atP('{', 1))) {
      name = t.value;
      this.pos++;
    }
    if (this.acceptP(':')) {
      this.refBody(name);
    } else if (this.acceptP('{')) {
      while (!this.atP('}')) {
        if (this.peek().type === 'eof') this.fail('Unbalanced braces in Ref block', t);
        this.refBody(name);
      }
      this.expectP('}');
    } else this.fail(`Expected ':' or '{' after Ref but found ${this.describe(this.peek())}`);
  }

  // ----- pass 2 -------------------------------------------------------------------------------------------------

  private findTable(schema: string | undefined, name: string, tok: Token): Relation {
    const alias = !schema ? this.aliases.get(sqlNameKey(name)) : undefined;
    if (alias) return alias;
    let cands = this.relations.filter((r) => sqlNameKey(r.name) === sqlNameKey(name));
    if (schema) cands = cands.filter((r) => sqlNameKey(r.schemaName ?? '') === sqlNameKey(schema));
    if (cands.length === 0) this.fail(`Reference to table ${schema ? `${schema}.` : ''}${name}, which is not defined`, tok, 'Ref');
    if (cands.length > 1) {
      const plain = cands.filter((r) => !r.schemaName);
      if (plain.length === 1) return plain[0]!;
      this.fail(`Table name ${name} is ambiguous between schemas`, tok);
    }
    return cands[0]!;
  }

  private resolveEndpoint(e: Endpoint): { rel: Relation; ids: Id[] } {
    const rel = this.findTable(e.schema, e.table, e.tok);
    const ids = e.columns.map((c) => {
      const col = rel.columns.find((x) => sqlNameKey(x.name) === sqlNameKey(c.name));
      if (!col) this.fail(`Reference to column ${rel.name}.${c.name}, which does not exist`, c.tok, 'Ref');
      return col.id;
    });
    return { rel, ids };
  }

  private uniqueName(base: string): string {
    let n = base;
    for (let k = 2; this.relations.some((r) => sqlNameKey(r.name) === sqlNameKey(n)); k++) n = `${base}_${k}`;
    return n;
  }

  private resolveRefs(): void {
    const desired = new Map<Id, 'one' | 'many'>();
    for (const ref of this.refs) {
      const l = this.resolveEndpoint(ref.left);
      const r = this.resolveEndpoint(ref.right);
      if (l.ids.length !== r.ids.length) {
        this.fail(`Reference joins ${l.ids.length} column(s) of ${l.rel.name} with ${r.ids.length} column(s) of ${r.rel.name}`, ref.tok, 'Ref');
      }
      if (ref.op === '<>') {
        this.junction(ref, l, r);
        continue;
      }
      const [src, tgt] = ref.op === '<' ? [r, l] : [l, r];
      const fk: ForeignKey = {
        id: newId('fk'),
        ...(ref.name ? { name: ref.name } : {}),
        sourceRelationId: src.rel.id,
        targetRelationId: tgt.rel.id,
        columns: src.ids.map((s, i) => ({ sourceColumnId: s, targetColumnId: tgt.ids[i]! })),
        ...(ref.onDelete ? { onDelete: ref.onDelete } : {}),
        ...(ref.onUpdate ? { onUpdate: ref.onUpdate } : {}),
      };
      this.model.foreignKeys[fk.id] = fk;
      desired.set(fk.id, ref.op === '-' ? 'one' : 'many');
      if (fkTargetKey(tgt.rel, fk).kind === 'none') {
        this.warn('fk-target-not-key', 'Reference does not target a key', `The referenced columns of ${tgt.rel.name} are neither its primary key nor unique; most engines reject this foreign key.`, ref.tok, 'Ref', [{ kind: 'foreignKey', id: fk.id }], { target: tgt.rel.name });
      }
    }
    // Cardinality is stored only when DBML says something the model would not derive by itself.
    for (const [id, want] of desired) {
      const fk = this.model.foreignKeys[id]!;
      if (fkCardinality(this.model, fk).childMax !== want) fk.cardinality = { childMax: want };
    }
  }

  /** `<>`: DBML has no physical FK for many-to-many, so a junction table with two FKs is generated and reported. */
  private junction(ref: PendingRef, l: { rel: Relation; ids: Id[] }, r: { rel: Relation; ids: Id[] }): void {
    const rel: Relation = { id: newId('rln'), name: this.uniqueName(`${l.rel.name}_${r.rel.name}`), columns: [], primaryKey: [], uniques: [], indexes: [] };
    this.relations.push(rel);
    this.model.relations[rel.id] = rel;
    const used = new Set<string>();
    const add = (side: { rel: Relation; ids: Id[] }): Id[] =>
      side.ids.map((id) => {
        const src = side.rel.columns.find((c) => c.id === id)!;
        let n = `${side.rel.name}_${src.name}`;
        for (let k = 2; used.has(sqlNameKey(n)); k++) n = `${side.rel.name}_${src.name}_${k}`;
        used.add(sqlNameKey(n));
        const col: RelColumn = { id: newId('col'), name: n, nullable: false, ...(src.dataType ? { dataType: src.dataType } : {}) };
        rel.columns.push(col);
        return col.id;
      });
    const lc = add(l);
    const rc = add(r);
    rel.primaryKey = [...lc, ...rc];
    for (const [cols, side] of [[lc, l], [rc, r]] as const) {
      const fk: ForeignKey = {
        id: newId('fk'),
        sourceRelationId: rel.id,
        targetRelationId: side.rel.id,
        columns: cols.map((c, i) => ({ sourceColumnId: c, targetColumnId: side.ids[i]! })),
        ...(ref.onDelete ? { onDelete: ref.onDelete } : {}),
        ...(ref.onUpdate ? { onUpdate: ref.onUpdate } : {}),
      };
      this.model.foreignKeys[fk.id] = fk;
    }
    this.warn('many-to-many', 'Many-to-many turned into a junction table', `DBML "<>" has no foreign key; table ${rel.name} with a composite primary key and two foreign keys was generated.`, ref.tok, '<>', [{ kind: 'relation', id: rel.id }], { relation: rel.name });
  }
}

// ----- public API -------------------------------------------------------------------------------------------------

/**
 * Parse DBML into a RelationalModel (dialect `generic`). THROWS `SqlParseError` (line/column) for unsupported or invalid
 * input; deliberate omissions are in `warnings`.
 */
export function importDbml(text: string, opts: ImportOptions = {}): ImportResult {
  const parser = new DbmlParser(text, lexDbml(text), opts);
  parser.run();
  return { model: parser.model, warnings: parser.warnings };
}
