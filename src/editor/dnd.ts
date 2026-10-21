/**
 * Drag-and-drop contract between the library sidebar (src/ui/panels) and the canvas drop handler (src/editor).
 * The sidebar sets `dataTransfer.setData(LIBRARY_MIME, encodeLibraryItem(item))`; the canvas reads it on drop and
 * creates the element at the drop point through the matching `ops.add*` (inside ONE store.commit).
 * Clicking an item (tool mode) uses the same payload: `store.setTool('place:' + JSON)` is NOT used — the canvas keeps its
 * own `armedItem` instead (see editor/index.ts `DiagramCanvasHandle.armItem`).
 */
export const LIBRARY_MIME = 'application/x-schemacanvas-item';

export type AttributeFlavor = 'simple' | 'key' | 'partial-key' | 'multivalued' | 'derived' | 'composite';

export type LibraryItem =
  /** Chen: strong or weak entity. */
  | { kind: 'entity'; weak?: boolean }
  /** Chen: relationship; `identifying` = double diamond. Participants are added with the connect tool. */
  | { kind: 'relationship'; identifying?: boolean }
  /** Chen: attribute dropped ONTO an entity / relationship / composite attribute (the owner under the cursor). */
  | { kind: 'attribute'; flavor: AttributeFlavor }
  /** Relational families: a table with `columns` empty columns (default 3, first is the PK). */
  | { kind: 'relation'; columns?: number }
  /** Insert a template/example fragment (same clone path as paste). */
  | { kind: 'template'; templateId: string };

export function encodeLibraryItem(item: LibraryItem): string {
  return JSON.stringify(item);
}

export function decodeLibraryItem(raw: string | undefined | null): LibraryItem | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as { kind?: unknown };
    switch (v.kind) {
      case 'entity':
      case 'relationship':
      case 'attribute':
      case 'relation':
      case 'template':
        return v as LibraryItem;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
