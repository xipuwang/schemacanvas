/** Test-only helpers: a real `CanvasContext` over a real store, and pointer events with real hit results. */
import type { Id, Point } from '@/model/types';
import { lightPalette } from '@/render/palette';
import { buildScene } from '@/scene/registry';
import type { EditorStore } from '@/store';
import type { DiagramCanvasHandle } from '../canvasHandle';
import { hitTest } from '../hit';
import type { CanvasContext, CanvasPointerEvent } from '../plugins';

export interface TestEnv {
  store: EditorStore;
  diagramId: Id;
  zoom: number;
  inline: Array<{ nodeId?: Id; columnId?: Id; edgeId?: Id }>;
  renders: number;
}

export function makeEnv(store: EditorStore, diagramId: Id, zoom = 1): TestEnv {
  return { store, diagramId, zoom, inline: [], renders: 0 };
}

/** Rebuilt per event, exactly like the canvas does. */
export function cxOf(env: TestEnv): CanvasContext {
  const st = env.store.getState();
  const scene = buildScene(st.project, env.diagramId);
  const handle = {
    startInlineEdit: (target: { nodeId?: Id; columnId?: Id; edgeId?: Id }) => void env.inline.push(target),
    focus: () => undefined,
    getViewport: () => ({ x: 0, y: 0, zoom: env.zoom }),
  } as unknown as DiagramCanvasHandle;
  return {
    project: st.project,
    diagramId: env.diagramId,
    diagram: st.project.diagrams[env.diagramId]!,
    scene,
    viewport: { x: 0, y: 0, zoom: env.zoom },
    zoom: env.zoom,
    palette: lightPalette,
    store: env.store,
    handle,
    worldFromClient: (x, y) => ({ x: x / env.zoom, y: y / env.zoom }),
    hit: (w, o) => hitTest(scene, w, env.zoom, o),
    setCursor: () => undefined,
    requestRender: () => void env.renders++,
  };
}

export function evAt(env: TestEnv, world: Point, over: Partial<CanvasPointerEvent> = {}): CanvasPointerEvent {
  const cx = cxOf(env);
  return {
    world,
    screen: { x: world.x * env.zoom, y: world.y * env.zoom },
    clientX: world.x * env.zoom,
    clientY: world.y * env.zoom,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    detail: 1,
    hit: cx.hit(world),
    ...over,
  };
}
