/** Trigger a browser download. The object URL is revoked later because some browsers start the download asynchronously. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') throw new Error('downloadBlob requires a browser environment');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Best effort: copy a PNG blob to the system clipboard. Resolves false (never throws) when unsupported or denied. */
export async function copyPngToClipboard(png: Blob | Promise<Blob>): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(png) })]);
    return true;
  } catch {
    return false;
  }
}
