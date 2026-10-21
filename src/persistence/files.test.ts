// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFixedClock } from '@/model/clock';
import { useDeterministicIds } from '@/model/ids';
import { serializeProject } from '@/model/io';
import { sampleProject } from '@/model/io/testFixtures';
import { downloadProjectFile, openProjectFromFile, projectFileName } from './files';

let restoreIds: () => void;
let restoreClock: () => void;
beforeEach(() => {
  restoreIds = useDeterministicIds();
  restoreClock = useFixedClock('2026-01-01T00:00:00.000Z');
});
afterEach(() => {
  restoreIds();
  restoreClock();
  vi.restoreAllMocks();
});

describe('projectFileName (STORE-6)', () => {
  it('never splits a surrogate pair and strips trailing dots/DEL', () => {
    const n = projectFileName('a'.repeat(79) + '\u{1F600}tail');
    expect(() => encodeURIComponent(n)).not.toThrow();
    expect(projectFileName('name...')).toBe('name.schemacanvas.json');
    expect(projectFileName('a\u007fb')).toBe('a_b.schemacanvas.json');
  });
});

describe('projectFileName', () => {
  it('sanitises names and appends the extension', () => {
    expect(projectFileName('My Project')).toBe('My Project.schemacanvas.json');
    expect(projectFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j.schemacanvas.json');
    expect(projectFileName('  ../../etc/passwd  ')).toBe('_.._etc_passwd.schemacanvas.json');
    expect(projectFileName('')).toBe('project.schemacanvas.json');
    expect(projectFileName('...')).toBe('project.schemacanvas.json');
    expect(projectFileName('数据库设计')).toBe('数据库设计.schemacanvas.json');
    expect(projectFileName('x'.repeat(200)).length).toBe(80 + '.schemacanvas.json'.length);
    expect(projectFileName('line\nbreak\u0000')).toBe('line_break_.schemacanvas.json');
  });
});

describe('downloadProjectFile', () => {
  it('creates a Blob with the envelope JSON and clicks an anchor with the sanitised filename', async () => {
    let blob: Blob | undefined;
    const create = vi.fn((b: Blob) => ((blob = b), 'blob:fake'));
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });
    vi.useFakeTimers();
    const p = sampleProject('Pharmacy: v1');
    const name = downloadProjectFile(p, '2026-01-01T00:00:00.000Z');
    expect(name).toBe('Pharmacy_ v1.schemacanvas.json');
    expect(clicked).toEqual([{ href: 'blob:fake', download: name }]);
    expect(blob?.type).toBe('application/json');
    expect(await blob!.text()).toBe(serializeProject(p, '2026-01-01T00:00:00.000Z'));
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    vi.useRealTimers();
  });
});

describe('openProjectFromFile', () => {
  const file = (text: string) => new File([text], 'x.schemacanvas.json', { type: 'application/json' });

  it('loads a saved file back into an equal project', async () => {
    const p = sampleProject('Round');
    const r = await openProjectFromFile(file(serializeProject(p)));
    expect(r.ok && r.project).toEqual(p);
  });

  it('returns typed errors for bad content', async () => {
    expect(await openProjectFromFile(file('not json'))).toMatchObject({ ok: false, error: { code: 'not-json' } });
    expect(await openProjectFromFile(file('{"a":1}'))).toMatchObject({ ok: false, error: { code: 'wrong-format' } });
    expect(await openProjectFromFile(file(''))).toMatchObject({ ok: false, error: { code: 'not-json' } });
  });

  it('turns an unreadable file into an error result instead of rejecting', async () => {
    const f = file('x');
    Object.defineProperty(f, 'text', { value: () => Promise.reject(new Error('permission denied')) });
    const r = await openProjectFromFile(f);
    expect(r).toMatchObject({ ok: false, error: { code: 'not-json', message: expect.stringContaining('permission denied') } });
  });
});
