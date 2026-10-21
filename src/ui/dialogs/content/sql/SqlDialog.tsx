import { useT } from '@/i18n';
import { Button, Dialog } from '../../../components';
import type { DialogComponentProps } from '../../registry';
import { SqlView } from './SqlView';

export function SqlDialog({ onClose }: DialogComponentProps) {
  const t = useT();
  return (
    <Dialog title={t('dialogs.sql.title')} size="xl" onClose={onClose} className="dlg-sql" bodyClassName="dlg-body-flush" footer={<Button variant="primary" onClick={onClose}>{t('common.close')}</Button>}>
      <SqlView variant="dialog" onNavigate={onClose} />
    </Dialog>
  );
}
