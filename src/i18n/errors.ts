/**
 * Localised text for the errors the model and persistence layers report (LoadError in toasts, OpError when an edit is
 * refused, InvariantViolation). The raw `message` stays English and technical (it is for logs and tests); these helpers
 * return text for people. Catalogue: src/i18n/messages/errors.ts.
 */
import type { LoadError, LoadErrorCode } from '@/model/io/types';
import type { OpErrorCode } from '@/model/ops/common';
import { currentLocale, hasMessage, t, type Locale } from './core';

/** Exhaustive by construction: a new LoadErrorCode / OpErrorCode does not compile until it is listed here. */
export const LOAD_ERROR_CODES: Record<LoadErrorCode, true> = {
  'not-json': true,
  'wrong-format': true,
  'newer-version': true,
  'unsupported-version': true,
  'invalid-structure': true,
};
export const OP_ERROR_CODES: Record<OpErrorCode, true> = {
  'not-found': true,
  'wrong-kind': true,
  invalid: true,
  'id-in-use': true,
  cycle: true,
  'foreign-key-invalid': true,
  'paste-kind-mismatch': true,
};
/** `InvariantViolation.code` values of model/invariants.ts (a test compares this list with the source). */
export const INVARIANT_CODES = [
  'attribute-owner-cycle',
  'attribute-owner-missing',
  'column-widths-orphan',
  'diagram-model-kind',
  'diagram-model-missing',
  'diagram-order',
  'duplicate-id',
  'edge-duplicate',
  'edge-endpoint-missing',
  'edge-ref-dangling',
  'fk-relation-missing',
  'key-column-duplicate',
  'key-column-invalid',
  'key-id-mismatch',
  'node-duplicate',
  'node-ref-dangling',
  'node-ref-kind',
  'option-block-missing',
] as const;

/** Sentence for a failed load; `path` (the first structural problem) is appended when the file has one. */
export function localizeLoadError(error: Pick<LoadError, 'code' | 'message' | 'path'>, locale: Locale = currentLocale()): string {
  const withPath = `errors.load.${error.code}.path`;
  if (error.path && hasMessage(withPath, locale)) return t(withPath, { path: error.path }, locale);
  const key = `errors.load.${error.code}`;
  return hasMessage(key, locale) ? t(key, undefined, locale) : error.message;
}

/** Sentence for a refused edit (`OpError.code`); falls back to the English message for unknown codes. */
export function localizeOpError(error: { code: string; message: string }, locale: Locale = currentLocale()): string {
  const key = `errors.op.${error.code}`;
  return hasMessage(key, locale) ? t(key, undefined, locale) : error.message;
}

export function localizeInvariant(violation: { code: string; message: string }, locale: Locale = currentLocale()): string {
  const key = `errors.invariant.${violation.code}`;
  return hasMessage(key, locale) ? t(key, undefined, locale) : violation.message;
}
