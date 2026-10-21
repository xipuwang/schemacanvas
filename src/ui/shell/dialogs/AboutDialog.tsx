import { useT } from '@/i18n';
import { Button, Dialog } from '../../components';
import type { DialogComponentProps } from '../../dialogs/registry';

export const APP_VERSION = '0.1.0';

export function AboutDialog({ onClose }: DialogComponentProps) {
  const t = useT();
  return (
    <Dialog title={t('shell.about.title')} size="sm" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('common.close')}</Button>}>
      <p className="shell-p">
        <strong>SchemaCanvas</strong> {APP_VERSION}
      </p>
      <p className="shell-p">{t('shell.about.description')}</p>
      <p className="shell-p shell-muted">{t('shell.about.privacy')}</p>
    </Dialog>
  );
}
