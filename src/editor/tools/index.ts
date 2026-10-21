/**
 * EDITOR-TOOLS entry point (imported for its side effects by src/ui/register.ts): registers the canvas plugins, the tool
 * commands and the tool-state bookkeeping. See README.md in this directory.
 */
import '@/i18n';
import { t } from '@/i18n';
import { editorStore } from '@/store';
import { registerCanvasPlugin } from '../plugins';
import '../keyboard';
import { registerToolsCommands } from './commands';
import { handlesPlugin } from './handlesPlugin';
import { announce, resetToolUi, setToolUi } from './toolState';
import { toolsPlugin } from './toolsPlugin';
import './tools.css';

let installed = false;

/** Idempotent: registers everything once (tests and the app may both import this module). */
export function installEditorTools(): void {
  if (installed) return;
  installed = true;
  registerCanvasPlugin(handlesPlugin);
  registerCanvasPlugin(toolsPlugin);
  registerToolsCommands();

  // tool state: announce changes, drop half-finished tool state when the tool or diagram changes
  let prevTool = editorStore.getState().tool;
  let prevDiagram = editorStore.getState().activeDiagramId;
  editorStore.subscribe((s) => {
    if (s.tool !== prevTool) {
      prevTool = s.tool;
      setToolUi({ gestureHint: null, connect: null, fk: null, ...(s.tool === 'fk' ? {} : { fkPending: null }) });
      announce(t(`editorTools.announce.tool.${s.tool === 'connect' || s.tool === 'fk' || s.tool === 'hand' ? s.tool : 'select'}`));
    }
    if (s.activeDiagramId !== prevDiagram) {
      prevDiagram = s.activeDiagramId;
      resetToolUi(['announcement']);
      const type = s.activeDiagramId ? s.project.diagrams[s.activeDiagramId]?.type : undefined;
      if ((s.tool === 'connect' && type !== 'chen') || (s.tool === 'fk' && type === 'chen')) s.setTool('select');
    }
  });
}

installEditorTools();

export { toolUi, resetToolUi } from './toolState';
export { classifyConnect, planConnectSelected, connectParticipant, createRelationshipBetween } from './chenConnect';
export { resolveFkTarget, candidateKeys, suggestMapping, describePairs, remapTarget } from './fkLogic';
export { createForeignKey } from './fkCommit';
export { addAttributeTo, flavorsFor } from './attributes';
export { nodeHandles, edgeHandles, hitHandle } from './handles';
