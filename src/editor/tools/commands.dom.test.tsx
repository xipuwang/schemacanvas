// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { t } from '@/i18n';
import * as ops from '@/model/ops';
import type { ErModel, Id, RelationalModel } from '@/model/types';
import { editorStore } from '@/store';
import { uiStore } from '@/ui/uiStore';
import { commandContext, getCommand, isCommandEnabled, runCommand } from '../commands/registry';
import { loadGlobal, nodeNamed } from '../testFixtures';
import './index';
import { toolsCommands } from './commands';
import { resetToolUi, toolUi } from './toolState';

const st = () => editorStore.getState();
let diagramId: Id;

beforeEach(() => {
  resetToolUi();
  uiStore.setState({ toasts: [] });
});
afterEach(() => {
  st().setTool('select');
});

describe('tool commands', () => {
  it('registers every command with an i18n label (en and zh) and the documented shortcuts', () => {
    for (const c of toolsCommands) {
      expect(getCommand(c.id), c.id).toBeDefined();
      expect(t(c.labelKey, undefined, 'en'), `${c.id} en`).not.toBe(c.labelKey);
      expect(t(c.labelKey, undefined, 'zh'), `${c.id} zh`).not.toBe(c.labelKey);
    }
    expect(getCommand('tool.connect')!.shortcut).toBe('C');
    expect(getCommand('tool.fk')!.shortcut).toBe('F');
    expect(getCommand('chen.addAttribute')!.shortcut).toBe('A');
  });

  it('tool.connect is for Chen diagrams, tool.fk for the relational family', () => {
    const chen = loadGlobal('chen');
    diagramId = chen.diagramId;
    expect(isCommandEnabled('tool.connect')).toBe(true);
    expect(isCommandEnabled('tool.fk')).toBe(false);
    st().setActiveDiagram(chen.setup.relId);
    expect(isCommandEnabled('tool.connect')).toBe(false);
    expect(isCommandEnabled('tool.fk')).toBe(true);
  });

  it('running the tool commands switches the tool, announces it, and a diagram switch drops a mismatching tool', async () => {
    const { diagramId: id, setup } = loadGlobal('chen');
    await runCommand('tool.connect');
    expect(st().tool).toBe('connect');
    expect(toolUi.getState().announcement).toMatch(/Connect tool/);
    st().setActiveDiagram(setup.relId);
    expect(st().tool).toBe('select');
    await runCommand('tool.fk');
    expect(st().tool).toBe('fk');
    expect(toolUi.getState().announcement).toMatch(/Foreign key tool/);
    st().setTool('select');
    expect(toolUi.getState().announcement).toMatch(/Select tool/);
    void id;
  });

  it('chen.connectSelected: two entities -> one relationship; entity + relationship -> participant; otherwise disabled', async () => {
    const { diagramId: id } = loadGlobal('chen');
    const p = st().project;
    const a = nodeNamed(p, id, 'Doctor');
    const b = nodeNamed(p, id, 'Pharmacy');
    const rel = nodeNamed(p, id, 'Contact');
    expect(isCommandEnabled('chen.connectSelected')).toBe(false);
    st().setSelection([a]);
    expect(isCommandEnabled('chen.connectSelected')).toBe(false);
    st().setSelection([a, rel]);
    // Contact is a relationship, Doctor an entity: adds Doctor as a participant
    const model = () => st().project.models[st().project.diagrams[id]!.modelId] as ErModel;
    const contact = Object.values(model().relationships).find((r) => r.name === 'Contact')!;
    const before = contact.participants.length;
    expect(isCommandEnabled('chen.connectSelected')).toBe(true);
    await runCommand('chen.connectSelected');
    expect(model().relationships[contact.id]!.participants).toHaveLength(before + 1);
    st().setSelection([a, b]);
    const count = Object.keys(model().relationships).length;
    await runCommand('chen.connectSelected');
    expect(Object.keys(model().relationships)).toHaveLength(count + 1);
    expect(st().selection.ids).toHaveLength(1);
    // relationship + relationship is not offered
    st().setSelection([rel, nodeNamed(st().project, id, 'Sell')]);
    expect(isCommandEnabled('chen.connectSelected')).toBe(false);
  });

  it('chen.addAttribute / flavour commands act on the selected owner; key flavours are disabled for relationships', async () => {
    const { diagramId: id } = loadGlobal('chen');
    const model = () => st().project.models[st().project.diagrams[id]!.modelId] as ErModel;
    st().setSelection([nodeNamed(st().project, id, 'Company')]);
    expect(isCommandEnabled('chen.addKeyAttribute')).toBe(true);
    const n = Object.keys(model().attributes).length;
    await runCommand('chen.addAttribute');
    expect(Object.keys(model().attributes)).toHaveLength(n + 1);
    st().setSelection([nodeNamed(st().project, id, 'Sell')]);
    expect(isCommandEnabled('chen.addAttribute')).toBe(true);
    expect(isCommandEnabled('chen.addKeyAttribute')).toBe(false);
    expect(isCommandEnabled('chen.addSubAttribute')).toBe(false);
    st().setSelection([nodeNamed(st().project, id, 'Speciality')]);
    expect(isCommandEnabled('chen.addSubAttribute')).toBe(true);
    st().clearSelection();
    expect(isCommandEnabled('chen.addAttribute')).toBe(false);
  });

  it('edge.straighten, table.resetWidths, node.resetSize and fk.fromSelection', async () => {
    const { diagramId: id, setup } = loadGlobal('rel');
    const d = () => st().project.diagrams[id]!;
    const edgeId = Object.keys(d().edges)[0]!;
    expect(isCommandEnabled('edge.straighten')).toBe(false);
    st().commit('route', (draft) => void ops.setEdgeRoute(draft, id, edgeId, { mode: 'manual', waypoints: [{ x: 100, y: 100 }, { x: 103, y: 220 }, { x: 400, y: 224 }] }));
    st().setSelection([edgeId]);
    expect(isCommandEnabled('edge.straighten')).toBe(true);
    await runCommand('edge.straighten');
    expect(d().edges[edgeId]!.route.waypoints).toEqual([{ x: 100, y: 100 }, { x: 100, y: 220 }, { x: 400, y: 220 }]);
    expect(isCommandEnabled('edge.straighten')).toBe(true); // still manual with waypoints
    await runCommand('edge.straighten'); // no-op: already straight, no history entry
    const depth = st().undoStack.length;
    await runCommand('edge.straighten');
    expect(st().undoStack.length).toBe(depth);

    const tableNode = nodeNamed(st().project, id, 'Patient');
    const model = st().project.models[d().modelId] as RelationalModel;
    const rel = Object.values(model.relations).find((r) => r.name === 'Patient')!;
    st().commit('widths', (draft) => {
      ops.setColumnWidth(draft, id, tableNode, rel.columns[1]!.id, 200);
      ops.setNodeSize(draft, id, tableNode, { width: 500 });
    });
    st().setSelection([tableNode]);
    expect(isCommandEnabled('table.resetWidths')).toBe(true);
    await runCommand('table.resetWidths');
    expect(d().nodes[tableNode]!.columnWidths).toBeUndefined();
    expect(d().nodes[tableNode]!.width).toBeUndefined();

    st().setSelection([tableNode], { kind: 'column', relationId: rel.id, id: rel.columns[0]!.id });
    expect(isCommandEnabled('fk.fromSelection')).toBe(true);
    await runCommand('fk.fromSelection');
    expect(st().tool).toBe('fk');
    expect(toolUi.getState().fkPending).toEqual({ nodeId: tableNode, relationId: rel.id, columnIds: [rel.columns[0]!.id] });
    void setup;
    void commandContext;
  });
});
