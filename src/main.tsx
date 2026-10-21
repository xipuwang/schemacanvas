import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/jetbrains-mono';
import './ui/theme/tokens.css';
import './index.css';
import './ui/shell/shell.css';
import { loadLocale } from './i18n';
import { settingsStore } from './store/settings';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import '@/ui/register';
import { applyThemeNow } from './ui/theme/useResolvedTheme';

applyThemeNow();

// The Chinese catalogues are a lazy chunk: when zh is the persisted language, wait for it so the first paint is already Chinese
// (a failed download falls back to English text, never to message keys).
const startLocale = settingsStore.getState().locale;
// English renders at once (nothing it needs is deferred); the deferred English issue texts follow after the first paint.
const render = (): void => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
};
if (startLocale === 'en') {
  render();
  void loadLocale('en').catch(() => undefined);
} else {
  void loadLocale(startLocale)
    .catch(() => undefined)
    .then(render)
    .then(() => loadLocale('en'))
    .catch(() => undefined);
}
