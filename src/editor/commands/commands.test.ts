import { afterEach, describe, expect, it } from 'vitest';
import { formatShortcut, matchesShortcut, parseShortcut } from './shortcuts';
import { getCommand, isCommandEnabled, registerCommand, runCommand } from './registry';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('shortcuts', () => {
  it('Mod maps to Cmd on mac and Ctrl elsewhere; modifiers must match exactly', () => {
    expect(matchesShortcut(ev('z', { metaKey: true }), 'Mod+Z', true)).toBe(true);
    expect(matchesShortcut(ev('z', { ctrlKey: true }), 'Mod+Z', true)).toBe(false);
    expect(matchesShortcut(ev('z', { ctrlKey: true }), 'Mod+Z', false)).toBe(true);
    expect(matchesShortcut(ev('Z', { ctrlKey: true, shiftKey: true }), 'Mod+Z', false)).toBe(false);
    expect(matchesShortcut(ev('Z', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+Z', false)).toBe(true);
    expect(matchesShortcut(ev('Delete'), 'Delete', false)).toBe(true);
    expect(matchesShortcut(ev('Delete', { altKey: true }), 'Delete', false)).toBe(false);
  });
  it('symbol keys tolerate the implicit shift (zoom in with Mod+= or Mod++)', () => {
    expect(matchesShortcut(ev('=', { ctrlKey: true }), 'Mod+=', false)).toBe(true);
    expect(matchesShortcut(ev('+', { ctrlKey: true, shiftKey: true }), 'Mod++', false)).toBe(true);
    expect(parseShortcut('Mod++').key).toBe('+');
  });
  it('formats per platform', () => {
    expect(formatShortcut('Mod+Shift+Z', true)).toBe('⇧⌘Z');
    expect(formatShortcut('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(formatShortcut('Delete', false)).toBe('Del');
    expect(formatShortcut('Alt+ArrowLeft', false)).toBe('Alt+Left');
  });
});

describe('command registry', () => {
  const offs: Array<() => void> = [];
  afterEach(() => offs.splice(0).forEach((f) => f()));
  it('registers, gates on isEnabled, runs, unregisters', async () => {
    let ran = 0;
    let enabled = false;
    offs.push(registerCommand({ id: 't.cmd', labelKey: 'x.y', group: 'tools', isEnabled: () => enabled, run: () => void ran++ }));
    expect(getCommand('t.cmd')).toBeDefined();
    expect(isCommandEnabled('t.cmd')).toBe(false);
    expect(await runCommand('t.cmd')).toBe(false);
    enabled = true;
    expect(await runCommand('t.cmd')).toBe(true);
    expect(ran).toBe(1);
    offs.pop()!();
    expect(getCommand('t.cmd')).toBeUndefined();
    expect(await runCommand('t.cmd')).toBe(false);
  });
});
