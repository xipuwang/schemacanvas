/**
 * DDL importer: hand-written tokenizer (lexer.ts) + recursive-descent parser for a documented subset of
 * PostgreSQL / SQLite / MySQL / ANSI DDL (see README "Supported subset").
 *
 * Error discipline (never a silent mis-parse):
 *  - syntax that would change the imported SCHEMA if skipped (computed columns, unknown column attributes, ALTER TABLE
 *    ADD COLUMN, expression index keys, CREATE TABLE ... AS SELECT, INHERITS/PARTITION BY …) -> `SqlParseError`;
 *  - statements/options that do not describe tables (views, triggers, INSERT, DROP, SET, ENGINE=...) -> skipped with a
 *    warning issue (`sql.import.*`) naming the construct and its position.
 *
 * Two passes: pass 1 builds relations, columns, PK/UNIQUE/CHECK/INDEX immediately and queues every foreign key; pass 2
 * resolves the queued FKs so tables may reference tables defined LATER in the script.
 */
import { createRelationalModel } from '@/model/defaults';
import { newId } from '@/model/ids';
import { fkTargetKey } from '@/model/relationalFacts';
import { sqlNameKey } from '@/model/queries';
import type {
  CheckConstraint,
  ForeignKey,
  Id,
  Issue,
  ReferentialAction,
  RelColumn,
  Relation,
  RelationalModel,
  SemanticRef,
  SqlDialect,
} from '@/model/types';
import type { SqlImportCode } from './codes';
import { importWarning } from './importWarn';
import { lex, type Token } from './lexer';
import { SqlParseError, type ImportOptions, type ImportResult } from './types';

// ----- small types ------------------------------------------------------------------------------------------------

interface KeyPart {
  name: string;
  tok: Token;
  desc: boolean;
  prefix?: number;
}
interface QualName {
  schema?: string;
  name: string;
  tok: Token;
}
interface RefClause {
  target: QualName;
  columns?: KeyPart[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}
type Constraint =
  | { kind: 'pk'; name?: string; cols: KeyPart[]; tok: Token }
  | { kind: 'unique'; name?: string; cols: KeyPart[]; tok: Token }
  | { kind: 'index'; name?: string; cols: KeyPart[]; method?: string; where?: string; tok: Token }
  | { kind: 'fk'; name?: string; cols: KeyPart[]; ref: RefClause; tok: Token }
  | { kind: 'check'; name?: string; text: string; tokens: Token[]; tok: Token };

interface PendingFk {
  name?: string;
  source: Relation;
  sourceColumnIds: Id[];
  ref: RefClause;
}

/** Words that end a type name / default expression and start a column attribute. */
const COLUMN_STARTERS = new Set([
  'CONSTRAINT', 'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'AUTO_INCREMENT', 'AUTOINCREMENT',
  'GENERATED', 'COLLATE', 'COMMENT', 'ON', 'KEY', 'AS', 'DEFERRABLE', 'INITIALLY', 'CHARSET',
]);

/** Words that may follow the first word of a multi-word type (DOUBLE PRECISION, TIMESTAMP WITH TIME ZONE, INT UNSIGNED …). */
const TYPE_CONTINUATION = new Set([
  'PRECISION', 'VARYING', 'UNSIGNED', 'SIGNED', 'ZEROFILL', 'WITH', 'WITHOUT', 'TIME', 'ZONE', 'YEAR', 'MONTH', 'DAY', 'HOUR',
  'MINUTE', 'SECOND', 'TO',
]);

const SERIAL: Record<string, string> = {
  SERIAL: 'INTEGER', SERIAL4: 'INTEGER', BIGSERIAL: 'BIGINT', SERIAL8: 'BIGINT', SMALLSERIAL: 'SMALLINT', SERIAL2: 'SMALLINT',
};

/** Statement-leading words that never describe tables: skipped with a warning. */
const SKIPPABLE = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'SET', 'USE', 'GRANT', 'REVOKE', 'COMMENT', 'PRAGMA', 'SELECT', 'COMMIT', 'ROLLBACK',
  'BEGIN', 'START', 'LOCK', 'UNLOCK', 'TRUNCATE', 'ANALYZE', 'VACUUM', 'REINDEX', 'COPY', 'SAVEPOINT', 'RELEASE', 'WITH',
  'RENAME', 'ATTACH', 'DETACH', 'EXPLAIN', 'CALL', 'DO', 'REPLACE', 'END',
]);

/** Words that can only start a new statement; meeting one inside CREATE TABLE options / an index predicate means a missing ';'. */
const STATEMENT_START = new Set(['CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'SELECT', 'TRUNCATE', 'GRANT', 'REVOKE']);

/** Keyword spellings legal after a CREATE TABLE column list (MySQL / PostgreSQL / SQLite). Values (InnoDB, utf8mb4 ...) follow `=` or a taker word. */
const TABLE_OPTION_WORDS = new Set([
  'ENGINE', 'DEFAULT', 'CHARSET', 'CHARACTER', 'SET', 'COLLATE', 'AUTO_INCREMENT', 'ROW_FORMAT', 'WITHOUT', 'ROWID', 'STRICT',
  'WITH', 'OIDS', 'TABLESPACE', 'ON', 'COMMIT', 'PRESERVE', 'ROWS', 'DELETE', 'DROP', 'KEY_BLOCK_SIZE', 'MIN_ROWS', 'MAX_ROWS',
  'AVG_ROW_LENGTH', 'CHECKSUM', 'DELAY_KEY_WRITE', 'PACK_KEYS', 'STATS_AUTO_RECALC', 'STATS_PERSISTENT', 'STATS_SAMPLE_PAGES',
  'COMPRESSION', 'ENCRYPTION', 'CONNECTION', 'DATA', 'DIRECTORY', 'INDEX', 'UNION', 'INSERT_METHOD', 'PASSWORD', 'STORAGE',
  'DISK', 'MEMORY', 'COMMENT', 'USING', 'AUTOEXTEND_SIZE', 'SECONDARY_ENGINE', 'TABLE_CHECKSUM', 'NO', 'FIRST', 'LAST',
  'IGNORE', 'REPLACE', 'FILLFACTOR', 'WITHOUT_OIDS',
]);
/** Words directly followed by a bare value word (`CHARACTER SET utf8`, `TABLESPACE ts`, `COLLATE x`, `ENGINE InnoDB`). */
const TABLE_OPTION_VALUE_TAKERS = new Set(['SET', 'CHARSET', 'COLLATE', 'TABLESPACE', 'ENGINE', 'COMMIT', 'ROW_FORMAT', 'COMPRESSION', 'CONNECTION', 'DIRECTORY', 'USING', 'DEFAULT', 'PRESERVE', 'DELETE', 'DROP', 'ON', 'INSERT_METHOD', 'ENCRYPTION', 'SECONDARY_ENGINE', 'STORAGE', 'AUTO_INCREMENT', 'PASSWORD']);

const ACTIONS: Record<string, ReferentialAction> = {
  CASCADE: 'CASCADE', RESTRICT: 'RESTRICT', 'NO ACTION': 'NO ACTION', 'SET NULL': 'SET NULL', 'SET DEFAULT': 'SET DEFAULT',
};

// ----- parser -----------------------------------------------------------------------------------------------------

class DdlParser {
  private pos = 0;
  private readonly tokens: Token[];
  readonly model: RelationalModel;
  readonly warnings: Issue[] = [];
  private readonly relations: Relation[] = [];
  private readonly pending: PendingFk[] = [];
  private readonly serialUniques = new Set<Id>();
  private readonly sawDialect = { mysql: false, sqlite: false, postgresql: false };

  constructor(
    private readonly text: string,
    private readonly dialect: SqlDialect | 'auto',
    opts: ImportOptions,
    tokens: Token[],
  ) {
    this.tokens = tokens;
    this.model = createRelationalModel(opts.name ?? 'Imported SQL schema', 'generic');
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.quote === '`') this.sawDialect.mysql = true;
      if (t.quote === '[') this.sawDialect.sqlite = true;
      if (t.type === 'ident' && ['AUTO_INCREMENT', 'ENGINE', 'UNSIGNED', 'ZEROFILL'].includes(t.upper)) this.sawDialect.mysql = true;
      if (t.type === 'ident' && t.upper === 'AUTOINCREMENT') this.sawDialect.sqlite = true;
      if (t.type === 'ident' && ['SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'IDENTITY', 'BYTEA', 'JSONB', 'TIMESTAMPTZ'].includes(t.upper)) this.sawDialect.postgresql = true;
      if (t.type === 'punct' && t.value === ':' && tokens[i + 1]?.value === ':') this.sawDialect.postgresql = true;
    }
  }

  // ----- token helpers ------------------------------------------------------------------------------------------

  private peek(o = 0): Token {
    return this.tokens[Math.min(this.pos + o, this.tokens.length - 1)]!;
  }
  private next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.pos++;
    return t;
  }
  private isKw(t: Token, ...words: string[]): boolean {
    return t.type === 'ident' && words.includes(t.upper);
  }
  private atKw(...words: string[]): boolean {
    return this.isKw(this.peek(), ...words);
  }
  private acceptKw(...words: string[]): boolean {
    if (this.atKw(...words)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expectKw(word: string): Token {
    if (!this.atKw(word)) this.fail(`Expected ${word} but found ${this.describe(this.peek())}`);
    return this.next();
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
  private describe(t: Token): string {
    return t.type === 'eof' ? 'end of input' : `'${this.text.slice(t.start, t.end)}'`;
  }
  private fail(message: string, tok: Token = this.peek(), construct?: string): never {
    throw new SqlParseError(message, tok.line, tok.col, tok.start, construct);
  }
  private warn(
    code: SqlImportCode,
    title: string,
    explanation: string,
    tok: Token,
    construct: string,
    affected: SemanticRef[] = [],
    params: Record<string, string | number> = {},
  ): void {
    this.warnings.push(importWarning('sql.import', this.model.id, code, title, explanation, tok, construct, affected, params));
  }

  private identName(what = 'identifier'): { name: string; tok: Token } {
    const t = this.peek();
    if (t.type === 'ident' || t.type === 'qident') {
      this.pos++;
      return { name: t.value, tok: t };
    }
    return this.fail(`Expected ${what} but found ${this.describe(t)}`);
  }

  private qualifiedName(what: string): QualName {
    const first = this.identName(what);
    const parts = [first];
    while (this.atP('.')) {
      this.pos++;
      parts.push(this.identName(what));
    }
    if (parts.length > 2) this.fail(`Catalog-qualified names (${parts.length} parts) are not supported`, first.tok, 'catalog.schema.name');
    const last = parts[parts.length - 1]!;
    return parts.length === 2 ? { schema: parts[0]!.name, name: last.name, tok: first.tok } : { name: last.name, tok: first.tok };
  }

  /** Consumes a balanced `( ... )` group (current token is '('), returns the inner tokens. */
  private balanced(): Token[] {
    const open = this.expectP('(');
    const inner: Token[] = [];
    let depth = 1;
    for (;;) {
      const t = this.peek();
      if (t.type === 'eof') this.fail('Unbalanced parentheses: missing )', open);
      this.pos++;
      if (t.type === 'punct' && t.value === '(') depth++;
      if (t.type === 'punct' && t.value === ')' && --depth === 0) return inner;
      inner.push(t);
    }
  }
  private raw(tokens: Token[]): string {
    return tokens.length === 0 ? '' : this.text.slice(tokens[0]!.start, tokens[tokens.length - 1]!.end).trim();
  }

  // ----- top level ----------------------------------------------------------------------------------------------

  run(): void {
    while (this.peek().type !== 'eof') {
      if (this.acceptP(';')) continue;
      this.statement();
      if (this.peek().type !== 'eof' && !this.atP(';')) {
        this.fail(`Unexpected ${this.describe(this.peek())} after the end of the statement`);
      }
    }
    this.resolveForeignKeys();
  }

  private statement(): void {
    const t = this.peek();
    if (t.type !== 'ident') this.fail(`Unexpected ${this.describe(t)}: a statement must start with a keyword`);
    if (t.upper === 'DELIMITER') this.fail('DELIMITER is a client command, not SQL; remove it (and the custom delimiters) before importing', t, 'DELIMITER');
    if (t.upper === 'CREATE') return this.create();
    if (t.upper === 'ALTER') return this.alter();
    if (SKIPPABLE.has(t.upper)) return this.skipStatement(`${t.upper} statement`);
    this.fail(`Unsupported statement starting with ${this.describe(t)}`, t, t.upper);
  }

  /** Skip to the next top-level `;` and report it. */
  private skipStatement(construct: string, trigger = false): void {
    const first = this.peek();
    let depth = 0;
    let blockDepth = 0;
    for (;;) {
      const t = this.peek();
      if (t.type === 'eof') {
        if (blockDepth > 0) this.fail(`Unterminated ${construct}: BEGIN/CASE block is never closed by END`, first, construct);
        break;
      }
      if (t.type === 'punct' && t.value === '(') depth++;
      if (t.type === 'punct' && t.value === ')') depth--;
      if (trigger && t.type === 'ident') {
        if (t.upper === 'BEGIN' || t.upper === 'CASE') blockDepth++;
        if (t.upper === 'END') {
          // `END CASE` closes the CASE statement opened above; `END IF/LOOP/WHILE/REPEAT` closes constructs that were never
          // counted as blocks. Either way the second word belongs to the terminator and must not be re-read.
          const n = this.peek(1);
          if (this.isKw(n, 'CASE')) {
            blockDepth--;
            this.pos++;
          } else if (this.isKw(n, 'IF', 'LOOP', 'WHILE', 'REPEAT')) this.pos++;
          else blockDepth--;
        }
      }
      if (t.type === 'punct' && t.value === ';' && depth <= 0 && blockDepth <= 0) break;
      this.pos++;
    }
    this.warn('skipped-statement', `${construct} skipped`, `The ${construct} does not describe a table and was not imported.`, first, construct);
  }

  private create(): void {
    this.next();
    const mods = new Set<string>();
    const MODS = ['OR', 'REPLACE', 'TEMPORARY', 'TEMP', 'GLOBAL', 'LOCAL', 'UNLOGGED', 'UNIQUE', 'FULLTEXT', 'SPATIAL', 'MATERIALIZED', 'RECURSIVE', 'DEFINER'];
    while (this.peek().type === 'ident' && MODS.includes(this.peek().upper)) mods.add(this.next().upper);
    const kind = this.peek();
    if (this.isKw(kind, 'TABLE')) return this.createTable(mods);
    if (this.isKw(kind, 'INDEX')) return this.createIndex(mods);
    const what = kind.type === 'ident' ? kind.upper : this.describe(kind);
    this.skipStatement(`CREATE ${what}`, ['TRIGGER', 'PROCEDURE', 'FUNCTION', 'EVENT'].includes(what));
  }

  // ----- CREATE TABLE -------------------------------------------------------------------------------------------

  private createTable(mods: Set<string>): void {
    const tableTok = this.next();
    if (mods.has('TEMP') || mods.has('TEMPORARY') || mods.has('UNLOGGED')) {
      this.warn('temporary-table', 'Temporary/unlogged table imported as a normal table', 'TEMPORARY/UNLOGGED has no representation in the model.', tableTok, 'TEMPORARY');
    }
    let ifNotExists = false;
    if (this.atKw('IF') && this.isKw(this.peek(1), 'NOT') && this.isKw(this.peek(2), 'EXISTS')) {
      this.pos += 3;
      ifNotExists = true;
    }
    const name = this.qualifiedName('table name');
    if (this.atKw('AS')) this.fail('CREATE TABLE ... AS SELECT is not supported (the column list is not declared)', this.peek(), 'CREATE TABLE AS');
    if (this.atKw('LIKE')) this.fail('CREATE TABLE ... LIKE is not supported', this.peek(), 'CREATE TABLE LIKE');
    if (this.atKw('PARTITION')) this.fail('Partition tables (PARTITION OF) are not supported', this.peek(), 'PARTITION OF');
    this.expectP('(');

    if (this.find(name, false)) {
      if (ifNotExists) {
        this.warn('duplicate-table', 'Duplicate table skipped', `Table ${name.name} was already defined; the IF NOT EXISTS duplicate was ignored.`, name.tok, 'IF NOT EXISTS', [], { name: name.name });
        this.skipUntilSemicolon();
        return;
      }
      this.fail(`Table ${name.name} is defined twice`, name.tok);
    }
    const relation: Relation = { id: newId('rln'), name: name.name, columns: [], primaryKey: [], uniques: [], indexes: [] };
    if (name.schema) relation.schemaName = name.schema;
    this.relations.push(relation);
    this.model.relations[relation.id] = relation;

    const inlinePk: Array<{ col: RelColumn; name?: string; tok: Token }> = [];
    const constraints: Constraint[] = [];
    const checkTokens = new Map<CheckConstraint, Token[]>();
    for (;;) {
      if (this.atP(')')) this.fail('Expected a column or constraint definition', this.peek());
      const c = this.tableElement(relation, inlinePk, checkTokens);
      if (c) constraints.push(c);
      if (this.acceptP(',')) continue;
      break;
    }
    this.expectP(')');

    // Table-level constraints resolve against ALL columns (they may be listed before the columns they use).
    for (const c of constraints) this.applyConstraint(relation, c, checkTokens);
    if (inlinePk.length > 0) {
      if (relation.primaryKey.length > 0 || inlinePk.length > 1) {
        this.fail(`Table ${relation.name} declares several primary keys`, inlinePk[inlinePk.length - 1]!.tok, 'PRIMARY KEY');
      }
      const { col, name: pkName } = inlinePk[0]!;
      relation.primaryKey = [col.id];
      col.nullable = false;
      if (pkName) relation.primaryKeyName = pkName;
    }
    // The implicit UNIQUE of MySQL SERIAL is redundant once the column is the whole primary key.
    if (relation.primaryKey.length === 1) {
      relation.uniques = relation.uniques.filter((u) => !(this.serialUniques.has(u.id) && u.columnIds[0] === relation.primaryKey[0]));
    }
    for (const [check, toks] of checkTokens) this.fillCheckColumns(relation, check, toks);
    this.tableOptions(relation);
  }

  private find(name: QualName, required: boolean): Relation | undefined {
    const key = sqlNameKey(name.name);
    let cands = this.relations.filter((r) => sqlNameKey(r.name) === key);
    if (name.schema) cands = cands.filter((r) => r.schemaName !== undefined && sqlNameKey(r.schemaName) === sqlNameKey(name.schema!));
    if (cands.length > 1) {
      const unq = cands.filter((r) => !r.schemaName);
      if (unq.length === 1) return unq[0];
      this.fail(`Table name ${name.name} is ambiguous between schemas`, name.tok);
    }
    if (!cands[0] && required) this.fail(`Table ${name.schema ? `${name.schema}.` : ''}${name.name} is not defined`, name.tok);
    return cands[0];
  }

  private skipUntilSemicolon(): void {
    let depth = 1;
    while (this.peek().type !== 'eof') {
      if (this.atP('(')) depth++;
      if (this.atP(')')) depth--;
      if (this.atP(';') && depth <= 0) return;
      this.pos++;
    }
  }

  private tableElement(
    relation: Relation,
    inlinePk: Array<{ col: RelColumn; name?: string; tok: Token }>,
    checkTokens: Map<CheckConstraint, Token[]>,
  ): Constraint | undefined {
    const t = this.peek();
    const n1 = this.peek(1);
    const isNamedParen = (o: number): boolean => (this.peek(o).type === 'ident' || this.peek(o).type === 'qident') && this.atP('(', o + 1);
    if (this.isKw(t, 'CONSTRAINT')) return this.tableConstraint();
    if (this.isKw(t, 'PRIMARY') && this.isKw(n1, 'KEY')) return this.tableConstraint();
    if (this.isKw(t, 'FOREIGN') && this.isKw(n1, 'KEY')) return this.tableConstraint();
    if (this.isKw(t, 'CHECK') && n1.type === 'punct' && n1.value === '(') return this.tableConstraint();
    if (this.isKw(t, 'UNIQUE') && (this.atP('(', 1) || this.isKw(n1, 'KEY', 'INDEX') || isNamedParen(1))) return this.tableConstraint();
    if (this.isKw(t, 'KEY', 'INDEX') && (this.atP('(', 1) || isNamedParen(1))) return this.tableConstraint();
    // `fulltext varchar(200)` is a COLUMN: a name followed by `(` only starts an index when the parenthesis is not a type argument list.
    const typeArgs = (o: number): boolean => {
      let i = o + 1;
      while (this.peek(i).type === 'number' || (this.peek(i).type === 'punct' && this.peek(i).value === ',')) i++;
      return i > o + 1 && this.peek(i).type === 'punct' && this.peek(i).value === ')';
    };
    if (this.isKw(t, 'FULLTEXT', 'SPATIAL') && (this.isKw(n1, 'KEY', 'INDEX') || this.atP('(', 1) || (isNamedParen(1) && !typeArgs(2)))) {
      const start = this.next();
      while (!this.atP('(') && this.peek().type !== 'eof') this.pos++;
      this.balanced();
      this.warn('skipped-index', `${start.upper} index skipped`, `${start.upper} indexes are not representable and were not imported.`, start, start.upper, [{ kind: 'relation', id: relation.id }]);
      return undefined;
    }
    if (this.isKw(t, 'LIKE') || (this.isKw(t, 'EXCLUDE') && (this.isKw(n1, 'USING') || this.atP('(', 1)))) this.fail(`Table element ${t.upper} is not supported`, t, t.upper);
    this.columnDef(relation, inlinePk, checkTokens);
    return undefined;
  }

  // ----- columns ------------------------------------------------------------------------------------------------

  private columnDef(
    relation: Relation,
    inlinePk: Array<{ col: RelColumn; name?: string; tok: Token }>,
    checkTokens: Map<CheckConstraint, Token[]>,
  ): void {
    const { name, tok } = this.identName('column name');
    if (relation.columns.some((c) => sqlNameKey(c.name) === sqlNameKey(name))) {
      this.fail(`Duplicate column ${name} in table ${relation.name}`, tok);
    }
    const col: RelColumn = { id: newId('col'), name, nullable: true };
    const { text, serial } = this.dataType();
    const mysqlSerial = this.dialect === 'mysql' && serial && /^SERIAL$/i.test(this.text.slice(this.tokens[this.pos - 1]!.start, this.tokens[this.pos - 1]!.end));
    if (text) col.dataType = mysqlSerial ? 'BIGINT UNSIGNED' : text;
    if (serial) col.autoIncrement = true;
    relation.columns.push(col);
    if (mysqlSerial) {
      // MySQL: SERIAL = BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE
      const uq = { id: newId('uq'), columnIds: [col.id] };
      relation.uniques.push(uq);
      this.serialUniques.add(uq.id);
      this.warn('mysql-serial', 'SERIAL expanded', 'In MySQL SERIAL means BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE; the type and the UNIQUE constraint were imported explicitly.', tok, 'SERIAL', [{ kind: 'column', relationId: relation.id, id: col.id }]);
    }

    let constraintName: string | undefined;
    for (;;) {
      const t = this.peek();
      if (t.type !== 'ident') break;
      if (t.upper === 'CONSTRAINT') {
        this.pos++;
        constraintName = this.identName('constraint name').name;
        continue;
      }
      const cname = constraintName;
      constraintName = undefined;
      if (t.upper === 'NOT' && this.isKw(this.peek(1), 'DEFERRABLE')) {
        this.pos += 2;
        this.warn('deferrable', 'DEFERRABLE ignored', 'Constraint deferrability is not modelled.', t, 'NOT DEFERRABLE', [{ kind: 'column', relationId: relation.id, id: col.id }]);
      } else if (t.upper === 'NOT') {
        this.pos++;
        this.expectKw('NULL');
        col.nullable = false;
      } else if (t.upper === 'NULL') {
        this.pos++;
      } else if (t.upper === 'DEFAULT') {
        this.pos++;
        col.defaultValue = this.defaultExpr();
      } else if (t.upper === 'PRIMARY' || t.upper === 'KEY') {
        this.pos++;
        if (t.upper === 'PRIMARY') this.expectKw('KEY');
        this.acceptKw('ASC', 'DESC');
        if (this.acceptKw('AUTOINCREMENT')) col.autoIncrement = true;
        if (this.atKw('ON')) this.fail('ON CONFLICT clauses are not supported', this.peek(), 'ON CONFLICT');
        inlinePk.push({ col, ...(cname ? { name: cname } : {}), tok: t });
      } else if (t.upper === 'UNIQUE') {
        this.pos++;
        this.acceptKw('KEY');
        relation.uniques.push({ id: newId('uq'), ...(cname ? { name: cname } : {}), columnIds: [col.id] });
      } else if (t.upper === 'REFERENCES') {
        const ref = this.references();
        this.pending.push({ ...(cname ? { name: cname } : {}), source: relation, sourceColumnIds: [col.id], ref });
      } else if (t.upper === 'CHECK') {
        this.pos++;
        const toks = this.balanced();
        if (toks.length === 0) this.fail('Empty CHECK expression', t);
        const check: CheckConstraint = { id: newId('chk'), ...(cname ? { name: cname } : {}), expression: this.raw(toks) };
        (relation.checks ??= []).push(check);
        checkTokens.set(check, toks);
      } else if (t.upper === 'AUTO_INCREMENT' || t.upper === 'AUTOINCREMENT') {
        this.pos++;
        col.autoIncrement = true;
      } else if (t.upper === 'GENERATED') {
        this.pos++;
        if (this.acceptKw('ALWAYS')) {
          /* identity or computed: decided below */
        } else if (this.acceptKw('BY')) {
          this.expectKw('DEFAULT');
        }
        this.expectKw('AS');
        if (this.acceptKw('IDENTITY')) {
          col.autoIncrement = true;
          if (this.atP('(')) this.balanced(); // sequence options are not modelled
        } else this.fail('Generated (computed) columns are not supported', t, 'GENERATED ALWAYS AS (expr)');
      } else if (t.upper === 'AS') {
        this.fail('Generated (computed) columns are not supported', t, 'AS (expr)');
      } else if (t.upper === 'COLLATE') {
        this.pos++;
        const c = this.identName('collation');
        this.warn('collation', 'Collation ignored', `COLLATE ${c.name} on ${relation.name}.${name} is not modelled.`, t, 'COLLATE', [{ kind: 'column', relationId: relation.id, id: col.id }], { collation: c.name, relation: relation.name, columnName: name });
      } else if (t.upper === 'CHARSET' || (t.upper === 'CHARACTER' && this.isKw(this.peek(1), 'SET'))) {
        this.pos += t.upper === 'CHARSET' ? 1 : 2;
        this.acceptP('=');
        this.identName('character set');
        this.warn('charset', 'Character set ignored', `CHARACTER SET on ${relation.name}.${name} is not modelled.`, t, 'CHARACTER SET', [{ kind: 'column', relationId: relation.id, id: col.id }], { relation: relation.name, columnName: name });
      } else if (t.upper === 'COMMENT') {
        this.pos++;
        const s = this.peek();
        if (s.type !== 'string') this.fail('Expected a string after COMMENT', s);
        this.pos++;
        col.description = s.value;
      } else if (t.upper === 'ON' && this.isKw(this.peek(1), 'UPDATE')) {
        this.pos += 2;
        this.defaultExpr();
        this.warn('on-update', 'ON UPDATE ignored', `ON UPDATE of ${relation.name}.${name} is not modelled.`, t, 'ON UPDATE', [{ kind: 'column', relationId: relation.id, id: col.id }], { relation: relation.name, columnName: name });
      } else if (t.upper === 'DEFERRABLE' || t.upper === 'INITIALLY') {
        this.pos++;
        if (t.upper === 'INITIALLY') this.identName();
        this.warn('deferrable', 'DEFERRABLE ignored', 'Constraint deferrability is not modelled.', t, t.upper, [{ kind: 'column', relationId: relation.id, id: col.id }]);
      } else break;
    }
    if (col.autoIncrement) col.nullable = false;
    const after = this.peek();
    if (!(after.type === 'punct' && (after.value === ',' || after.value === ')'))) {
      this.fail(`Unsupported or unexpected column attribute ${this.describe(after)}`, after, this.text.slice(after.start, after.end));
    }
  }

  private dataType(): { text: string | undefined; serial: boolean } {
    const parts: string[] = [];
    let serial = false;
    for (;;) {
      const t = this.peek();
      if (t.type === 'qident' && parts.length === 0) {
        this.pos++;
        parts.push(`"${t.value.split('"').join('""')}"`);
        continue;
      }
      if (t.type === 'ident' && !COLUMN_STARTERS.has(t.upper)) {
        if (t.upper === 'CHARACTER' && this.isKw(this.peek(1), 'SET')) break; // attribute, not a type word
        // Only known continuation words extend a type; anything else must surface as an unknown column attribute
        // instead of being swallowed into the type text (`a INT WEIRDATTR`).
        const continuation = TYPE_CONTINUATION.has(t.upper) || (t.upper === 'CHARACTER' && parts[0] === 'NATIONAL');
        if (parts.length > 0 && !continuation) break;
        this.pos++;
        if (parts.length === 0 && SERIAL[t.upper]) {
          serial = true;
          parts.push(SERIAL[t.upper]!);
        } else parts.push(t.upper);
        continue;
      }
      if (t.type === 'punct' && t.value === '.' && parts.length > 0 && (this.peek(1).type === 'ident' || this.peek(1).type === 'qident')) {
        this.pos++;
        const n = this.next();
        parts[parts.length - 1] += `.${n.type === 'qident' ? `"${n.value}"` : n.value}`;
        continue;
      }
      if (t.type === 'punct' && t.value === '(' && parts.length > 0) {
        const inner = this.balanced();
        parts[parts.length - 1] += `(${this.splitArgs(inner).join(',')})`;
        continue;
      }
      if (t.type === 'punct' && t.value === '[' && parts.length > 0) {
        this.pos++;
        let dim = '';
        if (this.peek().type === 'number') dim = this.next().value;
        this.expectP(']');
        parts[parts.length - 1] += `[${dim}]`;
        continue;
      }
      break;
    }
    return { text: parts.length > 0 ? parts.join(' ') : undefined, serial };
  }

  private splitArgs(inner: Token[]): string[] {
    const out: string[] = [];
    let cur: string[] = [];
    for (const t of inner) {
      if (t.type === 'punct' && t.value === ',') {
        out.push(cur.join(''));
        cur = [];
      } else cur.push(t.type === 'string' ? `'${t.value.split("'").join("''")}'` : t.type === 'qident' ? `"${t.value}"` : this.text.slice(t.start, t.end));
    }
    out.push(cur.join(''));
    return out;
  }

  /** Raw default expression: stops at a top-level `,` `)` or the next column attribute keyword. */
  private defaultExpr(): string {
    const first = this.peek();
    if (first.type === 'eof') this.fail('Expected an expression');
    const toks: Token[] = [];
    const take = (): void => {
      toks.push(this.next());
    };
    if (first.type === 'punct' && first.value === '(') {
      const open = this.next();
      this.pos--;
      const inner = this.balanced();
      toks.push(open, ...inner, this.tokens[this.pos - 1]!);
    } else {
      if (first.type === 'punct' && (first.value === '-' || first.value === '+')) take();
      const v = this.peek();
      if (v.type === 'punct') this.fail(`Expected a default value but found ${this.describe(v)}`);
      take();
      if (v.type === 'ident' && this.atP('(')) {
        const open = this.peek();
        const inner = this.balanced();
        toks.push(open, ...inner, this.tokens[this.pos - 1]!);
      }
    }
    for (;;) {
      const t = this.peek();
      if (t.type === 'eof') break;
      if (t.type === 'punct' && (t.value === ',' || t.value === ')' || t.value === ';')) break;
      if (t.type === 'ident' && COLUMN_STARTERS.has(t.upper)) break;
      if (t.type === 'punct' && t.value === '(') {
        const open = this.peek();
        const inner = this.balanced();
        toks.push(open, ...inner, this.tokens[this.pos - 1]!);
        continue;
      }
      take();
    }
    return this.raw(toks);
  }

  // ----- references / constraints -------------------------------------------------------------------------------

  private references(): RefClause {
    this.expectKw('REFERENCES');
    const target = this.qualifiedName('referenced table');
    const ref: RefClause = { target };
    if (this.atP('(')) ref.columns = this.keyParts('referenced column list', false);
    for (;;) {
      const t = this.peek();
      if (this.isKw(t, 'MATCH')) {
        this.pos++;
        const m = this.identName('MATCH type');
        this.warn('fk-match', 'FOREIGN KEY MATCH clause ignored', `MATCH ${m.name} is not modelled (the default MATCH SIMPLE semantics apply).`, t, 'MATCH', [], { match: m.name });
      } else if (this.isKw(t, 'ON') && this.isKw(this.peek(1), 'DELETE', 'UPDATE')) {
        this.pos++;
        const which = this.next().upper;
        const a = this.referentialAction();
        if (which === 'DELETE') ref.onDelete = a;
        else ref.onUpdate = a;
      } else if (this.isKw(t, 'NOT') && this.isKw(this.peek(1), 'DEFERRABLE')) {
        this.pos += 2;
        this.warn('deferrable', 'DEFERRABLE ignored', 'Constraint deferrability is not modelled.', t, 'NOT DEFERRABLE');
      } else if (this.isKw(t, 'DEFERRABLE', 'INITIALLY')) {
        this.pos++;
        if (t.upper === 'INITIALLY') this.identName();
        this.warn('deferrable', 'DEFERRABLE ignored', 'Constraint deferrability is not modelled.', t, t.upper);
      } else break;
    }
    return ref;
  }

  private referentialAction(): ReferentialAction {
    const t = this.next();
    let key = t.upper;
    if (t.upper === 'NO') {
      this.expectKw('ACTION');
      key = 'NO ACTION';
    } else if (t.upper === 'SET') {
      const w = this.next();
      if (!this.isKw(w, 'NULL', 'DEFAULT')) this.fail(`Expected NULL or DEFAULT after SET but found ${this.describe(w)}`, w);
      key = `SET ${w.upper}`;
      if (this.atP('(')) this.fail('Column lists in SET NULL/SET DEFAULT are not supported', this.peek(), 'SET NULL (columns)');
    }
    const a = ACTIONS[key];
    if (!a) this.fail(`Unknown referential action ${this.describe(t)}`, t);
    return a;
  }

  /** `( part {, part} )`; ASC/DESC, prefix lengths and COLLATE/NULLS are parsed so the caller can accept or reject them. */
  private keyParts(what: string, allowDesc: boolean): KeyPart[] {
    this.expectP('(');
    const parts: KeyPart[] = [];
    for (;;) {
      const { name, tok } = this.identName(what);
      const part: KeyPart = { name, tok, desc: false };
      if (this.atP('(')) {
        if (this.peek(1).type === 'number' && this.atP(')', 2)) {
          this.pos++;
          part.prefix = Number(this.next().value);
          this.pos++;
        } else this.fail('Expression and functional key parts are not supported (use plain column names)', this.peek(), 'expression key part');
      }
      for (;;) {
        const t = this.peek();
        if (this.isKw(t, 'ASC')) this.pos++;
        else if (this.isKw(t, 'DESC')) {
          this.pos++;
          part.desc = true;
          if (!allowDesc) this.warn('key-order', 'Key column order ignored', 'DESC on a key column is not modelled for constraints.', t, 'DESC');
        } else if (this.isKw(t, 'COLLATE')) {
          this.pos++;
          this.identName('collation');
          this.warn('collation', 'Collation ignored', 'COLLATE on a key column is not modelled.', t, 'COLLATE', [], { variant: 'key' });
        } else if (this.isKw(t, 'NULLS')) {
          this.pos++;
          this.identName();
          this.warn('nulls-order', 'NULLS FIRST/LAST ignored', 'NULLS ordering of an index column is not modelled.', t, 'NULLS');
        } else break;
      }
      parts.push(part);
      if (this.acceptP(',')) continue;
      break;
    }
    this.expectP(')');
    return parts;
  }

  private tableConstraint(): Constraint {
    let name: string | undefined;
    if (this.acceptKw('CONSTRAINT')) {
      // MySQL allows CONSTRAINT without a symbol before the keyword.
      if (!this.atKw('PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK')) name = this.identName('constraint name').name;
    }
    const t = this.peek();
    if (this.isKw(t, 'PRIMARY')) {
      this.pos++;
      this.expectKw('KEY');
      const cols = this.keyParts('primary key column', false);
      this.indexTail(false);
      return { kind: 'pk', ...(name ? { name } : {}), cols, tok: t };
    }
    if (this.isKw(t, 'UNIQUE')) {
      this.pos++;
      this.acceptKw('KEY', 'INDEX');
      if (!name && !this.atP('(')) name = this.identName('index name').name;
      const cols = this.keyParts('unique column', false);
      this.indexTail(false);
      return { kind: 'unique', ...(name ? { name } : {}), cols, tok: t };
    }
    if (this.isKw(t, 'FOREIGN')) {
      this.pos++;
      this.expectKw('KEY');
      if (!this.atP('(')) {
        const idx = this.identName('index name').name; // MySQL: the index name doubles as constraint name when none given
        name ??= idx;
      }
      const cols = this.keyParts('foreign key column', false);
      const ref = this.references();
      return { kind: 'fk', ...(name ? { name } : {}), cols, ref, tok: t };
    }
    if (this.isKw(t, 'CHECK')) {
      this.pos++;
      const tokens = this.balanced();
      if (tokens.length === 0) this.fail('Empty CHECK expression', t);
      if (this.atKw('NOT') && this.isKw(this.peek(1), 'ENFORCED')) {
        this.pos += 2;
        this.warn('check-not-enforced', 'NOT ENFORCED ignored', 'The CHECK constraint is imported as enforced.', t, 'NOT ENFORCED');
      }
      return { kind: 'check', ...(name ? { name } : {}), text: this.raw(tokens), tokens, tok: t };
    }
    if (this.isKw(t, 'KEY', 'INDEX')) {
      this.pos++;
      let idxName: string | undefined;
      if (!this.atP('(')) idxName = this.identName('index name').name;
      const cols = this.keyParts('index column', true);
      const method = this.indexTail(true);
      return { kind: 'index', ...(idxName ? { name: idxName } : {}), cols, ...(method ? { method } : {}), tok: t };
    }
    return this.fail(`Unsupported table constraint ${this.describe(t)}`, t, this.text.slice(t.start, t.end));
  }

  /** MySQL `USING BTREE` / `COMMENT '...'` after a key list. Returns the method when `keep`. */
  private indexTail(keep: boolean): string | undefined {
    let method: string | undefined;
    for (;;) {
      const t = this.peek();
      if (this.isKw(t, 'USING')) {
        this.pos++;
        const m = this.identName('index method');
        if (keep) method = m.name.toLowerCase();
        else this.warn('index-method', 'Index method ignored', `USING ${m.name} on a constraint is not modelled.`, t, 'USING', [], { method: m.name });
      } else if (this.isKw(t, 'COMMENT') && this.peek(1).type === 'string') {
        this.pos += 2;
        this.warn('index-comment', 'Index comment ignored', 'COMMENT on an index is not modelled.', t, 'COMMENT');
      } else break;
    }
    return method;
  }

  private resolveCols(relation: Relation, parts: KeyPart[], what: string, allowPrefix: boolean): Id[] {
    const ids: Id[] = [];
    for (const p of parts) {
      const col = relation.columns.find((c) => sqlNameKey(c.name) === sqlNameKey(p.name));
      if (!col) this.fail(`Column ${p.name} of ${what} does not exist in table ${relation.name}`, p.tok);
      if (p.prefix !== undefined) {
        if (!allowPrefix) this.fail(`Key prefix lengths (${p.name}(${p.prefix})) are not supported in constraints`, p.tok, 'key prefix length');
        this.warn('index-prefix', 'Index prefix length ignored', `${p.name}(${p.prefix}) was imported as the full column.`, p.tok, 'prefix length', [{ kind: 'relation', id: relation.id }], { columnName: p.name, prefix: p.prefix });
      }
      if (ids.includes(col.id)) this.fail(`Column ${p.name} is listed twice in ${what}`, p.tok);
      ids.push(col.id);
    }
    return ids;
  }

  private applyConstraint(relation: Relation, c: Constraint, checkTokens: Map<CheckConstraint, Token[]>): void {
    switch (c.kind) {
      case 'pk': {
        if (relation.primaryKey.length > 0) this.fail(`Table ${relation.name} declares several primary keys`, c.tok, 'PRIMARY KEY');
        relation.primaryKey = this.resolveCols(relation, c.cols, 'PRIMARY KEY', false);
        for (const id of relation.primaryKey) relation.columns.find((x) => x.id === id)!.nullable = false;
        if (c.name) relation.primaryKeyName = c.name;
        return;
      }
      case 'unique':
        relation.uniques.push({ id: newId('uq'), ...(c.name ? { name: c.name } : {}), columnIds: this.resolveCols(relation, c.cols, 'UNIQUE', false) });
        return;
      case 'index': {
        const columnIds = this.resolveCols(relation, c.cols, 'INDEX', true);
        const desc = c.cols.filter((p) => p.desc).map((p) => relation.columns.find((x) => sqlNameKey(x.name) === sqlNameKey(p.name))!.id);
        relation.indexes.push({
          id: newId('idx'),
          name: c.name ?? this.autoIndexName(relation, columnIds, false),
          columnIds,
          unique: false,
          ...(c.method ? { method: c.method } : {}),
          ...(c.where ? { where: c.where } : {}),
          ...(desc.length > 0 ? { descendingColumnIds: desc } : {}),
        });
        return;
      }
      case 'fk':
        this.pending.push({ ...(c.name ? { name: c.name } : {}), source: relation, sourceColumnIds: this.resolveCols(relation, c.cols, 'FOREIGN KEY', false), ref: c.ref });
        return;
      case 'check': {
        const check: CheckConstraint = { id: newId('chk'), ...(c.name ? { name: c.name } : {}), expression: c.text };
        (relation.checks ??= []).push(check);
        checkTokens.set(check, c.tokens);
      }
    }
  }

  private fillCheckColumns(relation: Relation, check: CheckConstraint, toks: Token[]): void {
    const ids: Id[] = [];
    for (const t of toks) {
      if (t.type !== 'ident' && t.type !== 'qident') continue;
      const col = relation.columns.find((c) => sqlNameKey(c.name) === sqlNameKey(t.value));
      if (col && !ids.includes(col.id)) ids.push(col.id);
    }
    if (ids.length > 0) check.columnIds = ids;
  }

  private autoIndexName(relation: Relation, columnIds: Id[], unique: boolean): string {
    return `${unique ? 'uq' : 'idx'}_${relation.name}_${columnIds.map((id) => relation.columns.find((c) => c.id === id)!.name).join('_')}`;
  }

  /** Everything after the closing `)` of CREATE TABLE up to `;`. Only known table options are accepted. */
  private tableOptions(relation: Relation): void {
    const skipped: Token[] = [];
    let first: Token | undefined;
    while (this.peek().type !== 'eof' && !this.atP(';')) {
      const t = this.peek();
      if (this.isKw(t, 'INHERITS', 'PARTITION', 'AS', 'LIKE')) this.fail(`Table clause ${t.upper} changes the table structure and is not supported`, t, t.upper);
      if (t.type === 'ident' && STATEMENT_START.has(t.upper)) this.fail(`Missing ';' before ${t.upper}: the previous CREATE TABLE is not terminated`, t, t.upper);
      if (this.isKw(t, 'COMMENT')) {
        this.pos++;
        this.acceptP('=');
        const s = this.peek();
        if (s.type === 'string') {
          this.pos++;
          relation.description = s.value;
          continue;
        }
      }
      first ??= t;
      if (this.atP('(')) {
        this.balanced();
        continue;
      }
      if (t.type === 'ident' && !TABLE_OPTION_WORDS.has(t.upper) && !(this.peek(1).type === 'punct' && this.peek(1).value === '=')) {
        const prev = skipped[skipped.length - 1];
        const afterEq = prev && prev.type === 'punct' && prev.value === '=';
        const afterValueWord = prev && prev.type === 'ident' && TABLE_OPTION_VALUE_TAKERS.has(prev.upper);
        if (!afterEq && !afterValueWord) this.fail(`Unsupported table option ${this.describe(t)}`, t, t.upper);
      }
      skipped.push(this.next());
    }
    if (first) {
      this.warn('table-options', 'Table options skipped', `Table options after the column list were not imported: ${this.raw(skipped).slice(0, 80)}`, first, 'table options', [{ kind: 'relation', id: relation.id }], { options: this.raw(skipped).slice(0, 80) });
    }
  }

  // ----- ALTER TABLE / CREATE INDEX -----------------------------------------------------------------------------

  private alter(): void {
    this.next();
    if (!this.atKw('TABLE')) return this.skipStatement(`ALTER ${this.peek().upper || ''}`.trim());
    this.pos++;
    if (this.atKw('IF') && this.isKw(this.peek(1), 'EXISTS')) this.pos += 2;
    this.acceptKw('ONLY');
    const name = this.qualifiedName('table name');
    const relation = this.find(name, true)!;
    const checkTokens = new Map<CheckConstraint, Token[]>();
    for (;;) {
      const t = this.peek();
      if (this.isKw(t, 'ADD')) {
        this.pos++;
        if (this.atKw('COLUMN') || !this.startsConstraint()) {
          this.fail('ALTER TABLE ... ADD COLUMN is not supported; declare the column in CREATE TABLE', t, 'ADD COLUMN');
        }
        const c = this.tableConstraint();
        this.applyConstraint(relation, c, checkTokens);
        for (const [check, toks] of checkTokens) this.fillCheckColumns(relation, check, toks);
      } else if (this.isKw(t, 'ALTER')) {
        this.pos++;
        this.acceptKw('COLUMN');
        const { name: colName, tok: colTok } = this.identName('column name');
        const col = relation.columns.find((c) => sqlNameKey(c.name) === sqlNameKey(colName));
        if (!col) this.fail(`Column ${colName} does not exist in table ${relation.name}`, colTok);
        const act = this.peek();
        if (this.isKw(act, 'SET') && this.isKw(this.peek(1), 'DEFAULT')) {
          this.pos += 2;
          col.defaultValue = this.alterExpr();
        } else if (this.isKw(act, 'SET') && this.isKw(this.peek(1), 'NOT') && this.isKw(this.peek(2), 'NULL')) {
          this.pos += 3;
          col.nullable = false;
        } else if (this.isKw(act, 'DROP') && this.isKw(this.peek(1), 'NOT') && this.isKw(this.peek(2), 'NULL')) {
          this.pos += 3;
          col.nullable = true;
        } else if (this.isKw(act, 'ADD') && this.isKw(this.peek(1), 'GENERATED')) {
          this.pos += 2;
          if (!this.acceptKw('ALWAYS')) {
            this.expectKw('BY');
            this.expectKw('DEFAULT');
          }
          this.expectKw('AS');
          this.expectKw('IDENTITY');
          if (this.atP('(')) this.balanced();
          col.autoIncrement = true;
          col.nullable = false;
        } else {
          this.fail(`Unsupported ALTER COLUMN action ${this.describe(act)}`, act, this.text.slice(act.start, act.end));
        }
      } else if (this.isKw(t, 'OWNER') && this.isKw(this.peek(1), 'TO')) {
        this.pos += 2;
        this.identName('owner');
        this.warn('owner', 'OWNER TO ignored', 'Table ownership is not modelled.', t, 'OWNER TO', [{ kind: 'relation', id: relation.id }]);
      } else if (this.isKw(t, 'ENABLE', 'DISABLE', 'FORCE', 'NO') && this.isKw(this.peek(1), 'ROW', 'FORCE', 'TRIGGER')) {
        while (!this.atP(',') && !this.atP(';') && this.peek().type !== 'eof') this.pos++;
        this.warn('alter-ignored', 'ALTER TABLE option ignored', `${t.upper} ... is not modelled.`, t, t.upper, [{ kind: 'relation', id: relation.id }]);
      } else {
        this.fail(`Unsupported ALTER TABLE action ${this.describe(t)}`, t, this.text.slice(t.start, t.end));
      }
      if (this.acceptP(',')) continue;
      break;
    }
  }

  /** Expression of `ALTER COLUMN ... SET DEFAULT`: runs to the next top-level `,` or `;`. */
  private alterExpr(): string {
    const toks: Token[] = [];
    while (this.peek().type !== 'eof' && !this.atP(',') && !this.atP(';')) {
      if (this.atP('(')) {
        const open = this.peek();
        const inner = this.balanced();
        toks.push(open, ...inner, this.tokens[this.pos - 1]!);
      } else toks.push(this.next());
    }
    if (toks.length === 0) this.fail('Expected an expression');
    return this.raw(toks);
  }

  private startsConstraint(): boolean {
    return this.atKw('CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'INDEX', 'KEY');
  }

  private createIndex(mods: Set<string>): void {
    this.next(); // INDEX
    if (mods.has('FULLTEXT') || mods.has('SPATIAL')) {
      this.pos--;
      return this.skipStatement(`CREATE ${[...mods].find((m) => m === 'FULLTEXT' || m === 'SPATIAL')} INDEX`);
    }
    this.acceptKw('CONCURRENTLY');
    if (this.atKw('IF') && this.isKw(this.peek(1), 'NOT') && this.isKw(this.peek(2), 'EXISTS')) this.pos += 3;
    let name: QualName | undefined;
    if (!this.atKw('ON')) name = this.qualifiedName('index name');
    this.expectKw('ON');
    this.acceptKw('ONLY');
    const tableName = this.qualifiedName('table name');
    const relation = this.find(tableName, true)!;
    let method: string | undefined;
    if (this.acceptKw('USING')) method = this.identName('index method').name.toLowerCase();
    const parts = this.keyParts('index column', true);
    let where: string | undefined;
    for (;;) {
      const t = this.peek();
      if (this.isKw(t, 'USING')) {
        this.pos++;
        method = this.identName('index method').name.toLowerCase();
      } else if (this.isKw(t, 'WHERE')) {
        this.pos++;
        const toks: Token[] = [];
        let wd = 0;
        while (this.peek().type !== 'eof' && !this.atP(';')) {
          const w = this.peek();
          if (this.atP('(')) wd++;
          if (this.atP(')')) wd--;
          if (wd <= 0 && w.type === 'ident' && STATEMENT_START.has(w.upper)) this.fail(`Missing ';' before ${w.upper}: the CREATE INDEX is not terminated`, w, w.upper);
          toks.push(this.next());
        }
        if (toks.length === 0) this.fail('Expected a predicate after WHERE', t);
        where = this.raw(toks);
      } else if (this.isKw(t, 'INCLUDE')) {
        this.fail('INCLUDE columns are not supported', t, 'INCLUDE');
      } else if (this.isKw(t, 'WITH', 'TABLESPACE', 'ALGORITHM', 'LOCK', 'COMMENT', 'VISIBLE', 'INVISIBLE', 'NULLS')) {
        const first = t;
        while (this.peek().type !== 'eof' && !this.atP(';')) {
          const w = this.peek();
          if (w.type === 'ident' && STATEMENT_START.has(w.upper) && w !== t) this.fail(`Missing ';' before ${w.upper}: the CREATE INDEX is not terminated`, w, w.upper);
          this.pos++;
        }
        this.warn('index-options', 'Index options skipped', `Index options starting at ${t.upper} were not imported.`, first, t.upper, [{ kind: 'relation', id: relation.id }]);
      } else break;
    }
    const columnIds = this.resolveCols(relation, parts, 'INDEX', true);
    const unique = mods.has('UNIQUE');
    const desc = parts.filter((p) => p.desc).map((p) => relation.columns.find((x) => sqlNameKey(x.name) === sqlNameKey(p.name))!.id);
    relation.indexes.push({
      id: newId('idx'),
      name: name?.name ?? this.autoIndexName(relation, columnIds, unique),
      columnIds,
      unique,
      ...(where ? { where } : {}),
      ...(method ? { method } : {}),
      ...(desc.length > 0 ? { descendingColumnIds: desc } : {}),
    });
  }

  // ----- pass 2 -------------------------------------------------------------------------------------------------

  private resolveForeignKeys(): void {
    for (const p of this.pending) {
      const target = this.find(p.ref.target, false);
      if (!target) {
        this.fail(
          `Foreign key on ${p.source.name} references table ${p.ref.target.schema ? `${p.ref.target.schema}.` : ''}${p.ref.target.name}, which is not defined in this script`,
          p.ref.target.tok,
          'REFERENCES',
        );
      }
      let targetIds: Id[];
      if (p.ref.columns) {
        targetIds = p.ref.columns.map((part) => {
          const col = target.columns.find((c) => sqlNameKey(c.name) === sqlNameKey(part.name));
          if (!col) this.fail(`Foreign key on ${p.source.name} references column ${target.name}.${part.name}, which does not exist`, part.tok, 'REFERENCES');
          return col.id;
        });
      } else {
        if (target.primaryKey.length === 0) {
          this.fail(`Foreign key on ${p.source.name} omits the referenced columns but ${target.name} has no primary key`, p.ref.target.tok, 'REFERENCES');
        }
        targetIds = target.primaryKey;
      }
      if (targetIds.length !== p.sourceColumnIds.length) {
        this.fail(
          `Foreign key on ${p.source.name} lists ${p.sourceColumnIds.length} column(s) but references ${targetIds.length} column(s) of ${target.name}`,
          p.ref.target.tok,
          'REFERENCES',
        );
      }
      const fk: ForeignKey = {
        id: newId('fk'),
        ...(p.name ? { name: p.name } : {}),
        sourceRelationId: p.source.id,
        targetRelationId: target.id,
        columns: p.sourceColumnIds.map((s, i) => ({ sourceColumnId: s, targetColumnId: targetIds[i]! })),
        ...(p.ref.onDelete ? { onDelete: p.ref.onDelete } : {}),
        ...(p.ref.onUpdate ? { onUpdate: p.ref.onUpdate } : {}),
      };
      this.model.foreignKeys[fk.id] = fk;
      if (fkTargetKey(target, fk).kind === 'none') {
        this.warn(
          'fk-target-not-key',
          'Foreign key does not reference a key',
          `The columns of ${target.name} referenced from ${p.source.name} are neither its primary key nor a UNIQUE constraint; most engines reject this.`,
          p.ref.target.tok,
          'REFERENCES',
          [{ kind: 'foreignKey', id: fk.id }],
          { target: target.name, source: p.source.name },
        );
      }
    }
  }

  detectDialect(): SqlDialect {
    if (this.dialect !== 'auto') return this.dialect;
    if (this.sawDialect.mysql) return 'mysql';
    if (this.sawDialect.sqlite) return 'sqlite';
    if (this.sawDialect.postgresql) return 'postgresql';
    return 'generic';
  }
}

// ----- public API -------------------------------------------------------------------------------------------------

/**
 * Parse a DDL script into a RelationalModel. THROWS `SqlParseError` (with line/column) for unsupported or invalid
 * syntax; everything it skips on purpose is reported in `warnings`. Imported ids come from `newId`.
 */
export function parseDdl(text: string, dialect: SqlDialect | 'auto' = 'auto', opts: ImportOptions = {}): ImportResult {
  const auto = dialect === 'auto';
  const { tokens, notes } = lex(text, {
    backtick: auto || dialect === 'mysql' || dialect === 'sqlite' || dialect === 'generic',
    bracket: auto || dialect === 'sqlite' || dialect === 'generic',
    hashComment: auto || dialect === 'mysql',
    backslashEscapes: dialect === 'mysql' || (auto && text.includes('`')),
  });
  const parser = new DdlParser(text, dialect, opts, tokens);
  parser.run();
  for (const n of notes) {
    parser.warnings.push(importWarning('sql.import', parser.model.id, 'skipped-comment', 'Conditional comment ignored', n.message, { line: n.line, col: n.col }, n.construct));
  }
  parser.model.dialect = parser.detectDialect();
  return { model: parser.model, warnings: parser.warnings };
}

/** Non-throwing variant for UI code: `{ ok: false, error }` instead of an exception. */
export function parseDdlSafe(
  text: string,
  dialect: SqlDialect | 'auto' = 'auto',
  opts: ImportOptions = {},
): ({ ok: true } & ImportResult) | { ok: false; error: SqlParseError } {
  try {
    return { ok: true, ...parseDdl(text, dialect, opts) };
  } catch (e) {
    if (e instanceof SqlParseError) return { ok: false, error: e };
    throw e;
  }
}
