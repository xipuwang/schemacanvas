import type { RefObject } from 'react';
import { createFromLibraryItem, runCommand, type DiagramCanvasHandle } from '@/editor';
import { editorStore, useEditorStore } from '@/store';
import { t, useT } from '@/i18n';
import { Button, IconButton } from '../components';
import { uiStore } from '../uiStore';
import { useShell, shellStore } from './shellStore';

/**
 * First-run call to action on an EMPTY sheet. The canvas draws its own hint text; this adds the three starting points.
 * "Add an entity / a table" creates the element at the visible centre and starts the inline rename, exactly like a click-to-place.
 */
export function Welcome({ canvas, diagramId }: { canvas: RefObject<DiagramCanvasHandle | null>; diagramId: string }) {
  const tr = useT();
  const hidden = useShell((s) => s.welcomeHidden || s.welcomeDismissed);
  const kind = useEditorStore((s) => {
    const d = s.project.diagrams[diagramId];
    return d ? s.project.models[d.modelId]?.kind : undefined;
  });
  if (hidden) return null;
  const er = kind === 'er';

  const addFirst = (): void => {
    const handle = canvas.current;
    if (!handle) return;
    const res = createFromLibraryItem(editorStore, diagramId, er ? { kind: 'entity' } : { kind: 'relation' }, handle.visibleCenter(), { zoom: handle.getViewport().zoom });
    if (!res.ok) {
      uiStore.getState().pushToast({ kind: 'error', message: t('editor.toast.createFailed', { message: res.message ?? '' }) });
      return;
    }
    if (res.rename) {
      const target = res.rename;
      requestAnimationFrame(() => handle.startInlineEdit(target));
    }
  };

  return (
    <div className="shell-welcome" data-testid="welcome">
      <div className="shell-welcome-card" role="group" aria-label={tr('shell.welcome.label')}>
        <div className="shell-welcome-actions">
          <Button variant="primary" icon="example" onClick={() => void runCommand('file.examples')}>
            {tr('shell.welcome.example')}
          </Button>
          <Button icon={er ? 'entity' : 'table'} onClick={addFirst}>
            {tr(er ? 'shell.welcome.entity' : 'shell.welcome.table')}
          </Button>
          <Button icon="import" onClick={() => void runCommand('file.import')}>
            {tr('shell.welcome.import')}
          </Button>
        </div>
        <div className="shell-welcome-foot">
          <Button variant="ghost" size="sm" onClick={() => shellStore.getState().hideWelcome(true)}>
            {tr('shell.welcome.never')}
          </Button>
          <IconButton label={tr('shell.welcome.hide')} icon="close" size="sm" onClick={() => shellStore.getState().hideWelcome(false)} />
        </div>
      </div>
    </div>
  );
}
