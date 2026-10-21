/**
 * Primitives gallery: every design-system component in one page, used for visual review and axe scans.
 * Open /harness/shell/index.html on the dev server; `?theme=dark` forces dark.
 */
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/jetbrains-mono';
import '/src/ui/theme/tokens.css';
import '/src/index.css';
import '/src/ui/shell/shell.css';
import '/src/i18n';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  ColorField,
  Dialog,
  EmptyState,
  IconButton,
  Kbd,
  MenuButton,
  NumberField,
  Popover,
  SegmentedControl,
  Select,
  Separator,
  Spinner,
  Switch,
  Tabs,
  TextField,
  Textarea,
  ToastHost,
} from '/src/ui/components';
import { ICON_NAMES, Icon } from '/src/ui/icons';
import { uiStore } from '/src/ui/uiStore';
import { useRef } from 'react';

const theme = new URLSearchParams(location.search).get('theme');
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule)' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 14 }}>{title}</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </section>
  );
}

function Gallery() {
  const [seg, setSeg] = useState('a');
  const [tab, setTab] = useState('one');
  const [on, setOn] = useState(true);
  const [num, setNum] = useState<number | undefined>(20);
  const [dlg, setDlg] = useState(false);
  const [pop, setPop] = useState(false);
  const popAnchor = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ background: 'var(--panel)', color: 'var(--ink)', minHeight: '100vh', overflow: 'auto', height: '100vh' }}>
      <Section title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger" icon="trash">Delete</Button>
        <Button size="sm">Small</Button>
        <Button size="lg" variant="primary">Large</Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Undo" icon="undo" shortcut="Mod+Z" />
        <IconButton label="Snap" icon="snap" pressed />
        <IconButton label="Disabled" icon="redo" disabled />
        <Spinner />
        <Badge>Neutral</Badge> <Badge tone="key">PK</Badge> <Badge tone="fk">FK</Badge> <Badge tone="danger">3</Badge> <Badge tone="warning">2</Badge> <Badge tone="info">1</Badge> <Badge tone="success">OK</Badge>
        <Kbd>Ctrl+S</Kbd>
      </Section>
      <Section title="Controls">
        <SegmentedControl label="Mode" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'System' }, { value: 'b', label: 'Light' }, { value: 'c', label: 'Dark' }]} />
        <Switch label="Snap to grid" checked={on} onChange={setOn} />
        <Checkbox label="Unique" checked={on} onChange={setOn} />
        <Checkbox label="Partial" checked={false} indeterminate onChange={() => undefined} />
        <div style={{ width: 200 }}><TextField label="Name" description="Shown on the tab" defaultValue="Student" /></div>
        <div style={{ width: 200 }}><TextField label="Broken" error="Required" defaultValue="" /></div>
        <div style={{ width: 140 }}><NumberField label="Grid size" value={num} onChange={setNum} suffix="px" min={4} max={200} /></div>
        <div style={{ width: 160 }}><Select label="Dialect" value="a" onChange={() => undefined} options={[{ value: 'a', label: 'PostgreSQL' }, { value: 'b', label: 'SQLite' }]} /></div>
        <div style={{ width: 200 }}><ColorField label="Fill" value="#f0b400" onChange={() => undefined} /></div>
        <div style={{ width: 240 }}><Textarea label="Notes" rows={2} defaultValue="Free text" /></div>
      </Section>
      <Section title="Tabs">
        <div style={{ width: 420 }}>
          <Tabs label="Sections" value={tab} onChange={setTab} items={[{ id: 'one', label: 'Columns', panel: <p>Columns panel</p> }, { id: 'two', label: 'Keys', panel: <p>Keys panel</p> }, { id: 'three', label: 'Indexes', panel: <p>Indexes panel</p> }]} />
        </div>
      </Section>
      <Section title="Overlays">
        <MenuButton
          label="Menu"
          trigger={<Button>Menu</Button>}
          entries={[
            { id: 'a', label: 'Align left', icon: 'align-left', shortcut: 'Mod+Shift+L', onSelect: () => undefined },
            { id: 'b', label: 'Snap to grid', checked: true, onSelect: () => undefined },
            { type: 'separator' },
            { id: 'c', label: 'Disabled', disabled: true, onSelect: () => undefined },
            { id: 'd', label: 'Delete', icon: 'trash', danger: true, onSelect: () => undefined },
          ]}
        />
        <Button onClick={() => setDlg(true)}>Open dialog</Button>
        <Button ref={popAnchor} onClick={() => setPop((p) => !p)}>Popover</Button>
        <Popover open={pop} onClose={() => setPop(false)} anchorRef={popAnchor} label="Popover demo"><TextField label="Name" defaultValue="x" /></Popover>
        <Button onClick={() => uiStore.getState().pushToast({ kind: 'success', message: 'Saved clinic.schemacanvas.json' })}>Toast</Button>
        <Button onClick={() => uiStore.getState().pushToast({ kind: 'error', message: 'Could not open broken.json. The file is not valid JSON.' })}>Error toast</Button>
        {dlg ? <Dialog title="Rename diagram" onClose={() => setDlg(false)} footer={<><Button onClick={() => setDlg(false)}>Cancel</Button><Button variant="primary" onClick={() => setDlg(false)}>Rename</Button></>}><TextField label="Name" defaultValue="ER Diagram" /></Dialog> : null}
      </Section>
      <Section title="Empty state"><EmptyState icon="entity" title="Nothing selected" description="Select something to see its properties." actions={<Button>Action</Button>} /></Section>
      <Section title={`Icons (${ICON_NAMES.length})`}>
        {ICON_NAMES.map((n) => (
          <span key={n} title={n} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', width: 78, gap: 4, color: 'var(--ink-2)', fontSize: 11 }}>
            <Icon name={n} size={20} />
            {n}
          </span>
        ))}
      </Section>
      <Separator />
      <ToastHost />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Gallery />);
