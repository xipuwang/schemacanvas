import { useState } from 'react';
import { useT } from '@/i18n';
import { Button, Dialog, SegmentedControl, TextField } from '../../components';
import type { DialogComponentProps } from '../../dialogs/registry';
import { uiStore } from '../../uiStore';
import { createNewProject, type NewProjectStart } from '../files';

export function NewProjectDialog({ onClose }: DialogComponentProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [start, setStart] = useState<NewProjectStart>('chen');
  const submit = (): void => {
    onClose();
    void createNewProject(name.trim() || t('shell.newProject.defaultName'), start);
  };
  return (
    <Dialog
      title={t('shell.newProject.title')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              uiStore.getState().openDialog('examples');
            }}
          >
            {t('shell.newProject.example')}
          </Button>
          <span className="shell-tb-spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit}>
            {t('shell.newProject.create')}
          </Button>
        </>
      }
    >
      <form
        className="shell-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField label={t('shell.newProject.name')} value={name} placeholder={t('shell.newProject.defaultName')} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <div className="sc-field">
          <span className="sc-field-label" aria-hidden="true">
            {t('shell.newProject.start')}
          </span>
          <SegmentedControl
            label={t('shell.newProject.start')}
            value={start}
            onChange={setStart}
            options={[
              { value: 'chen', label: t('shell.diagramType.chen') },
              { value: 'relational-schema', label: t('shell.diagramType.relational-schema') },
            ]}
          />
          <p className="sc-field-desc">{t(start === 'chen' ? 'shell.newProject.startChenDesc' : 'shell.newProject.startRelDesc')}</p>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
