import { useMemo, useState } from 'react';
import { formatShortcut, listCommands, type Command, type CommandGroup } from '@/editor';
import { t, useT } from '@/i18n';
import { Dialog, Kbd, TextField } from '../../components';
import type { DialogComponentProps } from '../../dialogs/registry';

const GROUP_ORDER: CommandGroup[] = ['file', 'edit', 'tools', 'view', 'arrange', 'diagram', 'help'];

const shortcutsOf = (c: Command): string[] => (c.shortcut === undefined ? [] : Array.isArray(c.shortcut) ? c.shortcut : [c.shortcut]);

export function groupedShortcuts(query: string): Array<{ group: CommandGroup; items: Array<{ command: Command; label: string; keys: string[] }> }> {
  const q = query.trim().toLowerCase();
  const items = listCommands()
    .filter((c) => shortcutsOf(c).length > 0)
    .map((command) => ({ command, label: t(command.labelKey), keys: shortcutsOf(command).map((s) => formatShortcut(s)) }))
    .filter((i) => !q || i.label.toLowerCase().includes(q) || i.keys.some((k) => k.toLowerCase().includes(q)));
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.command.group === group) })).filter((g) => g.items.length > 0);
}

export function ShortcutsDialog({ onClose }: DialogComponentProps) {
  const tr = useT();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupedShortcuts(query), [query, tr]);
  return (
    <Dialog title={tr('shell.shortcuts.title')} size="lg" onClose={onClose} description={tr('shell.shortcuts.description')}>
      <TextField label={tr('shell.shortcuts.search')} hideLabel type="search" placeholder={tr('shell.shortcuts.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="shell-shortcuts" tabIndex={0} role="region" aria-label={tr('shell.shortcuts.title')}>
        {groups.length === 0 ? <p className="shell-p shell-muted">{tr('shell.shortcuts.none')}</p> : null}
        {groups.map((g) => (
          <section key={g.group} className="shell-shortcut-group">
            <h3>{tr(`shell.group.${g.group}`)}</h3>
            <ul>
              {g.items.map((i) => (
                <li key={i.command.id}>
                  <span>{i.label}</span>
                  <span className="shell-shortcut-keys">
                    {i.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
