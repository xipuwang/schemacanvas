// @vitest-environment jsdom
/** Lazy registration (PERF-BUILD): kinds are registered synchronously, load on first use behind a frame, and a failed load can be retried. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { settingsStore } from '@/store';
import { uiStore } from '../../uiStore';
import { DialogHost } from '../../shell/DialogHost';
import { getDock, getPanel } from '../../shell/slots';
import { getDialog } from '../registry';
import './index';
import '../../panels/library';
import '../../panels/properties';
import '../../panels/issues';
import { lazyDialog } from './lazy';

beforeEach(() => {
  settingsStore.getState().setLocale('en');
  uiStore.setState({ dialog: null, toasts: [] });
});
afterEach(cleanup);

describe('lazy registration', () => {
  it('every content dialog, the SQL dock and the panels are registered synchronously', () => {
    for (const kind of ['convert', 'export', 'import', 'examples', 'sql', 'diagram-options'] as const) expect(getDialog(kind), kind).toBeTypeOf('function');
    expect(getDock('sql')).toBeTypeOf('function');
    expect(getDock('issues')).toBeTypeOf('function');
    expect(getPanel('library')).toBeTypeOf('function');
    expect(getPanel('properties')).toBeTypeOf('function');
  });

  it('opening a dialog shows the frame (title + spinner) first, then the real dialog', async () => {
    render(<DialogHost />);
    act(() => uiStore.getState().openDialog('export'));
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeTruthy();
    expect(screen.getByTestId('lazy-loading')).toBeTruthy();
    expect(await screen.findByTestId('export-download', {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.queryByTestId('lazy-loading')).toBeNull();
  });

  it('the SQL dock loads lazily too', async () => {
    const Dock = getDock('sql')!;
    render(<Dock />);
    expect(screen.getByTestId('lazy-loading')).toBeTruthy();
    expect(await screen.findByText(/No relational model|No SQL|CREATE TABLE|Open or create/i, {}, { timeout: 15_000 })).toBeTruthy();
  });

  it('a failed chunk shows an error frame with Retry, which loads the module again', async () => {
    let attempts = 0;
    const Flaky = lazyDialog(
      async () => {
        attempts++;
        if (attempts === 1) throw new Error('chunk failed');
        return { default: () => <p>loaded ok</p> };
      },
      { titleKey: 'dialogs.import.title', size: 'lg' },
    );
    const spy = (): void => undefined;
    const onError = console.error;
    console.error = spy; // React logs the boundary's caught error
    try {
      render(<Flaky props={{}} onClose={() => undefined} />);
      expect(await screen.findByTestId('lazy-error')).toBeTruthy();
      expect(screen.getByText('Could not load this tool')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('loaded ok')).toBeTruthy();
      expect(attempts).toBe(2);
    } finally {
      console.error = onError;
    }
  });

  it('the Chinese strings exist', () => {
    settingsStore.getState().setLocale('zh');
    const Flaky = lazyDialog(async () => ({ default: () => <p /> }), { titleKey: 'dialogs.import.title', size: 'lg' });
    render(<Flaky props={{}} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: '导入' })).toBeTruthy();
  });
});
