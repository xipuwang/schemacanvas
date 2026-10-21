import type { ClipboardPayload } from '@/model/ops/clipboard';
import type { ConversionOptions, ErModel, Id, Project, RelationalModel } from '@/model/types';

export type ExampleLevel = 'basic' | 'intermediate' | 'advanced';

export interface ExampleDefinition {
  id: string;
  /** i18n key (`examples.<id>.title`). */
  titleKey: string;
  /** i18n key (`examples.<id>.description`). */
  descriptionKey: string;
  level: ExampleLevel;
  tags: string[];
  /** Deterministic: same ids, same timestamps, same positions on every call. */
  build(): Project;
}

export interface TemplateDefinition {
  id: string;
  titleKey: string;
  descriptionKey: string;
  modelKind: 'er' | 'relational';
  /** A self-contained clipboard payload (deterministic); `insertTemplate` remaps every id on paste. */
  build(): ClipboardPayload;
}

/** What an example module contributes: the ER model and the conversion options (they need participant ids). */
export interface ErSpec {
  er: ErModel;
  options?: Partial<ConversionOptions>;
  /**
   * Textbook names for generated columns that no prefix can reach (multivalued-attribute keys): `[relation, column, newName]`.
   * Applied through `ConversionOptions.columnNames` (keyed by Origin.key) so a re-conversion keeps them.
   */
  renames?: Array<[string, string, string]>;
}

/** What a template module contributes: ONE model (ER or relational). */
export type TemplateSpec = { er: ErModel } | { relational: RelationalModel };

export interface FrozenLayout {
  /** Chen diagram: top-left of every node keyed by element name path (`Student`, `Student.Name.First`, `Makes`). */
  er: Record<string, [number, number]>;
  /** Relational diagram: top-left of every table keyed by relation name. */
  rel: Record<string, [number, number]>;
}

export type { Id };
