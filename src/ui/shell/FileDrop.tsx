import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { Icon } from '../icons';
import { uiStore } from '../uiStore';
import { openProjectFile } from './files';

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

/** Window-wide "drop a project file to open it" (library drags use a custom MIME and are ignored). */
export function FileDrop() {
  const t = useT();
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const overHandler = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file && /\.(sql|dbml)$/i.test(file.name)) uiStore.getState().openDialog('import', { file });
      else if (file) void openProjectFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overHandler);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overHandler);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="shell-drop" aria-hidden="true" data-testid="file-drop">
      <div className="shell-drop-box">
        <Icon name="open" size={24} />
        <span>{t('shell.drop.message')}</span>
      </div>
    </div>
  );
}
