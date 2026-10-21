/**
 * What the parts library offers for each diagram type. Pure data: the panel turns it into buttons, the preview module
 * turns each part into an SVG drawn by the real scene builders.
 */
import { TEMPLATES } from '@/examples';
import type { LibraryItem } from '@/editor';
import { modelKindForDiagramType } from '@/model/defaults';
import type { DiagramType } from '@/model/types';

export type SectionId = 'entities' | 'relationships' | 'attributes' | 'tables' | 'templates';

/** What a preview shows. `template` previews insert the whole template into an empty diagram. */
export type PreviewSpec =
  | { kind: 'entity'; weak: boolean }
  | { kind: 'relationship'; identifying: boolean }
  | { kind: 'attribute'; flavor: 'simple' | 'key' | 'partial-key' | 'multivalued' | 'derived' | 'composite' }
  | { kind: 'relation' }
  | { kind: 'template'; templateId: string };

export interface PartDef {
  /** Stable id (also the test id: `data-part-id`). */
  id: string;
  item: LibraryItem;
  /** i18n keys; templates use the keys of the example catalogue. */
  labelKey: string;
  descKey: string;
  /** Extra English search words (the localized label is always searched too). */
  keywords: string;
  preview: PreviewSpec;
  /** Wide items span the full row of the grid. */
  wide?: boolean;
}

export interface SectionDef {
  id: SectionId;
  titleKey: string;
  parts: PartDef[];
}

const chenSections = (): SectionDef[] => [
  {
    id: 'entities',
    titleKey: 'library.section.entities',
    parts: [
      { id: 'entity', item: { kind: 'entity' }, labelKey: 'library.part.entity', descKey: 'library.part.entity.desc', keywords: 'entity strong rectangle', preview: { kind: 'entity', weak: false } },
      { id: 'weak-entity', item: { kind: 'entity', weak: true }, labelKey: 'library.part.weakEntity', descKey: 'library.part.weakEntity.desc', keywords: 'weak entity double rectangle', preview: { kind: 'entity', weak: true } },
    ],
  },
  {
    id: 'relationships',
    titleKey: 'library.section.relationships',
    parts: [
      { id: 'relationship', item: { kind: 'relationship' }, labelKey: 'library.part.relationship', descKey: 'library.part.relationship.desc', keywords: 'relationship diamond', preview: { kind: 'relationship', identifying: false } },
      {
        id: 'identifying-relationship',
        item: { kind: 'relationship', identifying: true },
        labelKey: 'library.part.identifying',
        descKey: 'library.part.identifying.desc',
        keywords: 'identifying relationship double diamond weak owner',
        preview: { kind: 'relationship', identifying: true },
      },
    ],
  },
  {
    id: 'attributes',
    titleKey: 'library.section.attributes',
    parts: [
      { id: 'attribute', item: { kind: 'attribute', flavor: 'simple' }, labelKey: 'library.part.attribute', descKey: 'library.part.attribute.desc', keywords: 'attribute simple ellipse', preview: { kind: 'attribute', flavor: 'simple' } },
      { id: 'key-attribute', item: { kind: 'attribute', flavor: 'key' }, labelKey: 'library.part.key', descKey: 'library.part.key.desc', keywords: 'key primary underline identifier', preview: { kind: 'attribute', flavor: 'key' } },
      { id: 'partial-key', item: { kind: 'attribute', flavor: 'partial-key' }, labelKey: 'library.part.partialKey', descKey: 'library.part.partialKey.desc', keywords: 'partial key discriminator dashed underline weak', preview: { kind: 'attribute', flavor: 'partial-key' } },
      { id: 'multivalued', item: { kind: 'attribute', flavor: 'multivalued' }, labelKey: 'library.part.multivalued', descKey: 'library.part.multivalued.desc', keywords: 'multivalued multi valued double ellipse', preview: { kind: 'attribute', flavor: 'multivalued' } },
      { id: 'derived', item: { kind: 'attribute', flavor: 'derived' }, labelKey: 'library.part.derived', descKey: 'library.part.derived.desc', keywords: 'derived computed dashed ellipse', preview: { kind: 'attribute', flavor: 'derived' } },
      { id: 'composite', item: { kind: 'attribute', flavor: 'composite' }, labelKey: 'library.part.composite', descKey: 'library.part.composite.desc', keywords: 'composite sub attributes hierarchy', preview: { kind: 'attribute', flavor: 'composite' }, wide: true },
    ],
  },
];

const relationalSections = (): SectionDef[] => [
  {
    id: 'tables',
    titleKey: 'library.section.tables',
    parts: [{ id: 'table', item: { kind: 'relation', columns: 3 }, labelKey: 'library.part.table', descKey: 'library.part.table.desc', keywords: 'table relation schema columns', preview: { kind: 'relation' }, wide: true }],
  },
];

/** Templates whose model kind matches the diagram type. */
export function templateParts(type: DiagramType): PartDef[] {
  const kind = modelKindForDiagramType(type);
  return TEMPLATES.filter((t) => t.modelKind === kind).map((t) => ({
    id: `template-${t.id}`,
    item: { kind: 'template', templateId: t.id } as LibraryItem,
    labelKey: t.titleKey,
    descKey: t.descriptionKey,
    keywords: `template pattern ${t.id}`,
    preview: { kind: 'template', templateId: t.id } as PreviewSpec,
    wide: true,
  }));
}

/** All sections for a diagram type, templates last. Empty sections are omitted. */
export function librarySections(type: DiagramType): SectionDef[] {
  const base = modelKindForDiagramType(type) === 'er' ? chenSections() : relationalSections();
  const templates = templateParts(type);
  return templates.length ? [...base, { id: 'templates', titleKey: 'library.section.templates', parts: templates }] : base;
}

/** Case-insensitive match of the query against the localized label and the English keywords. */
export function partMatches(part: PartDef, label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).every((word) => label.toLowerCase().includes(word) || part.keywords.toLowerCase().includes(word));
}

export function sameItem(a: LibraryItem | null | undefined, b: LibraryItem | null | undefined): boolean {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}
