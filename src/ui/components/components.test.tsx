// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  ColorField,
  ContextMenu,
  Dialog,
  EmptyState,
  IconButton,
  Kbd,
  MenuButton,
  NumberField,
  SegmentedControl,
  Select,
  Separator,
  Spinner,
  Switch,
  Tabs,
  TextField,
  Textarea,
  ToastHost,
  Tooltip,
  VisuallyHidden,
  type MenuEntry,
} from './index';
import { uiStore } from '../uiStore';

afterEach(() => {
  cleanup();
  uiStore.setState({ toasts: [] });
  document.body.style.overflow = '';
});

describe('Button / IconButton', () => {
  it('renders variants and respects disabled / loading', async () => {
    const onClick = vi.fn();
    render(
      <>
        <Button variant="primary" onClick={onClick}>
          Save
        </Button>
        <Button variant="danger" disabled onClick={onClick}>
          Delete
        </Button>
        <Button loading>Busy</Button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('sc-btn-primary');
    expect((screen.getByRole('button', { name: 'Busy' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('IconButton exposes its label as the accessible name and pressed state', () => {
    render(<IconButton label="Snap to grid" icon="snap" pressed />);
    const b = screen.getByRole('button', { name: 'Snap to grid' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Tooltip', () => {
  it('shows label and shortcut on focus and hides on Escape', async () => {
    render(
      <Tooltip label="Undo" shortcut="Mod+Z" delay={10}>
        <button type="button">x</button>
      </Tooltip>,
    );
    await userEvent.tab();
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('Undo');
    expect(tip.querySelector('kbd')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
  it('links the tooltip with aria-describedby when it is shown', async () => {
    render(
      <Tooltip label="Explains" delay={0}>
        <button type="button">x</button>
      </Tooltip>,
    );
    await userEvent.hover(screen.getByRole('button'));
    const tip = await screen.findByRole('tooltip');
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(tip.id);
  });
});

describe('Dialog', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        {open ? (
          <Dialog
            title="Rename"
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            footer={<Button>Done</Button>}
          >
            <input aria-label="Name" />
          </Dialog>
        ) : null}
      </>
    );
  }
  it('is modal, labelled, traps focus, locks scroll, closes on Escape and returns focus', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Rename' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    // Tab cycles within the dialog: Name -> Done -> Close(header) -> ...
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });
  it('closes from the header close button', async () => {
    const onClose = vi.fn();
    render(<Dialog title="T" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Menu', () => {
  const run = vi.fn();
  const entries = (): MenuEntry[] => [
    { id: 'a', label: 'Alpha', onSelect: () => run('a') },
    { id: 'b', label: 'Bravo', disabled: true, onSelect: () => run('b') },
    { type: 'separator' },
    { id: 'c', label: 'Charlie', checked: true, onSelect: () => run('c') },
    { id: 'd', label: 'Delta', onSelect: () => run('d') },
  ];
  const setup = () =>
    render(<MenuButton label="Actions" entries={entries} trigger={<IconButton label="Actions" icon="more" />} />);

  it('opens with click, roving focus with arrows (skipping disabled), Home/End wrap', async () => {
    run.mockClear();
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(screen.getByRole('button', { name: 'Actions' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Alpha' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitemcheckbox', { name: 'Charlie' }));
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Charlie' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Delta' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Alpha' }));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Delta' }));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Alpha' }));
  });
  it('type-ahead jumps to the matching item; Enter runs it and closes the menu', async () => {
    run.mockClear();
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.keyboard('d');
    expect(document.activeElement?.textContent).toContain('Delta');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(run).toHaveBeenCalledWith('d'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('does not run disabled items; Escape closes and returns focus to the trigger', async () => {
    run.mockClear();
    setup();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bravo' }));
    expect(run).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('opens from the keyboard (ArrowDown) and ContextMenu renders at a point', async () => {
    setup();
    screen.getByRole('button', { name: 'Actions' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeTruthy();
    cleanup();
    const onClose = vi.fn();
    render(<ContextMenu point={{ x: 10, y: 10 }} entries={entries()} label="Context" onClose={onClose} />);
    expect(screen.getByRole('menu', { name: 'Context' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Tabs and SegmentedControl', () => {
  it('Tabs: roving tabindex, arrows select and Home/End', async () => {
    function T() {
      const [v, setV] = useState('a');
      return (
        <Tabs
          label="Sections"
          value={v}
          onChange={setV}
          items={[
            { id: 'a', label: 'One', panel: <p>panel a</p> },
            { id: 'b', label: 'Two', panel: <p>panel b</p> },
            { id: 'c', label: 'Three', panel: <p>panel c</p> },
          ]}
        />
      );
    }
    render(<T />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    tabs[0]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('panel b');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Three' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe('true');
  });
  it('SegmentedControl: radiogroup semantics with arrow selection', async () => {
    const onChange = vi.fn();
    function S() {
      const [v, setV] = useState<'x' | 'y'>('x');
      return (
        <SegmentedControl
          label="Mode"
          value={v}
          onChange={(n) => {
            onChange(n);
            setV(n);
          }}
          options={[
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
          ]}
        />
      );
    }
    render(<S />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeTruthy();
    screen.getByRole('radio', { name: 'X' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('y');
    expect(screen.getByRole('radio', { name: 'Y' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('Switch / Checkbox', () => {
  it('Switch toggles with Space and exposes role=switch', async () => {
    function S() {
      const [on, setOn] = useState(false);
      return <Switch label="Snap" description="Align to grid" checked={on} onChange={setOn} />;
    }
    render(<S />);
    const sw = screen.getByRole('switch', { name: 'Snap' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-describedby')).toBeTruthy();
  });
  it('Checkbox supports label click and indeterminate', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Unique" checked={false} indeterminate onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Unique' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    await userEvent.click(screen.getByText('Unique'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('fields', () => {
  it('TextField links label, description and error state', () => {
    render(<TextField label="Name" description="Shown on the tab" error="Required" defaultValue="" />);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described.length).toBe(2);
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual(['Shown on the tab', 'Required']);
  });
  it('Textarea and Select render labelled controls', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Textarea label="Notes" defaultValue="hi" />
        <Select
          label="Dialect"
          value="generic"
          onChange={onChange}
          options={[
            { value: 'generic', label: 'Generic' },
            { value: 'sqlite', label: 'SQLite' },
          ]}
        />
      </>,
    );
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('hi');
    await userEvent.selectOptions(screen.getByLabelText('Dialect'), 'sqlite');
    expect(onChange).toHaveBeenCalledWith('sqlite');
  });
  it('NumberField commits clamped values on blur/Enter and steps with arrows', async () => {
    const onChange = vi.fn();
    function N() {
      const [v, setV] = useState<number | undefined>(10);
      return (
        <NumberField
          label="Size"
          value={v}
          min={4}
          max={20}
          onChange={(n) => {
            onChange(n);
            setV(n);
          }}
        />
      );
    }
    render(<N />);
    const input = screen.getByLabelText('Size') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '99{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(20);
    expect(input.value).toBe('20');
    await userEvent.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(19);
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    await userEvent.tab();
    expect(input.value).toBe('19'); // invalid text reverts
  });
  it('ColorField accepts valid hex and rejects invalid on blur', async () => {
    const onChange = vi.fn();
    render(<ColorField label="Fill" value="#ffcc00" onChange={onChange} />);
    const hex = screen.getAllByLabelText('Fill').find((el) => (el as HTMLInputElement).type === 'text') as HTMLInputElement;
    await userEvent.clear(hex);
    await userEvent.type(hex, '#123456');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith('#123456');
    await userEvent.clear(hex);
    await userEvent.type(hex, 'nope');
    await userEvent.tab();
    expect(hex.value).toBe('#ffcc00');
  });
});

describe('static primitives', () => {
  it('Kbd, Badge, Separator, EmptyState, Spinner, VisuallyHidden', () => {
    render(
      <>
        <Kbd>Ctrl+S</Kbd>
        <Badge tone="key">PK</Badge>
        <Separator />
        <EmptyState title="Nothing here" description="Add something" actions={<Button>Add</Button>} />
        <Spinner label="Working" />
        <VisuallyHidden>hidden text</VisuallyHidden>
      </>,
    );
    expect(screen.getByText('Ctrl+S').tagName).toBe('KBD');
    expect(screen.getByText('PK').className).toContain('sc-badge-key');
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Working');
    expect(screen.getByText('hidden text').className).toContain('visually-hidden');
  });
});

describe('ToastHost', () => {
  it('renders uiStore toasts in a live region, errors as alerts, dismissible, auto-dismiss by ttl', async () => {
    render(<ToastHost />);
    act(() => {
      uiStore.getState().pushToast({ kind: 'success', message: 'Saved file', ttl: 60 });
      uiStore.getState().pushToast({ kind: 'error', message: 'Could not open' });
    });
    expect(screen.getByRole('alert').textContent).toContain('Could not open');
    expect(screen.getByText('Saved file')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Saved file')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
