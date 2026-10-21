import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/jetbrains-mono';
import '@/ui/theme/tokens.css';
import '@/i18n';
import { setLocaleLoaded } from '@/i18n';
import { StrictMode, createElement, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiagramCanvas, useViewportInfo, runCommand, registerCanvasPlugin, type DiagramCanvasHandle } from '@/editor';
import { createErModel } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { Id, Project } from '@/model/types';
import { createBareProject } from '@/model/defaults';
import { layoutChenFixture, pharmacy } from '@/scene/chen/fixtures';
import { pharmacyFixture } from '@/scene/horizontal/fixtures';
import { editorStore, useEditorStore, settingsStore } from '@/store';
import { uiStore } from '@/ui/uiStore';
import { buildBigProject, type BigKind } from '@/editor/perfFixtures';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
settingsStore.getState().setTheme(theme);
// the zh catalogues are a lazy chunk: the page renders (below) only once they are in
const localeReady = params.get('lang') === 'zh' ? setLocaleLoaded('zh') : Promise.resolve('applied' as const);

function buildProject(): { project: Project; ids: { chen: Id; rel: Id; empty: Id } } {
  const chen = layoutChenFixture(pharmacy());
  const project = chen.project;
  const rf = pharmacyFixture();
  project.models[rf.model.id] = rf.model;
  project.diagrams[rf.diagram.id] = rf.diagram;
  project.diagramOrder.push(rf.diagram.id);
  const emptyModel = createErModel('Empty');
  const empty = withDiagram(project, emptyModel, 'chen', { name: 'Empty' });
  void createBareProject;
  return { project, ids: { chen: chen.diagram.id, rel: rf.diagram.id, empty: empty.id } };
}

// `?big=rel40|rel87|chen60` loads a large generated project instead (drag-performance measurements, e2e/editor2).
const bigKind = params.get('big') as BigKind | null;
let { project, ids } = buildProject();
if (!bigKind) {
  editorStore.getState().loadProject(project);
  editorStore.getState().setActiveDiagram(ids.chen);
}

function App() {
  const active = useEditorStore((s) => s.activeDiagramId) ?? ids.chen;
  const tool = useEditorStore((s) => s.tool);
  const canUndo = useEditorStore((s) => s.canUndo);
  const info = useViewportInfo();
  const handle = useRef<DiagramCanvasHandle>(null);
  const [, force] = useState(0);
  (window as unknown as { __sc: unknown }).__sc = { store: editorStore, ids, handle, force, runCommand, registerCanvasPlugin, h: createElement, ui: uiStore };
  return (
    <div className="h-shell">
      <div className="h-bar" role="toolbar" aria-label="Harness">
        {(['chen', 'rel', 'empty'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={active === ids[k]} onClick={() => editorStore.getState().setActiveDiagram(ids[k])}>
            {k}
          </button>
        ))}
        <button type="button" onClick={() => void runCommand('edit.undo')} disabled={!canUndo}>
          undo
        </button>
        <span data-testid="tool">{tool}</span>
      </div>
      <main className="h-main">
        <DiagramCanvas ref={handle} diagramId={active} />
      </main>
      <div className="h-status" role="status">
        <span data-testid="zoom">{Math.round(info.zoom * 100)}%</span>
        <span data-testid="size">
          {info.width}x{info.height}
        </span>
      </div>
    </div>
  );
}

async function start(): Promise<void> {
  await localeReady;
  if (bigKind) {
    const big = await buildBigProject(bigKind);
    project = big.project;
    ids = { chen: big.diagramId, rel: big.diagramId, empty: big.diagramId };
    editorStore.getState().loadProject(project);
    editorStore.getState().setActiveDiagram(big.diagramId);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
