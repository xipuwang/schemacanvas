import { useRef } from 'react';
import { useT } from '@/i18n';
import { Button, Dialog } from '../../components';
import type { DialogComponentProps } from '../../dialogs/registry';

export function ConfirmDialog({ props, onClose }: DialogComponentProps) {
  const t = useT();
  const { title, message, confirmLabel, cancelLabel, danger, resolve } = props as {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    resolve?: (ok: boolean) => void;
  };
  const answered = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const answer = (ok: boolean): void => {
    if (!answered.current) {
      answered.current = true;
      resolve?.(ok);
    }
    onClose();
  };
  return (
    <Dialog
      title={title}
      size="sm"
      hideClose
      onClose={() => answer(false)}
      initialFocusRef={danger ? cancelRef : undefined}
      footer={
        <>
          <Button ref={cancelRef} onClick={() => answer(false)}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
            {confirmLabel ?? t('common.ok')}
          </Button>
        </>
      }
    >
      <p className="shell-p">{message}</p>
    </Dialog>
  );
}
