/**
 * EDITOR-TOOLS harness: the real canvas + the real tool plugins (`@/editor/tools`) over pharmacy fixtures.
 * Diagrams: chen (full pharmacy ER), empty (empty ER), rel (horizontal schema WITH foreign keys), relBare (the same
 * schema WITHOUT foreign keys: draw them with the FK tool), cf (crow's foot, vertical tables, no foreign keys).
 * `?theme=dark`, `?lang=zh`, `?snap=0` (default: snap off so geometry assertions are exact).
 */
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/jetbrains-mono';
import '@/ui/theme/tokens.css';
import '@/ui/components';
import '@/i18n';
import { setLocaleLoaded } from '@/i18n';
import '@/editor/tools';
import { StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { produce } from 'immer';
import { DiagramCanvas, runCommand, type DiagramCanvasHandle } from '@/editor';
import { createErModel } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import type { Id, Project, RelationalModel } from '@/model/types';
import { layoutChenFixture, pharmacy } from '@/scene/chen/fixtures';
import { pharmacyFixture } from '@/scene/horizontal/fixtures';
import { pharmacyVFixture } from '@/scene/vertical/fixtures';
import { editorStore, settingsStore, useEditorStore } from '@/store';
import { ToastHost } from '@/ui/components';
import { uiStore } from '@/ui/uiStore';
import { useResolvedTheme } from '@/ui/theme/useResolvedTheme';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
settingsStore.getState().setTheme(theme);
// the zh catalogues are a lazy chunk: the page renders (below) only once they are in
const localeReady = params.get('lang') === 'zh' ? setLocaleLoaded('zh') : Promise.resolve('applied' as const);

function stripForeignKeys(project: Project, modelId: Id): Project {
  return produce(project, (d) => {
    const m = d.models[modelId] as RelationalModel;
    for (const id of Object.keys(m.foreignKeys)) ops.removeForeignKey(d, modelId, id);
  });
}

function build() {
  const chen = layoutChenFixture(pharmacy());
  const project = chen.project;
  const add = (m: RelationalModel, d: Project['diagrams'][string]): void => {
    project.models[m.id] = m;
    project.diagrams[d.id] = d;
    project.diagramOrder.push(d.id);
  };
  const rf = pharmacyFixture();
  add(rf.model, rf.diagram);
  // the same schema once more, without foreign keys (stripped below)
  const bare = pharmacyFixture();
  add(bare.model, bare.diagram);
  const cf = pharmacyVFixture('crows-foot', 'vertical');
  add(cf.model, cf.diagram);
  const empty = withDiagram(project, createErModel('Empty'), 'chen', { name: 'Empty' });
  for (const dg of Object.values(project.diagrams)) dg.options.grid.snap = params.get('snap') === '1';
  let out = stripForeignKeys(project, bare.model.id);
  out = stripForeignKeys(out, cf.model.id);
  return { project: out, ids: { chen: chen.diagram.id, rel: rf.diagram.id, relBare: bare.diagram.id, cf: cf.diagram.id, empty: empty.id } };
}

const { project, ids } = build();
editorStore.getState().loadProject(project);
editorStore.getState().setActiveDiagram(ids.chen);

function App() {
  const active = useEditorStore((s) => s.activeDiagramId) ?? ids.chen;
  const tool = useEditorStore((s) => s.tool);
  const handle = useRef<DiagramCanvasHandle>(null);
  useResolvedTheme();
  (window as unknown as { __sc: unknown }).__sc = { store: editorStore, ids, handle, runCommand, ui: uiStore, ops };
  return (
    <div className="h-shell">
      <div className="h-bar" role="toolbar" aria-label="Harness">
        {(['chen', 'rel', 'relBare', 'cf', 'empty'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={active === ids[k]} onClick={() => editorStore.getState().setActiveDiagram(ids[k])}>
            {k}
          </button>
        ))}
        <button type="button" onClick={() => void runCommand('edit.undo')}>
          undo
        </button>
        <button type="button" aria-pressed={tool === 'connect'} onClick={() => void runCommand('tool.connect')}>
          connect tool
        </button>
        <button type="button" aria-pressed={tool === 'fk'} onClick={() => void runCommand('tool.fk')}>
          fk tool
        </button>
        <span data-testid="tool">{tool}</span>
      </div>
      <main className="h-main">
        <DiagramCanvas ref={handle} diagramId={active} />
      </main>
      <div className="h-status" role="status" />
      <ToastHost />
    </div>
  );
}

void localeReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
