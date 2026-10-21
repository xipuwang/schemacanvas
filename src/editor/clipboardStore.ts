/**
 * Internal clipboard + best-effort system clipboard. The internal record is authoritative (synchronous, survives
 * permission prompts); the system clipboard receives the same JSON (with the `schemacanvas-clipboard` format marker) so a
 * paste into another tab works when the internal record is empty.
 */
import type { ClipboardPayload } from '@/model/ops';
import type { Id } from '@/model/types';
import type { Rect } from '@/scene/base';

export interface ClipboardRecord {
  payload: ClipboardPayload;
  /** World bounds of the copied nodes (for "paste near the visible centre"). */
  bounds: Rect;
  sourceDiagramId: Id | null;
  /** Pastes since the copy; grows the offset so repeated pastes do not stack exactly. */
  pasteCount: number;
}

let record: ClipboardRecord | null = null;

export const getClipboardRecord = (): ClipboardRecord | null => record;
export const clearClipboard = (): void => {
  record = null;
};

export function setClipboardRecord(r: Omit<ClipboardRecord, 'pasteCount'>): void {
  record = { ...r, pasteCount: 0 };
  try {
    const nav = globalThis.navigator as { clipboard?: { writeText?: (s: string) => Promise<void> } } | undefined;
    void nav?.clipboard?.writeText?.(JSON.stringify(r.payload))?.catch(() => undefined);
  } catch {
    // best effort only
  }
}

export function isClipboardPayload(v: unknown): v is ClipboardPayload {
  return !!v && typeof v === 'object' && (v as { format?: unknown }).format === 'schemacanvas-clipboard' && Array.isArray((v as { nodes?: unknown }).nodes);
}

/** Read a payload from the system clipboard (null when unavailable, denied, slow or not ours). Never throws. */
export async function readSystemClipboard(timeoutMs = 200): Promise<ClipboardPayload | null> {
  try {
    const nav = globalThis.navigator as { clipboard?: { readText?: () => Promise<string> } } | undefined;
    if (!nav?.clipboard?.readText) return null;
    const text = await Promise.race([nav.clipboard.readText(), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
    const parsed: unknown = JSON.parse(text);
    return isClipboardPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Payload nodes' bounds-origin rect (sizes unknown => 0): used when the source geometry is not available. */
export function payloadOrigin(payload: ClipboardPayload): Rect {
  if (payload.nodes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = payload.nodes.map((n) => n.x);
  const ys = payload.nodes.map((n) => n.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: 0, h: 0 };
}
