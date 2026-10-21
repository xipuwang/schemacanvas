import { useEffect } from 'react';
import { findCommandForEvent, matchesShortcut, runCommand } from '@/editor';
import { uiStore } from '../uiStore';
import { shellStore } from './shellStore';

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
};

/** Controls that Enter / Space activate natively: a shortcut bound to those keys must never swallow the activation. */
const ACTIVATABLE = 'button,a[href],summary,[role="button"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="option"],[role="radio"],[role="checkbox"],[role="switch"]';
const activatesNatively = (e: KeyboardEvent): boolean => (e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.closest(ACTIVATABLE) !== null;

/**
 * Window-level keyboard shortcuts. The canvas handles its own keys first (and calls preventDefault); this handler
 * covers everything else. While a dialog / the palette is open nothing runs; inside text fields only file, help,
 * settings and palette commands run (so Ctrl+Z, Delete etc. keep their native text-editing meaning).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing || activatesNatively(e)) return;
      if (uiStore.getState().dialog || shellStore.getState().paletteOpen) return;
      const cmd = findCommandForEvent(e, matchesShortcut);
      if (!cmd) return;
      if (isEditable(e.target)) {
        const allowed = cmd.group === 'file' || cmd.group === 'help' || cmd.id === 'settings' || cmd.id === 'palette.open';
        // a bare "?" typed into a field is just text
        if (!allowed || (!e.ctrlKey && !e.metaKey && e.key.length === 1)) return;
      }
      e.preventDefault();
      void runCommand(cmd.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
