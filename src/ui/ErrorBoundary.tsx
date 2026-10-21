import { Component, type ErrorInfo, type ReactNode } from 'react';
import { currentLocale, hasMessage, t } from '@/i18n';
import { downloadRecoverableData, requestEmptyStart, requestEmptyStartViaUrl, suspendPersistence } from '@/persistence';

/** Static text used when the catalogue itself cannot be read. Never depends on i18n. */
const STATIC = {
  en: { title: 'Something went wrong', body: 'SchemaCanvas hit an unexpected error. Your last autosave is kept in this browser and is not overwritten.', reload: 'Reload', empty: 'Start with an empty project', emptyHint: 'Does not load the stored autosave; a copy of it is kept.', download: 'Save the recovered data as a file', none: 'No stored data was found.', savedFrom: 'Saved the newest stored copy (from the {source}).', emptyFailed: 'Could not start with an empty project. Save the recovered data as a file, then clear this site\'s data.', srcAutosave: 'autosave', srcJournal: 'recovery journal', srcBackup: 'backup' },
  zh: { title: '出错了', body: 'SchemaCanvas 遇到意外错误。此浏览器中的上次自动保存内容已保留，不会被覆盖。', reload: '重新加载', empty: '以空项目重新开始', emptyHint: '不会加载已存储的自动保存内容，并会保留其副本。', download: '将恢复的数据保存为文件', none: '未找到已存储的数据。', savedFrom: '已保存最新的存储副本（来自{source}）。', emptyFailed: '无法以空项目启动。请先将恢复的数据保存为文件，然后清除此网站的数据。', srcAutosave: '自动保存', srcJournal: '恢复日志', srcBackup: '备份' },
} as const;

type Text = { title: string; body: string; reload: string; empty: string; emptyHint: string; download: string; none: string; savedFrom: string; emptyFailed: string; srcAutosave: string; srcJournal: string; srcBackup: string };

function text(): Text {
  try {
    const locale = currentLocale();
    if (hasMessage('shell.crash.title', locale)) return { title: t('shell.crash.title'), body: t('shell.crash.body'), reload: t('shell.crash.reload'), empty: t('shell.crash.empty'), emptyHint: t('shell.crash.emptyHint'), download: t('shell.crash.download'), none: t('shell.crash.downloadNone'), savedFrom: t('shell.crash.savedFrom', { source: '{source}' }), emptyFailed: t('shell.crash.emptyFailed'), srcAutosave: t('shell.crash.srcAutosave'), srcJournal: t('shell.crash.srcJournal'), srcBackup: t('shell.crash.srcBackup') };
    return STATIC[locale === 'zh' ? 'zh' : 'en'];
  } catch {
    return STATIC.en;
  }
}

interface State {
  failed: boolean;
  note?: string;
}

/**
 * Top-level safety net. After a render error ALL persistence writes are suspended for this page session (autosave
 * timer, journal on beforeunload, pagehide save), so the last good autosave stays as it was. The fallback offers a
 * reload, an empty start that does not load the stored autosave (crash-loop escape) and a download of the stored data.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    suspendPersistence(); // as early as possible: before any pending autosave timer can fire
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    suspendPersistence();
    console.error('SchemaCanvas crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const s = text();
    return (
      <div role="alert" data-testid="app-crash" style={{ padding: 32, maxWidth: 560, margin: '10vh auto', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>{s.title}</h1>
        <p style={{ margin: '0 0 20px', lineHeight: 1.5 }}>{s.body}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
          {s.reload}
        </button>
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <button
            type="button"
            data-testid="crash-empty"
            onClick={() => {
              if (requestEmptyStart()) window.location.reload();
              else if (!requestEmptyStartViaUrl()) this.setState({ note: s.emptyFailed });
            }}
            style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
          >
            {s.empty}
          </button>
          <span style={{ fontSize: 13, opacity: 0.75 }}>{s.emptyHint}</span>
          <button
            type="button"
            data-testid="crash-download"
            onClick={() => void downloadRecoverableData().then((src) => this.setState({ note: src ? s.savedFrom.replace('{source}', src === 'autosave' ? s.srcAutosave : src === 'journal' ? s.srcJournal : s.srcBackup) : s.none }), () => this.setState({ note: s.none }))}
            style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
          >
            {s.download}
          </button>
          {this.state.note ? <span style={{ fontSize: 13 }}>{this.state.note}</span> : null}
        </div>
      </div>
    );
  }
}
