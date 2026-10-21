/**
 * Public API of the editor package. See README.md.
 * Importing this module registers the editor commands (edit / view / arrange / layout / tool) in the command registry.
 */
import './commands';

export { DiagramCanvas } from './DiagramCanvas';
export type { DiagramCanvasProps } from './DiagramCanvas';
export type { DiagramCanvasHandle } from './canvasHandle';
export { LIBRARY_MIME, encodeLibraryItem, decodeLibraryItem, type LibraryItem, type AttributeFlavor } from './dnd';
export {
  registerCommand,
  getCommand,
  listCommands,
  runCommand,
  isCommandEnabled,
  useCommand,
  setCanvasHandle,
  commandContext,
  findCommandForEvent,
  type Command,
  type CommandContext,
  type CommandGroup,
} from './commands/registry';
export { cancelAutoLayout } from './commands/layout';
export { matchesShortcut, formatShortcut, parseShortcut, isMacPlatform, type KeyEventLike } from './commands/shortcuts';

// interaction engine
export { hitTest, marqueeSelect, rectFromPoints, type HitResult, type HitOptions, type HitKind, type MarqueeOptions } from './hit';
export {
  registerCanvasPlugin,
  registerContextMenuProvider,
  listCanvasPlugins,
  PluginDispatcher,
  type CanvasPlugin,
  type CanvasContext,
  type CanvasPointerEvent,
  type PluginResult,
  type MenuEntry,
} from './plugins';
export { createFromLibraryItem, registerTemplateInserter, nextDefaultName, attributeOwnerAt, type CreationResult, type TemplateInsertion } from './creation';
export { resolveEditSpec, type EditSpec, type EditTarget } from './editSpec';
export { useViewportInfo, useArmedItem, viewportInfoStore, canvasUiStore, type ViewportInfo } from './canvasState';
export { MIN_ZOOM, MAX_ZOOM, fitRect, zoomAround, screenToWorld, worldToScreen } from './viewport';
export { selectionRefs, removeRefs } from './semanticDelete';
export { getClipboardRecord, clearClipboard } from './clipboardStore';
