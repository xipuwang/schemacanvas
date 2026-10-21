/**
 * SQL tokenizer for the DDL importer. Hand-written, position-tracking, never throws on odd characters (they become
 * `punct` tokens) but does throw `SqlParseError` for unterminated strings/comments/quoted identifiers.
 */
import { SqlParseError } from './types';

export type TokenType = 'ident' | 'qident' | 'string' | 'number' | 'punct' | 'eof';

export interface Token {
  type: TokenType;
  /** ident: text as written; qident/string: unescaped content; number/punct: text. */
  value: string;
  /** Upper-cased `value` for identifiers (keyword comparison); empty otherwise. */
  upper: string;
  start: number;
  end: number;
  line: number;
  col: number;
  /** For qident: the opening quote character. */
  quote?: '"' | '`' | '[';
}

export interface LexNote {
  message: string;
  construct: string;
  line: number;
  col: number;
}

export interface LexOptions {
  /** Which quoting styles are legal. */
  backtick: boolean;
  bracket: boolean;
  /** `#` starts a line comment (MySQL). */
  hashComment: boolean;
  /** `\'` escapes inside plain '...' strings (MySQL). */
  backslashEscapes: boolean;
}

export interface LexResult {
  tokens: Token[];
  notes: LexNote[];
}

const isIdentStart = (c: string): boolean => /[A-Za-z_\u0080-￿]/.test(c);
const isIdentPart = (c: string): boolean => /[A-Za-z0-9_$\u0080-￿]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

export function lex(text: string, o: LexOptions): LexResult {
  const tokens: Token[] = [];
  const notes: LexNote[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const err = (msg: string, at: number, l: number, col: number, construct?: string): never => {
    throw new SqlParseError(msg, l, col, at, construct);
  };
  const advanceTo = (j: number): void => {
    for (; i < j; i++) {
      if (text[i] === '\n') {
        line++;
        lineStart = i + 1;
      }
    }
  };
  const push = (type: TokenType, value: string, start: number, l: number, col: number, extra: Partial<Token> = {}): void => {
    tokens.push({ type, value, upper: type === 'ident' ? value.toUpperCase() : '', start, end: i, line: l, col, ...extra });
  };

  /** Reads a delimited run starting at `i` (opening delimiter already at text[i]); `esc` doubles the closer. */
  const readDelimited = (close: string, backslash: boolean, what: string): string => {
    const startPos = i;
    const l = line;
    const col = i - lineStart + 1;
    let j = i + 1;
    let out = '';
    for (;;) {
      if (j >= text.length) return err(`Unterminated ${what}`, startPos, l, col);
      const c = text[j]!;
      if (backslash && c === '\\' && j + 1 < text.length) {
        out += text[j + 1];
        j += 2;
        continue;
      }
      if (c === close) {
        if (text[j + 1] === close) {
          out += close;
          j += 2;
          continue;
        }
        advanceTo(j + 1);
        return out;
      }
      out += c;
      j++;
    }
  };

  while (i < text.length) {
    const c = text[i]!;
    const col = i - lineStart + 1;
    const l = line;
    const start = i;

    if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === ' ' || c === '﻿') {
      advanceTo(i + 1);
      continue;
    }
    if (c === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      advanceTo(nl < 0 ? text.length : nl);
      continue;
    }
    if (o.hashComment && c === '#') {
      const nl = text.indexOf('\n', i);
      advanceTo(nl < 0 ? text.length : nl);
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) err('Unterminated /* comment', start, l, col);
      if (text[i + 2] === '!') {
        notes.push({ message: 'MySQL conditional comment /*! ... */ was treated as a comment; its content was not imported', construct: '/*! */', line: l, col });
      }
      advanceTo(close + 2);
      continue;
    }
    if (c === "'") {
      const v = readDelimited("'", o.backslashEscapes, 'string literal');
      push('string', v, start, l, col);
      continue;
    }
    if (c === '"') {
      const v = readDelimited('"', false, 'quoted identifier');
      push('qident', v, start, l, col, { quote: '"' });
      continue;
    }
    if (c === '`') {
      if (!o.backtick) err('Backtick-quoted identifiers are not valid in this dialect', start, l, col, '`');
      const v = readDelimited('`', false, 'quoted identifier');
      push('qident', v, start, l, col, { quote: '`' });
      continue;
    }
    if (c === '[' && o.bracket && /[A-Za-z_\u0080-\uffff ]/.test(text[i + 1] ?? '')) {
      // (`[]` / `[3]` after a type are array suffixes, not identifiers)
      // `[x]` identifier (SQLite / T-SQL). `]]` escapes a closing bracket.
      const close = text.indexOf(']', i + 1);
      if (close < 0) err('Unterminated [identifier]', start, l, col);
      let v = '';
      let j = i + 1;
      for (;;) {
        const k = text.indexOf(']', j);
        if (k < 0) return err('Unterminated [identifier]', start, l, col);
        v += text.slice(j, k);
        if (text[k + 1] === ']') {
          v += ']';
          j = k + 2;
          continue;
        }
        advanceTo(k + 1);
        break;
      }
      push('qident', v, start, l, col, { quote: '[' });
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        if (close < 0) err('Unterminated dollar-quoted string', start, l, col);
        const v = text.slice(i + tag.length, close);
        advanceTo(close + tag.length);
        push('string', v, start, l, col);
        continue;
      }
    }
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|\d*\.?\d+(?:[eE][+-]?\d+)?|\d+\.)/.exec(text.slice(i))!;
      advanceTo(i + m[0].length);
      push('number', m[0], start, l, col);
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < text.length && isIdentPart(text[j]!)) j++;
      const word = text.slice(i, j);
      // E'..' (backslash escapes), N'..', X'..', B'..' prefixed literals.
      if (j === i + 1 && /[EeNnXxBb]/.test(word) && text[j] === "'") {
        advanceTo(j);
        const v = readDelimited("'", /[Ee]/.test(word) || o.backslashEscapes, 'string literal');
        push('string', v, start, l, col);
        continue;
      }
      advanceTo(j);
      push('ident', word, start, l, col);
      continue;
    }
    advanceTo(i + 1);
    push('punct', c, start, l, col);
  }
  tokens.push({ type: 'eof', value: '', upper: '', start: text.length, end: text.length, line, col: text.length - lineStart + 1 });
  return { tokens, notes };
}
