/**
 * Canvas plugin of the keyboard layer (priority above the tools): cell mode keys, connector handle keys, keyboard connect and the
 * arrow keys that pick the referenced table of a keyboard foreign key. Its overlay draws the cell cursor, the marked cells, the
 * focused connector handle and the connect source. Everything else (commands, Tab order) lives in commands.ts and the canvas.
 */
import type { ReactNode } from 'react';
import { labelRect } from '@/scene/geometry';
import type { CanvasContext, CanvasPlugin } from '../plugins';
import { toolUi } from '../tools/toolState';
import { cursorColumn, isMarked } from './cellMode';
import { cellExit, cellRename, cellStep, cellToggle, edgeNudge, edgeRemoveBend, fkPickTarget, hasEdgeFocus, linkCancel, linkCommit, linkPick, type KbEnv } from './actions';
import { edgeFocusTargets } from './edgeKb';
import { kbStore } from './keyboardState';
import { edgeHandles } from '../tools/handles';

const envOf = (cx: CanvasContext): KbEnv => ({ diagramId: cx.diagramId, diagram: cx.diagram, project: cx.project, scene: cx.scene, zoom: cx.zoom, handle: cx.handle });

export const keyboardPlugin: CanvasPlugin = {
  id: 'editor.keyboard',
  priority: 95,

  onKeyDown(cx, ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const env = envOf(cx);
    const kb = kbStore.getState();
    const key = ev.key;
    const arrow = key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';

    if (kb.link) {
      if (key === 'Escape') return linkCancel() ? 'handled' : undefined;
      if (arrow && !ev.shiftKey) return linkPick(env, key) ? 'handled' : undefined;
      if (key === 'Enter') return linkCommit(env) ? 'handled' : undefined;
      return;
    }
    if (arrow && !ev.shiftKey && toolUi.getState().fkPending && !kb.cell) return fkPickTarget(env, key) ? 'handled' : undefined;

    if (kb.cell) {
      switch (key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          return cellStep(env, key === 'ArrowRight' ? 1 : -1, ev.shiftKey) ? 'handled' : undefined;
        case 'ArrowUp':
        case 'ArrowDown':
          return 'handled'; // arrows never nudge the table while a cell is the focus
        case 'Home':
        case 'End':
          return cellStep(env, key === 'Home' ? 'first' : 'last', ev.shiftKey) ? 'handled' : undefined;
        case ' ':
          return cellToggle(env) ? 'handled' : undefined;
        case 'F2':
        case 'Enter':
          return cellRename(cx.handle) ? 'handled' : undefined;
        case 'Escape':
          return cellExit() ? 'handled' : undefined;
        case 'Tab':
          cellExit();
          return;
        default:
          return;
      }
    }

    if (hasEdgeFocus(env)) {
      if (arrow) return edgeNudge(env, key, ev.shiftKey) ? 'handled' : undefined;
      if (key === 'Delete' || key === 'Backspace') return edgeRemoveBend(env) ? 'handled' : undefined;
    }
    return;
  },

  overlay(cx) {
    const kb = kbStore.getState();
    const { palette } = cx;
    const nonScaling = { vectorEffect: 'non-scaling-stroke' as const };
    const out: ReactNode[] = [];
    if (kb.cell && cx.scene.nodes[kb.cell.nodeId]) {
      const g = cx.scene.nodes[kb.cell.nodeId]!;
      const cells = g.kind === 'h-table' ? g.cells.map((c) => ({ id: c.columnId, rect: c.rect })) : g.kind === 'v-table' ? g.rows.map((r) => ({ id: r.columnId, rect: r.rect })) : [];
      for (const c of cells) {
        const marked = isMarked(kb.cell, c.id);
        const here = c.id === cursorColumn(kb.cell);
        if (!marked && !here) continue;
        out.push(
          <rect
            key={`cell-${c.id}`}
            x={c.rect.x - 1}
            y={c.rect.y - 1}
            width={c.rect.w + 2}
            height={c.rect.h + 2}
            fill={marked ? palette.accent : 'none'}
            fillOpacity={marked ? 0.22 : 0}
            stroke={palette.accent}
            strokeWidth={here ? 3 : 1.5}
            strokeDasharray={here ? undefined : '4 3'}
            {...nonScaling}
            pointerEvents="none"
            data-overlay={here ? 'cell-cursor' : 'cell-mark'}
            data-column-id={c.id}
          />,
        );
      }
    }
    if (kb.edgeId && kb.edgeFocus && cx.scene.edges[kb.edgeId]) {
      const handles = edgeHandles(cx.scene, kb.edgeId, cx.diagram.edges[kb.edgeId], cx.zoom);
      const g = cx.scene.edges[kb.edgeId]!;
      const f = edgeFocusTargets(handles, g.labels.map((l) => l.id)).find((x) => x.id === kb.edgeFocus);
      const r = 9 / cx.zoom;
      if (f && f.kind !== 'label') {
        out.push(<circle key="edge-focus" cx={f.handle.at.x} cy={f.handle.at.y} r={r} fill="none" stroke={palette.accent} strokeWidth={3} {...nonScaling} pointerEvents="none" data-overlay="edge-focus" data-focus-id={f.id} />);
      } else if (f) {
        const lab = g.labels.find((l) => l.id === f.labelId);
        if (lab) {
          const lr = labelRect(lab.label);
          out.push(<rect key="edge-focus" x={lr.x - 3} y={lr.y - 3} width={lr.w + 6} height={lr.h + 6} fill="none" stroke={palette.accent} strokeWidth={3} {...nonScaling} pointerEvents="none" data-overlay="edge-focus" data-focus-id={f.id} />);
        }
      }
    }
    if (kb.link && cx.scene.nodes[kb.link.fromNodeId]) {
      const b = cx.scene.nodes[kb.link.fromNodeId]!.paintBounds;
      out.push(<rect key="link-from" x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} rx={4} fill="none" stroke={palette.accent} strokeWidth={2} strokeDasharray="2 4" {...nonScaling} pointerEvents="none" data-overlay="link-source" />);
    }
    return out.length ? <g data-overlay="keyboard">{out}</g> : null;
  },
};
