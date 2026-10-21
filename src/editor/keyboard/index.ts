/**
 * Keyboard layer of the canvas: cell mode in tables, connector handle editing, keyboard connect / foreign key / creation.
 * `installKeyboard()` is idempotent (imported for its side effects by tools/index.ts, which the app and the tools harness load).
 */
import { registerCanvasPlugin } from '../plugins';
import { registerKeyboardCommands } from './commands';
import { keyboardPlugin } from './keyboardPlugin';

let installed = false;

export function installKeyboard(): void {
  if (installed) return;
  installed = true;
  registerCanvasPlugin(keyboardPlugin);
  registerKeyboardCommands();
}

installKeyboard();

export { kbStore, useKb, resetKb } from './keyboardState';
