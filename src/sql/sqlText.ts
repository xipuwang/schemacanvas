/**
 * Allow-list guard for free text that DDL generation copies into a statement verbatim (a column's data type, DEFAULT, a CHECK
 * expression, an index WHERE predicate) and that DBML export copies into an expression. It does NOT reuse the importer's
 * lexer: the text is accepted only when it consists entirely of the tokens below, and the NORMALISED text (every run of
 * whitespace collapsed to one space, ends trimmed) is what callers must emit. Refused text is never emitted.
 *
 *  - whitespace (space, tab, CR, LF) between tokens;
 *  - identifiers `[\p{L}_][\p{L}\p{N}_]*`, numbers `\d+(\.\d+)?([eE][+-]?\d+)?` and `.\d+`;
 *  - single-quoted literals with `''` doubling and no control character / line break / U+2028 / U+2029 inside. MySQL: no
 *    backslash inside (it is an escape there). PostgreSQL: a backslash is ordinary (standard_conforming_strings) but an
 *    identifier glued to a quote (E'..', U&'..', B'..', X'..') is refused. SQLite / generic: a backslash is ordinary.
 *    `;` is refused everywhere, also inside literals and quoted identifiers (defence in depth; all servers and their CLIs
 *    track standard quotes, so `#`, `--`, `/*`, `$` inside a closed literal are harmless and allowed);
 *  - "double-quoted" identifiers (PostgreSQL, SQLite, generic; refused on MySQL where they are strings) and `backtick`
 *    identifiers (MySQL, SQLite), each with doubling;
 *  - operators `( ) , . + - * / % = < > <= >= <> != ||`; `::` and the regex matches `~ ~* !~ !~*` (PostgreSQL only); the adjacent pairs `--`, `/*` and `*` + `/`
 *    are refused;
 *  - nothing else: `$`, `[` `]` (except a trailing `[]` of a type), `#`, `@`, braces, `;`, backslash outside
 *    literals, a lone `:`, control characters, unterminated quotes. Parentheses must balance.
 * Kind 'type' additionally requires: identifier words, at most ONE parenthesised list of numbers / literals, more words,
 * optionally `[]` (accepted on every dialect because a project's types are dialect-neutral and are mapped afterwards, e.g. TEXT[] -> JSON on MySQL).
 * Dialect 'dbml' is the strictest ('generic' without backticks, double-quoted identifiers and backslashes).
 */
import type { SqlDialect } from '@/model/types';

export type ScanDialect = SqlDialect | 'dbml';
export type SqlTextKind = 'type' | 'default' | 'check' | 'where';
export type UnsafeSqlReason = 'chars' | 'statement' | 'comment' | 'parens' | 'quote' | 'shape';
export type SqlTextScan = { ok: true; text: string; /** the whole text is one parenthesised group `( ... )` (token-aware) */ outer: boolean; /** one literal / word / signed number / `word()` / `word(literal)`: safe after DEFAULT unwrapped */ atom: boolean } | { ok: false; reason: UnsafeSqlReason };

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const IDENT = /[\p{L}_][\p{L}\p{N}\p{M}_]*/uy;
/** PostgreSQL and MySQL allow `$` inside (not at the start of) an unquoted identifier. */
const IDENT_DOLLAR = /[\p{L}_][\p{L}\p{N}\p{M}_$]*/uy;
const HEX = /0[xX][0-9A-Fa-f]+/y;
const NUMBER = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT_START = /[\p{L}_]/u;
/** Infix word operators: the next token is an operand. */
const INFIX: ReadonlySet<string> = new Set(['AND', 'OR', 'XOR', 'IN', 'IS', 'NOT', 'BETWEEN', 'LIKE', 'ILIKE', 'GLOB', 'REGEXP', 'RLIKE', 'SIMILAR', 'ESCAPE', 'THEN', 'ELSE', 'WHEN', 'DIV', 'MOD']);
/** Infix words that are only legal inside parentheses (cast(x AS t), substring(x FROM 1 FOR 2)). */
const INSIDE: ReadonlySet<string> = new Set(['AS', 'FROM', 'FOR']);
/** The only functions whose argument list may contain each INSIDE word (everything else would read as a subquery / clause). */
const INSIDE_IN: Readonly<Record<string, ReadonlySet<string>>> = {
  AS: new Set(['CAST', 'TRY_CAST']),
  FROM: new Set(['EXTRACT', 'SUBSTRING', 'SUBSTR', 'TRIM', 'OVERLAY']),
  FOR: new Set(['SUBSTRING', 'SUBSTR', 'OVERLAY']),
};
/** Words that end an operand (postfix operators / CASE terminator): the expression stays complete. */
const POSTFIX: ReadonlySet<string> = new Set(['END', 'ISNULL', 'ASC', 'DESC']);
/** Words that start an operand and are not themselves a value. */
const PREFIX: ReadonlySet<string> = new Set(['CASE', 'DISTINCT', 'INTERVAL', 'BOTH', 'LEADING', 'TRAILING', 'EXISTS', 'ARRAY', 'ALL', 'ANY', 'SOME']);
/** `x NOT <word>`: the only words that may follow a NOT that follows a value. */
const NOT_NEXT: ReadonlySet<string> = new Set(['IN', 'LIKE', 'ILIKE', 'BETWEEN', 'GLOB', 'REGEXP', 'RLIKE', 'SIMILAR']);
const UNITS: ReadonlySet<string> = new Set(['YEAR', 'MONTH', 'WEEK', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'MICROSECOND', 'QUARTER', 'YEARS', 'MONTHS', 'WEEKS', 'DAYS', 'HOURS', 'MINUTES', 'SECONDS']);
/** Words that may follow the first word of a data type (DOUBLE PRECISION, CHARACTER VARYING, WITH TIME ZONE, INT UNSIGNED ...). */
const TYPE_CONT: ReadonlySet<string> = new Set([
  'PRECISION', 'VARYING', 'UNSIGNED', 'SIGNED', 'ZEROFILL', 'WITH', 'WITHOUT', 'TIME', 'ZONE', 'CHARACTER', 'CHAR', 'BIG', 'INT', 'INTEGER', 'NATIVE', 'VARCHAR', 'NATIONAL', 'LONG', 'RAW', 'BINARY',
  'VARBINARY', 'BYTE', 'LOCAL', 'LARGE', 'OBJECT', 'TEXT', 'BLOB', 'DOUBLE', 'FLOAT', 'REAL', 'NCHAR', 'NVARCHAR', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'TO',
]);
/** Reserved words that start a column constraint or clause; none can be the name of a data type. */
const NOT_A_TYPE: ReadonlySet<string> = new Set([
  'NULL', 'NOT', 'UNIQUE', 'PRIMARY', 'KEY', 'REFERENCES', 'CHECK', 'CONSTRAINT', 'DEFAULT', 'COLLATE', 'GENERATED', 'AS', 'AUTOINCREMENT', 'AUTO_INCREMENT', 'IDENTITY', 'ON', 'COMMENT', 'VISIBLE',
  'INVISIBLE', 'STORED', 'VIRTUAL', 'MATCH', 'DEFERRABLE', 'INITIALLY', 'FOREIGN', 'AND', 'OR', 'ASC', 'DESC', 'CHARACTER_SET', 'ENCODE', 'COLUMN_FORMAT', 'STORAGE', 'ENGINE_ATTRIBUTE',
]);
/** Words that start a statement or a subquery; no DEFAULT / CHECK / WHERE expression needs them. */
const STATEMENT: ReadonlySet<string> = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'VALUES', 'UNION', 'EXCEPT', 'INTERSECT', 'REPLACE', 'MERGE', 'CALL', 'EXEC', 'EXECUTE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE']);
const TWO = ['<=', '>=', '<>', '!=', '||'];
const ONE = '(),.+-*/%=<>&|^';

/** True when the text holds a control character or line break (names and comments use this). */
export const hasControlChars = (text: string): boolean => CONTROL.test(text);

type Tok = { t: 'word' | 'num' | 'str' | 'qid' | 'op' | 'brk'; v: string; start: number; end: number };

const fail = (reason: UnsafeSqlReason): SqlTextScan => ({ ok: false, reason });

export function scanSqlText(text: string, dialect: ScanDialect, kind: SqlTextKind): SqlTextScan {
  const pg = dialect === 'postgresql';
  const mysql = dialect === 'mysql';
  const dbml = dialect === 'dbml';
  const toks: Tok[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      // U&'..' is a PostgreSQL literal with its own escapes
      if (pg && text[i - 1] === '&') return fail('quote');
      if (ch === '"' && (mysql || dbml)) return fail('quote');
      if (ch === '`' && !(mysql || dialect === 'sqlite')) return fail('quote');
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = text[j]!;
        if (c === ch) {
          if (text[j + 1] === ch) {
            // DBML has no '' doubling: ''' opens a multi-line string there, so a consumer would read a different text
            if (dbml && ch === "'") return fail('quote');
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        if (CONTROL.test(c)) return fail('chars');
        if (c === ';') return fail('statement');
        // a backslash is an escape on MySQL, so no literal that may reach MySQL (mysql, generic = portable, dbml) may hold one
        if (c === '\\' && ch === "'" && (mysql || dbml || dialect === 'generic')) return fail('chars');
        // the portable script may run on MySQL, where a backslash is an escape inside "..." strings as well
        if (c === '\\' && (dbml || dialect === 'generic')) return fail('chars');
        if (c === '`' && dbml) return fail('chars');
        j++;
      }
      if (!closed) return fail('quote');
      toks.push({ t: ch === "'" ? 'str' : 'qid', v: text.slice(i, j + 1), start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    const idRe = pg || mysql ? IDENT_DOLLAR : IDENT;
    idRe.lastIndex = i;
    const w = idRe.exec(text);
    if (w && w.index === i) {
      const e = i + w[0].length;
      // E'..', U&'..', B'..', X'..' prefixed literals have their own escape rules on PostgreSQL
      if (pg && (text[e] === "'" || text[e] === '"')) return fail('quote');
      toks.push({ t: 'word', v: w[0], start: i, end: e });
      i = e;
      continue;
    }
    let m: RegExpExecArray | null = null;
    if (mysql || dialect === 'sqlite') {
      HEX.lastIndex = i;
      m = HEX.exec(text);
    }
    if (!m || m.index !== i) {
      NUMBER.lastIndex = i;
      m = NUMBER.exec(text);
    }
    if (m && m.index === i) {
      const e = i + m[0].length;
      if (e < n && IDENT_START.test(text[e]!)) return fail('chars');
      toks.push({ t: 'num', v: m[0], start: i, end: e });
      i = e;
      continue;
    }
    if (pg) {
      const pgOp = /^(?:->>|->|@>|<@|&&)/.exec(text.slice(i, i + 3));
      if (pgOp) {
        toks.push({ t: 'op', v: pgOp[0], start: i, end: i + pgOp[0].length });
        i += pgOp[0].length;
        continue;
      }
      const re = /^(?:!~\*|!~|~\*|~)/.exec(text.slice(i, i + 3));
      if (re) {
        toks.push({ t: 'op', v: re[0], start: i, end: i + re[0].length });
        i += re[0].length;
        continue;
      }
    }
    const two = text.slice(i, i + 2);
    if (TWO.includes(two) || (pg && two === '::')) {
      toks.push({ t: 'op', v: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ONE.includes(ch) && !(ch === '^' && dialect !== 'postgresql' && !mysql) && !(dbml && '&|^'.includes(ch))) {
      toks.push({ t: 'op', v: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '[' && (kind === 'type' || pg) && text[i + 1] === ']') {
      toks.push({ t: 'brk', v: '[]', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    return fail(ch === ';' ? 'statement' : 'chars');
  }

  // Grammar pass. The text must read as ONE expression: operands joined by operators; a word may follow a value only when it
  // is an operator keyword (AND, IN, IS ...), so no column / table constraint keyword (REFERENCES, UNIQUE, NULL, PRIMARY
  // KEY ...) can ride along; no comma outside parentheses; it must end on a complete operand because the statement's own
  // clauses follow it. `[` exists only as the pair `[]` (array type suffix).
  const stack: string[] = [];
  let val = false; // the previous token completed an operand
  let cast = false; // inside a `::type` suffix
  let interval = false; // the previous value is the operand of INTERVAL
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!;
    const prev = toks[k - 1];
    const nx = toks[k + 1];
    if (tk.t === 'op') {
      if (nx && nx.t === 'op' && nx.start === tk.end) {
        const pair = tk.v + nx.v;
        if (pair === '--' || pair === '/*' || pair === '*/') return fail('comment');
      }
      if (tk.v === '(') {
        stack.push(prev?.t === 'word' ? prev.v.toUpperCase() : '');
        if (kind === 'type') continue;
        if (val && prev?.t !== 'word' && prev?.t !== 'qid') return fail('shape');
        val = false;
        continue;
      }
      if (tk.v === ')') {
        if (stack.pop() === undefined) return fail('parens');
        if (kind === 'type') continue;
        if (!val && !(prev?.t === 'op' && prev.v === '(')) return fail('shape');
        val = true;
        interval = false;
        continue;
      }
      if (tk.v === ',') {
        // a comma outside parentheses would end the column / constraint the text is embedded in
        if (stack.length === 0 || (kind !== 'type' && !val)) return fail('shape');
        val = false;
        cast = false;
        continue;
      }
      if (kind === 'type') continue;
      if (tk.v === '.') {
        // member access only after a name or `)`: every engine reads `1.` as a numeric literal, so `1.UNIQUE` would put a keyword there
        if (!val || !(prev?.t === 'word' || prev?.t === 'qid' || (prev?.t === 'op' && prev.v === ')'))) return fail('shape');
        val = false;
        continue;
      }
      if (tk.v === '::') {
        if (!val) return fail('shape');
        val = false;
        cast = true;
        continue;
      }
      if (tk.v === '*' && prev?.t === 'op' && (prev.v === '(' || prev.v === '.')) {
        val = true; // count(*), t.*
        continue;
      }
      // + - ~ are also unary; everything else is a binary operator and needs a left operand
      if (!val && !(tk.v === '+' || tk.v === '-' || tk.v === '~')) return fail('shape');
      val = false;
      cast = false;
      continue;
    }
    if (tk.t === 'brk') {
      if (kind !== 'type' && !(cast && val)) return fail('shape'); // `[]` only as the array suffix of a PostgreSQL cast type
      continue;
    }
    if (kind === 'type') continue;
    if (tk.t === 'word') {
      const up = tk.v.toUpperCase();
      // one simple expression, never a statement or subquery
      // REPLACE(...) is also the string function (REPLACE INTO needs INTO, which is never an operand); `;` and line breaks are refused anyway
      if (STATEMENT.has(up) && !(up === 'REPLACE' && nx?.t === 'op' && nx.v === '(')) return fail('statement');
      if (INSIDE.has(up) && !INSIDE_IN[up]!.has(stack[stack.length - 1] ?? '')) return fail('shape');
      if (!val) {
        interval = false;
        val = !(INFIX.has(up) || INSIDE.has(up) || PREFIX.has(up));
        if (up === 'NOT' && nx?.t === 'word' && nx.v.toUpperCase() === 'NULL' && !(prev?.t === 'word' && prev.v.toUpperCase() === 'IS')) return fail('shape');
        continue;
      }
      if (POSTFIX.has(up)) continue;
      if (cast && TYPE_CONT.has(up)) continue;
      if (interval && UNITS.has(up)) {
        interval = false;
        continue;
      }
      if (INFIX.has(up) || INSIDE.has(up)) {
        // `x NOT <word>` may only start NOT IN / NOT LIKE / NOT BETWEEN ..., never `NOT NULL`
        if (up === 'NOT' && !(nx?.t === 'word' && NOT_NEXT.has(nx.v.toUpperCase()))) return fail('shape');
        val = false;
        cast = false;
        continue;
      }
      return fail('shape');
    }
    // num, str, qid
    if (val && !(tk.t === 'str' && prev?.t === 'word')) return fail('shape');
    interval = prev?.t === 'word' && prev.v.toUpperCase() === 'INTERVAL';
    val = true;
  }
  if (stack.length !== 0) return fail('parens');
  if (toks.length === 0) return fail('shape');
  if (kind !== 'type' && !val) return fail('shape');
  if (kind === 'type' && !typeShape(toks)) return fail('shape');

  // normalised text: tokens joined where the source had whitespace, glued where it did not
  let out = '';
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!;
    if (k > 0 && tk.start !== toks[k - 1]!.end) out += ' ';
    out += tk.v;
  }
  const outer = toks[0]!.v === '(' && toks[toks.length - 1]!.v === ')' && closesAtEnd(toks);
  return { ok: true, text: out, outer, atom: isAtom(toks) };
}

/** True when the first token `(` is closed by the last token and by no earlier `)`. */
function closesAtEnd(toks: Tok[]): boolean {
  let depth = 0;
  for (let k = 0; k < toks.length; k++) {
    const v = toks[k]!.t === 'op' ? toks[k]!.v : '';
    if (v === '(') depth++;
    else if (v === ')' && --depth === 0 && k < toks.length - 1) return false;
  }
  return true;
}

/** One literal / word, a signed number, or `word()` / `word(literal)`: nothing that can combine with the clause that follows. */
function isAtom(toks: Tok[]): boolean {
  const op = (t: Tok | undefined, v: string): boolean => t?.t === 'op' && t.v === v;
  if (toks.length === 1) return toks[0]!.t !== 'op' && toks[0]!.t !== 'brk';
  if (toks.length === 2) return (op(toks[0], '-') || op(toks[0], '+')) && toks[1]!.t === 'num';
  if (toks[0]!.t === 'word' && op(toks[1], '(')) {
    if (toks.length === 3) return op(toks[2], ')');
    if (toks.length === 4) return (toks[2]!.t === 'num' || toks[2]!.t === 'str') && op(toks[3], ')');
  }
  return false;
}

/**
 * Type shape: first word (a name that is not a constraint keyword), or a quoted / schema-qualified name; then at most one
 * parenthesised list of numbers / literals / plain words such as GEOMETRY(Point) (a number may be followed by CHAR or BYTE); then only the continuation words of
 * a type (DOUBLE PRECISION, WITH TIME ZONE, UNSIGNED ...); then `[]`. No other word can follow, so a type can never carry
 * a column constraint (REFERENCES, UNIQUE, NULL, COLLATE, GENERATED ...).
 */
function typeShape(toks: Tok[]): boolean {
  let k = 0;
  const first = toks[k];
  if (first?.t === 'qid') k++;
  else if (first?.t === 'word') {
    if (NOT_A_TYPE.has(first.v.toUpperCase()) || STATEMENT.has(first.v.toUpperCase())) return false;
    k++;
  } else return false;
  while (toks[k]?.v === '.' && toks[k]?.t === 'op' && (toks[k + 1]?.t === 'word' || toks[k + 1]?.t === 'qid')) k += 2;
  const cont = (): void => {
    while (toks[k]?.t === 'word' && TYPE_CONT.has(toks[k]!.v.toUpperCase())) k++;
  };
  cont();
  if (toks[k]?.v === '(' && toks[k]?.t === 'op') {
    k++;
    for (;;) {
      if (toks[k]?.t === 'op' && (toks[k]!.v === '-' || toks[k]!.v === '+') && toks[k + 1]?.t === 'num') k++;
      const a = toks[k];
      if (!a || (a.t !== 'num' && a.t !== 'str' && a.t !== 'word')) return false;
      k++;
      if (a.t === 'num' && toks[k]?.t === 'word' && /^(?:CHAR|BYTE)$/i.test(toks[k]!.v)) k++;
      if (toks[k]?.v === ',' && toks[k]?.t === 'op') {
        k++;
        continue;
      }
      break;
    }
    if (toks[k]?.v !== ')') return false;
    k++;
    cont();
  }
  while (toks[k]?.t === 'brk') k++;
  return k === toks.length;
}

/** Back-compatible reason for callers that only need to know whether the text is refused. */
export function unsafeSqlText(text: string, dialect: ScanDialect, kind: SqlTextKind = 'check'): UnsafeSqlReason | undefined {
  const r = scanSqlText(text, dialect, kind);
  return r.ok ? undefined : r.reason;
}
