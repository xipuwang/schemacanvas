import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { cancelAutoLayout, commandContext, isCommandEnabled, listCommands, runCommand, useCommand, type Command, type CommandGroup } from '@/editor';
import { hasMessage, t, useT } from '@/i18n';
import { layoutBusyStore, selectLayoutBusy } from '@/layout';
import * as ops from '@/model/ops';
import { editorStore, settingsStore, useEditorStore } from '@/store';
import { Icon } from '../icons';
import { applyDiagramOptions } from '../panels/properties/applyOptions';
import { Button, IconButton, MenuButton, Separator, Spinner, VisuallyHidden, type MenuEntry } from '../components';
import { useUi } from '../uiStore';
import { useLayoutMode } from './layout';
import { TYPE_ICON, diagramTypeLabel, newDiagramEntries } from './SheetTabs';
import { useShell } from './shellStore';

const firstShortcut = (c: Command | undefined): string | undefined => (c?.shortcut === undefined ? undefined : Array.isArray(c.shortcut) ? c.shortcut[0] : c.shortcut);

export function commandLabel(c: Command | undefined, fallbackKey: string): string {
  return c && hasMessage(c.labelKey) ? t(c.labelKey) : t(fallbackKey);
}

function useChromeSubscriptions(): void {
  useStore(settingsStore, (s) => s.panels);
  useShell((s) => s.drawer);
  useUi((s) => s.dock);
  useLayoutMode();
}

interface CommandButtonProps {
  id: string;
  /** Icon used when the command (or its icon) is not registered yet. */
  icon: string;
  /** `toolbar.*` key used when the command's own label is not registered yet. */
  fallback: string;
}

/**
 * The auto-layout button: while ELK runs (it works in a Web Worker, so the UI stays live) it shows a spinner and
 * "Laying out…", is disabled and `aria-busy`, announces itself politely, and Esc aborts the run (`cancelAutoLayout`).
 */
function AutoLayoutButton({ icon, fallback }: { icon: string; fallback: string }) {
  useChromeSubscriptions();
  const tr = useT();
  const { command, enabled, run } = useCommand('layout.auto');
  const busy = useStore(layoutBusyStore, selectLayoutBusy);
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented && cancelAutoLayout()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy]);
  return (
    <>
      <IconButton
        label={busy ? tr('shell.toolbar.layingOut') : commandLabel(command, fallback)}
        icon={command?.icon ?? icon}
        shortcut={busy ? 'Esc' : firstShortcut(command)}
        disabled={!command || !enabled || busy}
        aria-busy={busy || undefined}
        className={busy ? 'shell-layout-busy' : undefined}
        onClick={() => run()}
        data-command="layout.auto"
      >
        {busy ? (
          <span aria-hidden="true" className="shell-layout-spinner">
            <Spinner size={16} />
          </span>
        ) : null}
      </IconButton>
      <VisuallyHidden role="status" aria-live="polite">
        {busy ? tr('shell.toolbar.layingOutHint') : ''}
      </VisuallyHidden>
    </>
  );
}

/** A toolbar button bound to a command: label + shortcut tooltip, disabled gracefully when the command is missing. */
export function CommandButton({ id, icon, fallback }: CommandButtonProps) {
  useChromeSubscriptions();
  const { command, enabled, checked, run } = useCommand(id);
  return (
    <IconButton
      label={commandLabel(command, fallback)}
      icon={command?.icon ?? icon}
      shortcut={firstShortcut(command)}
      disabled={!command || !enabled}
      pressed={command?.isChecked ? checked : undefined}
      onClick={() => run()}
      data-command={id}
    />
  );
}

/** Menu entries for every command of a group, evaluated at open time (live enabled/checked state). */
export function commandEntries(groups: CommandGroup[], opts: { separateBy?: (c: Command) => string; exclude?: (c: Command) => boolean } = {}): MenuEntry[] {
  const ctx = commandContext();
  const out: MenuEntry[] = [];
  let last: string | undefined;
  for (const c of listCommands().filter((x) => groups.includes(x.group) && !opts.exclude?.(x))) {
    const bucket = opts.separateBy?.(c);
    if (bucket !== undefined && last !== undefined && bucket !== last) out.push({ type: 'separator', id: `sep-${c.id}` });
    last = bucket ?? last;
    out.push({
      id: c.id,
      label: t(c.labelKey),
      icon: c.icon,
      shortcut: firstShortcut(c),
      disabled: !isCommandEnabled(c.id),
      checked: c.isChecked ? !!c.isChecked(ctx) : undefined,
      onSelect: () => void runCommand(c.id),
    });
  }
  return out;
}

const arrangeBucket = (c: Command): string => c.id.replace(/^arrange\./, '').replace(/([A-Z0-9].*)$/, '') || c.id;
const viewBucket = (c: Command): string => (c.id.startsWith('view.togglePanel') ? 'panels' : c.id.startsWith('view.zoom') || c.id === 'view.fit' ? 'zoom' : 'other');

function CaretMenuButton({ icon, label, entries }: { icon: string; label: string; entries: () => MenuEntry[] }) {
  return (
    <MenuButton
      label={label}
      entries={entries}
      trigger={
        <IconButton label={label} icon={icon} className="has-caret">
          <Icon name="chevron-down" size={12} className="icon-caret" />
        </IconButton>
      }
    />
  );
}

export const FILE_MENU: Array<{ command: string; label: string } | 'separator'> = [
  { command: 'file.new', label: 'shell.filemenu.new' },
  { command: 'file.open', label: 'shell.filemenu.open' },
  { command: 'file.examples', label: 'shell.filemenu.examples' },
  { command: 'file.recent', label: 'shell.filemenu.recent' },
  'separator',
  { command: 'file.save', label: 'shell.filemenu.save' },
  { command: 'file.import', label: 'shell.filemenu.import' },
  { command: 'file.export', label: 'shell.filemenu.export' },
  { command: 'file.sqlDialog', label: 'shell.filemenu.sql' },
];

/** The File menu (wide and compact toolbars share it): every entry runs its command and shows its shortcut. */
export function fileMenuEntries(): MenuEntry[] {
  const byId = new Map(listCommands().map((c) => [c.id, c]));
  return FILE_MENU.map((e, i): MenuEntry => {
    if (e === 'separator') return { type: 'separator', id: `file-sep-${i}` };
    const c = byId.get(e.command);
    return {
      id: e.command,
      label: t(e.label),
      icon: c?.icon,
      shortcut: firstShortcut(c),
      disabled: !c || !isCommandEnabled(e.command),
      onSelect: () => void runCommand(e.command),
    };
  });
}

function FileMenu({ compact }: { compact: boolean }) {
  const tr = useT();
  if (compact) return <CaretMenuButton icon="folder" label={tr('shell.toolbar.file')} entries={fileMenuEntries} />;
  return (
    <MenuButton
      label={tr('shell.toolbar.file')}
      entries={fileMenuEntries}
      trigger={
        <Button variant="ghost" size="sm" className="shell-file-btn" data-testid="file-menu">
          <span>{tr('shell.toolbar.file')}</span>
          <Icon name="chevron-down" size={12} className="icon-caret" />
        </Button>
      }
    />
  );
}

/** The project name as a button that turns into an inline field (Enter / blur commit, Escape cancels). */
export function ProjectName() {
  const tr = useT();
  const name = useEditorStore((s) => s.project.name);
  const [editing, setEditing] = useState(false);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editing) return;
    done.current = false;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  const finish = (value: string | null): void => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = value?.trim();
    if (next && next !== name) editorStore.getState().commit(t('shell.project.renameLabel'), (d) => ops.renameProject(d, next));
    requestAnimationFrame(() => btn.current?.focus());
  };
  if (editing)
    return (
      <input
        ref={input}
        className="shell-project-input"
        aria-label={tr('shell.project.nameField')}
        defaultValue={name}
        maxLength={80}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(e.currentTarget.value);
          else if (e.key === 'Escape') finish(null);
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    );
  return (
    <button ref={btn} type="button" className="shell-project-name" title={tr('shell.project.rename')} aria-label={`${tr('shell.project.rename')}: ${name}`} data-testid="project-name" onClick={() => setEditing(true)}>
      <span>{name}</span>
    </button>
  );
}

/** Everything, grouped — the compact toolbar's overflow menu. */
function MoreMenu() {
  const tr = useT();
  const groups: CommandGroup[] = ['edit', 'tools', 'diagram', 'arrange', 'view', 'help'];
  return (
    <MenuButton
      label={tr('shell.toolbar.more')}
      entries={() => {
        const out: MenuEntry[] = [];
        for (const g of groups) {
          const entries = commandEntries([g]);
          if (!entries.length) continue;
          if (out.length) out.push({ type: 'separator', id: `sep-${g}` });
          out.push({ type: 'label', id: `lbl-${g}`, label: t(`shell.group.${g}`) });
          out.push(...entries);
        }
        return out;
      }}
      placement="bottom-end"
      trigger={<IconButton label={tr('shell.toolbar.more')} icon="more" />}
    />
  );
}

/** Entries of the Diagram type menu: create a sheet of each type from the current model, plus the Crow's Foot orientation. */
export function diagramTypeEntries(): MenuEntry[] {
  const out: MenuEntry[] = [{ type: 'label', id: 'dt-new', label: t('shell.toolbar.diagramTypeNew') }, ...newDiagramEntries()];
  const { project, activeDiagramId } = editorStore.getState();
  const active = activeDiagramId ? project.diagrams[activeDiagramId] : undefined;
  if (active?.type === 'crows-foot') {
    const current = active.options.crowsFoot?.orientation ?? 'horizontal';
    out.push({ type: 'separator', id: 'dt-sep' }, { type: 'label', id: 'dt-orient', label: t('shell.toolbar.diagramTypeOrientation') });
    for (const orientation of ['horizontal', 'vertical'] as const)
      out.push({
        id: `dt-${orientation}`,
        label: t(`shell.toolbar.orientation.${orientation}`),
        checked: current === orientation,
        onSelect: () => void applyDiagramOptions(active.id, t('shell.toolbar.orientationLabel'), { crowsFoot: { orientation } }),
      });
  }
  return out;
}

/** The toolbar's "Diagram type" control: shows the active sheet's type; the menu creates sheets of each type / switches orientation. */
function DiagramTypeMenu() {
  const tr = useT();
  const type = useEditorStore((s) => (s.activeDiagramId ? s.project.diagrams[s.activeDiagramId]?.type : undefined));
  const label = type ? diagramTypeLabel(type) : tr('shell.toolbar.diagramType');
  return (
    <MenuButton
      label={tr('shell.toolbar.diagramType')}
      entries={diagramTypeEntries}
      trigger={
        <Button variant="ghost" size="sm" className="shell-type-btn" icon={type ? TYPE_ICON[type] : 'entity'} aria-label={tr('shell.toolbar.diagramTypeValue', { type: label })} title={label} data-testid="diagram-type-menu">
          <span className="shell-type-label">{label}</span>
          <Icon name="chevron-down" size={12} className="icon-caret" />
        </Button>
      }
    />
  );
}

function Group({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="shell-tb-group">
      {children}
    </div>
  );
}

function usePanelButton(slot: 'library' | 'properties') {
  useChromeSubscriptions();
  return useCommand(`view.togglePanel.${slot}`);
}

function PanelToggle({ slot, fallback, icon }: { slot: 'library' | 'properties'; fallback: string; icon: string }) {
  const { command, checked, run } = usePanelButton(slot);
  return <IconButton label={commandLabel(command, fallback)} icon={icon} shortcut={firstShortcut(command)} pressed={command?.isChecked ? checked : undefined} onClick={() => run()} disabled={!command} data-panel-toggle={slot} />;
}

/** Roving tabindex across the toolbar's buttons (one tab stop; arrows / Home / End move). */
function useRovingFocus(root: { current: HTMLElement | null }): void {
  const current = useRef<HTMLElement | null>(null);
  /** Focus is (believed to be) in the toolbar: a control disabled under it must hand focus to its neighbour. */
  const inside = useRef(false);
  const all = (): HTMLElement[] => [...(root.current?.querySelectorAll<HTMLElement>('button') ?? [])];
  const enabled = (): HTMLElement[] => all().filter((b) => !(b as HTMLButtonElement).disabled);
  /** The enabled button nearest to `from` (the next one first, then the previous). */
  const neighbour = (from: HTMLElement | null): HTMLElement | undefined => {
    const list = all();
    const i = from ? list.indexOf(from) : -1;
    if (i < 0) return enabled()[0];
    return list.slice(i + 1).find((b) => !(b as HTMLButtonElement).disabled) ?? list.slice(0, i).reverse().find((b) => !(b as HTMLButtonElement).disabled);
  };
  const reconcile = (): void => {
    const list = enabled();
    let keep = current.current && list.includes(current.current) ? current.current : undefined;
    if (!keep) {
      const next = neighbour(current.current);
      const a = document.activeElement;
      // only a button that is STILL THERE but disabled hands its focus over; a removed one (the project name turning into
      // its field) must not steal focus from whatever is taking its place
      const was = current.current;
      const lostFocus = inside.current && !!was && was.isConnected && (was as HTMLButtonElement).disabled && (!a || a === document.body || a === was);
      keep = next;
      if (next && lostFocus) next.focus();
      current.current = next ?? null;
    }
    all().forEach((b) => b.setAttribute('tabindex', b === keep ? '0' : '-1'));
  };
  useEffect(reconcile);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onFocusIn = (e: FocusEvent): void => {
      inside.current = true;
      const target = (e.target as HTMLElement).closest('button');
      if (target && el.contains(target)) {
        current.current = target;
        all().forEach((b) => b.setAttribute('tabindex', b === target ? '0' : '-1'));
      }
    };
    const onFocusOut = (e: FocusEvent): void => {
      if (e.relatedTarget && !el.contains(e.relatedTarget as Node)) inside.current = false;
    };
    const onDocDown = (e: PointerEvent): void => {
      if (!el.contains(e.target as Node)) inside.current = false;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      if ((e.target as HTMLElement).closest('[role="menu"]')) return;
      const list = enabled();
      const i = list.indexOf((e.target as HTMLElement).closest('button') as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    };
    // a button disabled by the action it just ran (Undo at the bottom of the history, Convert on the new sheet)
    const mo = new MutationObserver(reconcile);
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    el.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDocDown, true);
    return () => {
      mo.disconnect();
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
      el.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDocDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Toolbar() {
  const tr = useT();
  const mode = useLayoutMode();
  const root = useRef<HTMLDivElement>(null);
  useRovingFocus(root);
  const compact = mode === 'narrow';
  return (
    <div ref={root} role="toolbar" aria-label={tr('shell.toolbar.label')} className="shell-toolbar">
      {compact ? (
        <>
          <FileMenu compact />
          <ProjectName />
          <CommandButton id="edit.undo" icon="undo" fallback="shell.toolbar.undo" />
          <CommandButton id="edit.redo" icon="redo" fallback="shell.toolbar.redo" />
          <span className="shell-tb-spacer" />
          <PanelToggle slot="library" fallback="shell.toolbar.library" icon="panel-left" />
          <PanelToggle slot="properties" fallback="shell.toolbar.properties" icon="panel-right" />
          <MoreMenu />
        </>
      ) : (
        <>
          <span className="shell-wordmark" aria-hidden="true">
            Schema<span>Canvas</span>
          </span>
          <ProjectName />
          <Group label={tr('shell.toolbar.file')}>
            <FileMenu compact={false} />
            <CommandButton id="file.new" icon="new" fallback="shell.toolbar.new" />
            <CommandButton id="file.open" icon="open" fallback="shell.toolbar.open" />
            <CommandButton id="file.save" icon="save" fallback="shell.toolbar.save" />
          </Group>
          <Separator orientation="vertical" />
          <Group label={tr('shell.toolbar.edit')}>
            <CommandButton id="edit.undo" icon="undo" fallback="shell.toolbar.undo" />
            <CommandButton id="edit.redo" icon="redo" fallback="shell.toolbar.redo" />
          </Group>
          <Separator orientation="vertical" />
          <Group label={tr('shell.toolbar.tools')}>
            <CommandButton id="tool.select" icon="select" fallback="shell.toolbar.select" />
            <CommandButton id="tool.hand" icon="hand" fallback="shell.toolbar.hand" />
          </Group>
          <Separator orientation="vertical" />
          <Group label={tr('shell.toolbar.diagram')}>
            <DiagramTypeMenu />
            <CaretMenuButton icon="align-left" label={tr('shell.toolbar.arrange')} entries={() => commandEntries(['arrange'], { separateBy: arrangeBucket })} />
            <AutoLayoutButton icon="layout" fallback="shell.toolbar.autoLayout" />
            <CommandButton id="diagram.validate" icon="validate" fallback="shell.toolbar.validate" />
            <CommandButton id="diagram.convert" icon="convert" fallback="shell.toolbar.convert" />
          </Group>
          <Separator orientation="vertical" />
          <Group label={tr('shell.toolbar.view')}>
            <CaretMenuButton icon="zoom-fit" label={tr('shell.toolbar.viewMenu')} entries={() => commandEntries(['view'], { separateBy: viewBucket })} />
          </Group>
          <Separator orientation="vertical" />
          <Group label={tr('shell.toolbar.export')}>
            <CommandButton id="file.export" icon="export" fallback="shell.toolbar.export" />
          </Group>
          <span className="shell-tb-spacer" />
          <Group label={tr('shell.toolbar.app')}>
            <CommandButton id="palette.open" icon="command" fallback="shell.toolbar.palette" />
            <CommandButton id="settings" icon="settings" fallback="shell.toolbar.settings" />
            <CommandButton id="help.shortcuts" icon="help" fallback="shell.toolbar.help" />
          </Group>
          <Separator orientation="vertical" />
          <Group label={tr('shell.toolbar.panels')}>
            <PanelToggle slot="library" fallback="shell.toolbar.library" icon="panel-left" />
            <PanelToggle slot="properties" fallback="shell.toolbar.properties" icon="panel-right" />
          </Group>
        </>
      )}
    </div>
  );
}

