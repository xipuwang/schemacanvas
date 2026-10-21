import { getDialog, useDialogVersion } from '../dialogs/registry';
import { uiStore, useUi } from '../uiStore';
import { useT } from '@/i18n';
import { Button, Dialog } from '../components';

function Unavailable({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog title={t('shell.unavailable.title')} size="sm" onClose={onClose} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <p className="shell-p">{t('shell.unavailable.message')}</p>
    </Dialog>
  );
}

/** Renders the component registered for `uiStore.dialog.kind`. */
export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  useDialogVersion();
  if (!dialog) return null;
  const Component = getDialog(dialog.kind);
  const onClose = (): void => uiStore.getState().closeDialog();
  return Component ? <Component key={dialog.kind} props={dialog.props ?? {}} onClose={onClose} /> : <Unavailable onClose={onClose} />;
}
