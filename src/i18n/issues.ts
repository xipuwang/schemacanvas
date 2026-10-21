/**
 * Localisation of logic-module output (validation issues, conversion decisions/warnings, DDL/import/export warnings).
 * The logic modules emit ENGLISH text plus a stable `code` (Issue.code) / `ruleId` (ConversionDecision.ruleId) and `params`.
 *
 * Catalogue keys (namespace `issues` = src/i18n/messages/{issues,conversion,ddl}.ts, namespace `decisions`):
 *   issues.<code>.title | .explanation | .suggestion        (Issue; `ddl.<dialect>.<x>` is stored once as `issues.ddl.<x>`)
 *   decisions.<kind>.title | .explanation                    (ConversionDecision; kind = params.kind ?? ruleId)
 *
 * Rules
 *  - NEVER mix languages inside one item: a triple is localised only when ALL parts resolve for the locale; otherwise the
 *    whole item falls back to the English text the logic module wrote.
 *  - Variants. A part may exist as `<key>.<variant>`; candidates, first match wins:
 *    `params.<part>Variant`, `params.variant`, its first dotted segment, the dialect (`ddl.*`), `one`/`other` from a numeric
 *    `params.count`, then the bare key. So `count` alone gives English plurals; zh usually only has the bare key.
 *  - Fragments. `{>name}` in a template is replaced by the key `<base>.frag.<name>.<params.name>` (same locale), itself
 *    interpolated with the same params: lets one explanation vary a clause (nullable / NOT NULL, singular / plural) without
 *    multiplying whole-text variants.
 *  - Sentinels. A param value `@i18n:<key>` is replaced by `t(key)` (e.g. the logic module's "(deleted)" placeholder).
 *  - Import warnings (`sql.import.*`, `dbml.import.*`) get `{at}` = "(line L, column C)" and shared advice (`issues.import.suggestion`).
 */
import type { ConversionDecision, Issue } from '@/model/types';
import { currentLocale, hasMessage, t, type Locale, type MessageParams } from './core';

export interface LocalizedIssue {
  title: string;
  explanation: string;
  suggestion: string;
  /** true when the catalogue was used (false = English fallback text from the logic module). */
  localized: boolean;
}

export const ISSUE_PARTS = ['title', 'explanation', 'suggestion'] as const;
type Part = (typeof ISSUE_PARTS)[number];

const DDL_CODE = /^ddl\.(postgresql|mysql|sqlite|generic)\.(.+)$/;

/** Catalogue base key (without part) of an issue code, plus the implicit params the code carries. */
export function issueBase(code: string): { base: string; dialect?: string } {
  const m = DDL_CODE.exec(code);
  return m ? { base: `issues.ddl.${m[2]}`, dialect: m[1]! } : { base: `issues.${code}` };
}

/** Parts the logic module does not write per code but share (import warnings: one piece of advice for all). */
function sharedPartKey(code: string, part: Part): string | undefined {
  if (part !== 'suggestion') return undefined;
  if (code.startsWith('sql.import.') || code.startsWith('dbml.import.')) return 'issues.import.suggestion';
  if (code.startsWith('dbml.export.')) return 'issues.dbml-export.suggestion';
  return undefined;
}

function candidates(params: MessageParams, part: string, dialect?: string): string[] {
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  };
  add(params[`${part}Variant`]);
  add(params['variant']);
  const v = params['variant'];
  if (typeof v === 'string' && v.includes('.')) add(v.split('.')[0]);
  add(dialect);
  if (typeof params['count'] === 'number') add(params['count'] === 1 ? 'one' : 'other');
  return out;
}

/** The catalogue key serving `<base>.<part>` for these params in `locale`, or undefined. */
export function resolveKey(base: string, part: string, params: MessageParams, locale: Locale, dialect?: string): string | undefined {
  for (const c of candidates(params, part, dialect)) {
    const k = `${base}.${part}.${c}`;
    if (hasMessage(k, locale)) return k;
  }
  const k = `${base}.${part}`;
  return hasMessage(k, locale) ? k : undefined;
}

function expandSentinels(params: MessageParams, locale: Locale): MessageParams {
  const out: MessageParams = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string' && v.startsWith('@i18n:') ? t(v.slice(6), undefined, locale) : v;
  }
  return out;
}

/** Interpolate `key` and expand its `{>name}` fragments. */
function render(key: string, base: string, params: MessageParams, locale: Locale, blank = false): string {
  const text = expandFragments(t(key, params, locale), base, params, locale);
  return blank ? blankNames(text, locale) : text;
}

/** Validation rules quote names with `quote()`, which writes `(unnamed)` for an empty one; an empty `""` is that case. */
function blankNames(text: string, locale: Locale): string {
  return text.replace(/""|“”/g, t('issues.word.unnamed', undefined, locale));
}

function expandFragments(text: string, base: string, params: MessageParams, locale: Locale): string {
  if (!text.includes('{>')) return text;
  return text.replace(/\{>(\w+)\}/g, (m, name: string) => {
    const sel = params[name];
    const fk = `${base}.frag.${name}.${String(sel)}`;
    return sel !== undefined && hasMessage(fk, locale) ? t(fk, params, locale) : m;
  });
}

export function localizeIssue(issue: Issue, locale: Locale = currentLocale()): LocalizedIssue {
  const { base, dialect } = issueBase(issue.code);
  let params: MessageParams = { ...(issue.params ?? {}) };
  if (dialect) params['dialect'] = t(`issues.dialect.${dialect}`, undefined, locale);
  if (typeof params['line'] === 'number' && typeof params['column'] === 'number') {
    params['at'] = t('issues.at', { line: params['line'], column: params['column'] }, locale);
  }
  params = expandSentinels(params, locale);
  const keys = ISSUE_PARTS.map((p) => resolveKey(base, p, params, locale, dialect) ?? sharedPartKey(issue.code, p));
  if (keys.some((k) => k === undefined || !hasMessage(k, locale))) {
    return { title: issue.title, explanation: issue.explanation, suggestion: issue.suggestion, localized: false };
  }
  const blank = /^(er|rel)\./.test(issue.code);
  const [title, explanation, suggestion] = keys.map((k) => render(k!, base, params, locale, blank)) as [string, string, string];
  return { title, explanation, suggestion, localized: true };
}

export interface LocalizedDecision {
  title: string;
  explanation: string;
  localized: boolean;
}

/** `decisions.<kind>`: the converter sets `params.kind` for decisions that share a ruleId; the default kind is the ruleId. */
export const decisionKind = (d: Pick<ConversionDecision, 'ruleId'> & { params?: MessageParams }): string => {
  const k = d.params?.['kind'];
  return typeof k === 'string' && k ? k : d.ruleId;
};

/**
 * Decisions persisted by an older build carry no `params`; their text cannot be rebuilt, so they stay English.
 */
export function localizeDecision(
  d: Pick<ConversionDecision, 'ruleId' | 'title' | 'explanation'> & { params?: MessageParams },
  locale: Locale = currentLocale(),
): LocalizedDecision {
  const fallback = { title: d.title, explanation: d.explanation, localized: false };
  if (!d.params) return fallback;
  const base = `decisions.${decisionKind(d)}`;
  const params = expandSentinels(d.params, locale);
  const tk = resolveKey(base, 'title', params, locale);
  const ek = resolveKey(base, 'explanation', params, locale);
  if (!tk || !ek) return fallback;
  return { title: render(tk, base, params, locale), explanation: render(ek, base, params, locale), localized: true };
}

/** Generic, parameter-free description of a conversion rule (legend / trace panel): `decisions.rule.<ruleId>.*`. */
export function localizeRule(ruleId: string, locale: Locale = currentLocale()): { title: string; explanation: string } | undefined {
  const base = `decisions.rule.${ruleId}`;
  return hasMessage(`${base}.title`, locale) ? { title: t(`${base}.title`, undefined, locale), explanation: t(`${base}.explanation`, undefined, locale) } : undefined;
}
