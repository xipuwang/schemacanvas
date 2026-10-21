import { describe, expect, it } from 'vitest';
import { createDiagram, createProject, defaultDiagramName } from '@/model/defaults';
import { serializeProject } from '@/model/io';
import { parseProjectFile } from '@/model/io/load';
import type { DiagramType } from '@/model/types';
import { displayDiagramName, isDefaultDiagramName } from './defaultNames';
import { t } from './index';

const TYPES: DiagramType[] = ['chen', 'relational-schema', 'crows-foot', 'physical'];

describe('default sheet names follow the UI language', () => {
  it('the English catalogue text is the stored default of every diagram type', () => {
    for (const type of TYPES) expect(t(`shell.defaultName.${type}`, undefined, 'en')).toBe(defaultDiagramName(type));
  });

  it('an untouched default shows in the viewer language; the stored name is never rewritten', () => {
    const p = createProject();
    const d = Object.values(p.diagrams)[0]!;
    expect(d.name).toBe('ER Diagram');
    expect(displayDiagramName(d, 'en')).toBe('ER Diagram');
    expect(displayDiagramName(d, 'zh')).toBe('ER 图');
    expect(d.name).toBe('ER Diagram');
    for (const type of TYPES) {
      const dgm = createDiagram(type, 'm');
      expect(displayDiagramName(dgm, 'zh')).toBe(t(`shell.defaultName.${type}`, undefined, 'zh'));
      expect(displayDiagramName(dgm, 'zh')).not.toBe(dgm.name);
    }
  });

  it('recognises the other spellings of a default: example casing, a zh default stored earlier, an empty name', () => {
    expect(displayDiagramName({ type: 'chen', name: 'ER diagram' }, 'zh')).toBe('ER 图');
    expect(displayDiagramName({ type: 'relational-schema', name: 'Relational schema' }, 'zh')).toBe('关系模式图');
    expect(displayDiagramName({ type: 'relational-schema', name: '关系模式图' }, 'en')).toBe('Relational Schema');
    expect(displayDiagramName({ type: 'chen', name: '  ' }, 'en')).toBe('ER Diagram');
  });

  it('user-chosen names are never translated, including ones that merely look similar or belong to another type', () => {
    for (const name of ['Pharmacy ER', 'ER Diagram 2', 'Copy of ER Diagram', 'Relational Schema']) {
      expect(displayDiagramName({ type: 'chen', name }, 'zh')).toBe(name);
    }
    expect(isDefaultDiagramName('chen', 'Relational Schema')).toBe(false); // the default of ANOTHER type is a user name here
    expect(isDefaultDiagramName('chen', 'Pharmacy ER')).toBe(false);
  });

  it('survives a save and reload byte-for-byte: the file format and schema version are untouched', () => {
    const p = createProject();
    const before = Object.values(p.diagrams)[0]!.name;
    const text = serializeProject(p);
    const loaded = parseProjectFile(text);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const d = Object.values(loaded.project.diagrams)[0]!;
      expect(d.name).toBe(before);
      expect(displayDiagramName(d, 'zh')).toBe('ER 图');
      expect(loaded.project.schemaVersion).toBe(p.schemaVersion);
    }
  });
});
