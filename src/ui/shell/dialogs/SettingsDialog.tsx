import { editorStore, settingsStore, useEditorStore, useSettings, type Locale, type ThemePreference } from '@/store';
import * as ops from '@/model/ops';
import { clearAllProjectData } from '@/persistence';
import { setLocaleLoaded, t, useT } from '@/i18n';
import { Button, Dialog, NumberField, SegmentedControl, Switch } from '../../components';
import type { DialogComponentProps } from '../../dialogs/registry';
import { uiStore } from '../../uiStore';
import { confirmDialog } from '../confirm';
import { shellStore, useShell } from '../shellStore';
import { usePersistenceStatus } from '../StatusBar';

export async function clearLocalData(): Promise<boolean> {
  const ok = await confirmDialog({ title: t('shell.settings.clearTitle'), message: t('shell.settings.clearMessage'), confirmLabel: t('shell.settings.clearConfirm'), danger: true });
  if (!ok) return false;
  // the open project is itself a stored copy in memory that autosave would write back: replace it with an empty one first
  editorStore.getState().newProject();
  const cleared = await clearAllProjectData();
  if (!cleared) {
    uiStore.getState().pushToast({ kind: 'error', message: t('shell.settings.clearFailed') });
    return false;
  }
  uiStore.getState().pushToast({ kind: 'success', message: t('shell.settings.cleared') });
  return true;
}

/** Switch the language only once its catalogues are loaded (zh is a lazy chunk), so no message key flashes. */
function changeLocale(locale: Locale): void {
  void setLocaleLoaded(locale).then((outcome) => {
    // 'superseded' means the user already picked another language: nothing failed, nothing to report
    if (outcome === 'failed') uiStore.getState().pushToast({ kind: 'error', message: t('shell.settings.languageLoadFailed') });
  });
}

export function SettingsDialog({ onClose }: DialogComponentProps) {
  const tr = useT();
  const theme = useSettings((s) => s.theme);
  const locale = useSettings((s) => s.locale);
  const live = useShell((s) => s.liveValidation);
  const diagram = useEditorStore((s) => (s.activeDiagramId ? s.project.diagrams[s.activeDiagramId] : undefined));
  const persistence = usePersistenceStatus();
  const grid = diagram?.options.grid;
  const setGrid = (patch: { visible?: boolean; snap?: boolean; size?: number }): void => {
    if (!diagram) return;
    editorStore.getState().commit(t('shell.settings.gridLabel'), (d) => ops.setDiagramOptions(d, diagram.id, { grid: patch }));
  };
  const persistText =
    persistence.state === 'unavailable'
      ? tr('shell.settings.autosaveUnavailable')
      : persistence.state === 'error'
        ? tr('shell.settings.autosaveError')
        : tr('shell.settings.autosaveOn');
  return (
    <Dialog title={tr('shell.settings.title')} size="md" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{tr('common.close')}</Button>}>
      <div className="shell-settings">
        <section>
          <h3>{tr('shell.settings.appearance')}</h3>
          <div className="shell-setting-row">
            <span id="set-theme">{tr('shell.settings.theme')}</span>
            <SegmentedControl<ThemePreference>
              label={tr('shell.settings.theme')}
              value={theme}
              onChange={(v) => settingsStore.getState().setTheme(v)}
              options={[
                { value: 'system', label: tr('shell.settings.themeSystem'), icon: 'settings' },
                { value: 'light', label: tr('shell.settings.themeLight'), icon: 'sun' },
                { value: 'dark', label: tr('shell.settings.themeDark'), icon: 'moon' },
              ]}
            />
          </div>
          <div className="shell-setting-row">
            <span>{tr('shell.settings.language')}</span>
            <SegmentedControl<Locale>
              label={tr('shell.settings.language')}
              value={locale}
              onChange={changeLocale}
              options={[
                { value: 'en', label: 'English', ariaLabel: 'English', lang: 'en' },
                { value: 'zh', label: '中文', ariaLabel: '中文 (Chinese)', lang: 'zh' },
              ]}
            />
          </div>
        </section>
        <section>
          <h3>{tr('shell.settings.editing')}</h3>
          {grid ? (
            <div className="shell-setting-stack">
              <Switch label={tr('shell.settings.showGrid')} description={tr('shell.settings.gridScope')} checked={grid.visible} onChange={(v) => setGrid({ visible: v })} />
              <Switch label={tr('shell.settings.snap')} checked={grid.snap} onChange={(v) => setGrid({ snap: v })} />
              <div className="shell-setting-number">
                <NumberField label={tr('shell.settings.gridSize')} value={grid.size} min={4} max={200} step={2} suffix="px" onChange={(v) => v !== undefined && setGrid({ size: v })} />
              </div>
            </div>
          ) : (
            <p className="shell-p shell-muted">{tr('shell.settings.noDiagram')}</p>
          )}
          <Switch label={tr('shell.settings.live')} description={tr('shell.settings.liveDesc')} checked={live} onChange={(v) => shellStore.getState().setLiveValidation(v)} />
        </section>
        <section>
          <h3>{tr('shell.settings.storage')}</h3>
          <p className="shell-p">{persistText}</p>
          <Button variant="danger" onClick={() => void clearLocalData()} icon="trash">
            {tr('shell.settings.clear')}
          </Button>
        </section>
      </div>
    </Dialog>
  );
}
