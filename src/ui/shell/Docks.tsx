import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { settingsStore } from '@/store';
import { summarizeIssues } from '@/validation';
import { useT } from '@/i18n';
import { Badge, EmptyState, IconButton, VisuallyHidden, restoreFocusTo, trapTab } from '../components';
import { uiStore, useUi } from '../uiStore';
import { getDock, getPanel, useSlotVersion, type DockSlot, type PanelSlot } from './slots';
import { type LayoutMode } from './layout';
import { DOCK_LIMITS, shellStore, useShell } from './shellStore';
import { Resizer } from './Resizer';

function Slot({ Component, placeholder }: { Component: ComponentType | undefined; placeholder: ReactNode }) {
  return Component ? <Component /> : <>{placeholder}</>;
}

/** Library / properties dock content (registered by the panels worker; placeholder until then). */
export function PanelContent({ slot }: { slot: PanelSlot }) {
  const t = useT();
  useSlotVersion();
  return (
    <Slot
      Component={getPanel(slot)}
      placeholder={
        slot === 'library' ? (
          <EmptyState icon="entity" title={t('shell.library.emptyTitle')} description={t('shell.library.emptyDesc')} />
        ) : (
          <EmptyState icon="settings" title={t('shell.properties.emptyTitle')} description={t('shell.properties.emptyDesc')} />
        )
      }
    />
  );
}

export function useDockVisibility(mode: LayoutMode): { library: boolean; properties: boolean } {
  const panels = useStore(settingsStore, (s) => s.panels);
  const drawer = useShell((s) => s.drawer);
  return mode === 'wide' ? { library: panels.library, properties: panels.properties } : { library: drawer === 'library', properties: drawer === 'properties' };
}

/** Docked side panel (wide layout) with its resizer. */
export function SideDock({ slot }: { slot: PanelSlot }) {
  const t = useT();
  const left = slot === 'library';
  const width = useShell((s) => (left ? s.leftWidth : s.rightWidth));
  const lim = left ? DOCK_LIMITS.left : DOCK_LIMITS.right;
  const set = (w: number): void => (left ? shellStore.getState().setLeftWidth(w) : shellStore.getState().setRightWidth(w));
  const dock = (
    <aside className={`shell-dock shell-dock-${left ? 'left' : 'right'}`} style={{ width }} aria-label={t(left ? 'shell.library.label' : 'shell.properties.label')} data-testid={`dock-${slot}`}>
      <div className="shell-dock-scroll">
        <VisuallyHidden as="h2">{t(left ? 'shell.library.label' : 'shell.properties.label')}</VisuallyHidden>
        <PanelContent slot={slot} />
      </div>
    </aside>
  );
  const resizer = (
    <Resizer orientation="vertical" value={width} min={lim.min} max={lim.max} onChange={set} onReset={() => set(lim.def)} invert={!left} label={t(left ? 'shell.library.resize' : 'shell.properties.resize')} />
  );
  return left ? (
    <>
      {dock}
      {resizer}
    </>
  ) : (
    <>
      {resizer}
      {dock}
    </>
  );
}

/** Drawer / bottom sheet for the medium and narrow layouts. */
export function Drawer({ slot, mode }: { slot: PanelSlot; mode: LayoutMode }) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));
  /** Close and hand focus back to the toolbar toggle that opens this drawer (else the previous element / the canvas). */
  const close = (restoreFocus = true): void => {
    shellStore.getState().setDrawer(null);
    if (!restoreFocus) return;
    const toggle = document.querySelector<HTMLElement>(`[data-panel-toggle="${slot}"]`);
    // after the drawer unmounted
    requestAnimationFrame(() => restoreFocusTo(toggle ?? opener.current));
  };
  const left = slot === 'library';
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target || ref.current?.contains(target)) return;
      if (target.closest('.shell-toolbar,.sc-menu-layer,.sc-dialog-backdrop,.sc-tooltip')) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const title = t(left ? 'shell.library.label' : 'shell.properties.label');
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      data-testid={`drawer-${slot}`}
      className={`shell-drawer shell-drawer-${mode === 'narrow' ? 'sheet' : left ? 'left' : 'right'}`}
      style={mode === 'narrow' ? undefined : { width: left ? shellStore.getState().leftWidth : shellStore.getState().rightWidth }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        } else if (ref.current) trapTab(e, ref.current);
      }}
    >
      <div className="shell-drawer-head">
        <h2 className="shell-drawer-title">{title}</h2>
        <IconButton label={t('common.close')} icon="close" size="sm" onClick={() => close()} />
      </div>
      <div className="shell-dock-scroll">
        <PanelContent slot={slot} />
      </div>
    </aside>
  );
}

const DOCK_SLOTS: DockSlot[] = ['issues', 'sql'];

/** Bottom dock (issues / SQL). */
export function BottomDock() {
  const t = useT();
  const dock = useUi((s) => s.dock);
  const issues = useUi((s) => s.issues);
  const height = useShell((s) => s.bottomHeight);
  useSlotVersion();
  if (!dock) return null;
  const Component = getDock(dock);
  const sum = summarizeIssues(issues);
  const tabs = DOCK_SLOTS.map((slot) => (
    <button key={slot} type="button" role="tab" aria-selected={dock === slot} tabIndex={dock === slot ? 0 : -1} className={`shell-dock-tab${dock === slot ? ' is-active' : ''}`} onClick={() => uiStore.getState().setDock(slot)}>
      {t(`shell.dock.${slot}`)}
      {slot === 'issues' && sum.total > 0 ? <Badge tone={sum.error ? 'danger' : sum.warning ? 'warning' : 'info'}>{sum.total}</Badge> : null}
    </button>
  ));
  return (
    <>
      <Resizer orientation="horizontal" value={height} min={DOCK_LIMITS.bottom.min} max={DOCK_LIMITS.bottom.max} invert onChange={(h) => shellStore.getState().setBottomHeight(h)} onReset={() => shellStore.getState().setBottomHeight(DOCK_LIMITS.bottom.def)} label={t('shell.dock.resize')} />
      <section className="shell-bottom" style={{ height }} aria-label={t('shell.dock.label')} data-testid="dock-bottom">
        <div className="shell-bottom-head">
          <div
            role="tablist"
            aria-label={t('shell.dock.label')}
            className="shell-dock-tabs"
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next = DOCK_SLOTS[(DOCK_SLOTS.indexOf(dock) + 1) % DOCK_SLOTS.length]!;
                uiStore.getState().setDock(next);
                requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
              }
            }}
          >
            {tabs}
          </div>
          <IconButton label={t('shell.dock.close')} icon="close" size="sm" onClick={() => uiStore.getState().setDock(null)} />
        </div>
        <div className="shell-bottom-body" role="tabpanel" aria-label={t(`shell.dock.${dock}`)}>
          {Component ? <Component /> : <EmptyState icon={dock === 'issues' ? 'validate' : 'sql'} title={t(`shell.dock.${dock}Empty`)} description={t(`shell.dock.${dock}EmptyDesc`)} />}
        </div>
      </section>
    </>
  );
}
