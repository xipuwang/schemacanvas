/**
 * Default sheet names. A new diagram is stored with the English default (`defaultDiagramName`, e.g. "ER Diagram") because the
 * project file is language independent; the UI shows it in the user's language. A stored name counts as the default when it
 * equals (ignoring case and surrounding spaces) the default of the diagram's OWN type in any language, or is empty. Any other
 * name is the user's and is shown exactly as stored; nothing here ever writes to the project.
 * (A user who types exactly a built-in default name therefore gets the default, which follows the language: the two are the same name.)
 */
import type { Diagram, DiagramType } from '@/model/types';
import { defaultDiagramName } from '@/model/defaults';
import { currentLocale, t, type Locale } from './core';

const LOCALES: readonly Locale[] = ['en', 'zh'];
/** Spellings the bundled examples (and older builds) stored for the same default. */
const LEGACY: Partial<Record<DiagramType, readonly string[]>> = { chen: ['ER diagram'], 'relational-schema': ['Relational schema'] };

const norm = (s: string): string => s.trim().toLowerCase();

/** Is `name` the (untouched) default name of a diagram of this type, in any language? */
export function isDefaultDiagramName(type: DiagramType, name: string): boolean {
  const n = norm(name);
  if (n === '') return true;
  if (n === norm(defaultDiagramName(type)) || (LEGACY[type] ?? []).some((l) => norm(l) === n)) return true;
  return LOCALES.some((l) => norm(t(`shell.defaultName.${type}`, undefined, l)) === n);
}

/** The name to SHOW for a diagram: the localized default for an untouched default name, otherwise the stored name. */
export function displayDiagramName(diagram: Pick<Diagram, 'name' | 'type'>, locale: Locale = currentLocale()): string {
  return isDefaultDiagramName(diagram.type, diagram.name) ? t(`shell.defaultName.${diagram.type}`, undefined, locale) : diagram.name;
}
