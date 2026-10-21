/**
 * Shortcut strings are platform-neutral: modifiers `Mod` (⌘ on macOS, Ctrl elsewhere), `Alt`, `Shift`, then a key as
 * `KeyboardEvent.key` (case-insensitive for letters): `Mod+Z`, `Mod+Shift+Z`, `Delete`, `Shift+ArrowLeft`, `Mod+=`.
 */
export interface KeyEventLike {
  key: string;
  /** Physical key (`KeyboardEvent.code`); optional. Lets `Shift+1` match although the shifted key reads `!`. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export const isMacPlatform = (): boolean => {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  return /Mac|iPhone|iPad/i.test(nav?.platform ?? nav?.userAgent ?? '');
};

interface Parsed {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function parseShortcut(shortcut: string): Parsed {
  const parts = shortcut.split('+');
  // a trailing '+' key ("Mod++") yields an empty last part
  const key = shortcut.endsWith('++') ? '+' : parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  return { mod: mods.has('mod'), alt: mods.has('alt'), shift: mods.has('shift'), key };
}

const norm = (k: string): string => (k.length === 1 ? k.toLowerCase() : k);

/** Does the keyboard event trigger `shortcut` on this platform? Exact modifier match (Shift only when requested). */
export function matchesShortcut(ev: KeyEventLike, shortcut: string, mac: boolean = isMacPlatform()): boolean {
  const p = parseShortcut(shortcut);
  const modDown = mac ? ev.metaKey : ev.ctrlKey;
  const otherMod = mac ? ev.ctrlKey : ev.metaKey;
  if (p.mod !== modDown || otherMod) return false;
  if (p.alt !== ev.altKey) return false;
  const shiftOk = p.shift === ev.shiftKey || (!p.shift && p.key.length === 1 && /[^a-z0-9]/i.test(p.key));
  if (!shiftOk) return false;
  if (/^[0-9]$/.test(p.key) && ev.code && /^(Digit|Numpad)[0-9]$/.test(ev.code)) return ev.code.slice(-1) === p.key;
  if (p.alt && /^[a-z]$/i.test(p.key) && ev.code === `Key${p.key.toUpperCase()}`) return true; // Alt+letter types a symbol on macOS
  return norm(ev.key) === norm(p.key);
}

const MAC_KEYS: Record<string, string> = {
  Delete: '⌦',
  Backspace: '⌫',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '↩',
};

/** Display text: `⌘⇧Z` on macOS, `Ctrl+Shift+Z` elsewhere. */
export function formatShortcut(shortcut: string, mac: boolean = isMacPlatform()): string {
  const p = parseShortcut(shortcut);
  const key = p.key.length === 1 ? p.key.toUpperCase() : p.key;
  if (mac) return `${p.alt ? '⌥' : ''}${p.shift ? '⇧' : ''}${p.mod ? '⌘' : ''}${MAC_KEYS[key] ?? key}`.replace(/(.)$/, '$1');
  const keyText = key === 'Delete' ? 'Del' : key === 'Escape' ? 'Esc' : key.startsWith('Arrow') ? key.slice(5) : key;
  return [p.mod ? 'Ctrl' : '', p.alt ? 'Alt' : '', p.shift ? 'Shift' : '', keyText].filter(Boolean).join('+');
}
