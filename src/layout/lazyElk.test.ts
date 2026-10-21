/** LAYOUT-6: the ~1.4 MB ELK bundle must not be loaded (or bundled into the main chunk) until a layout is requested. */
import { expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ n: 0 }));
vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  loaded.n++;
  return importOriginal();
});

it('elkjs is imported lazily by the first layoutGraph call, once', async () => {
  const { layoutGraph } = await import('./index');
  expect(loaded.n).toBe(0); // importing the layout module (what the app entry does) loads no ELK
  const pos = await layoutGraph({ nodes: [{ id: 'a', w: 10, h: 10 }, { id: 'b', w: 10, h: 10 }], edges: [{ id: 'e', source: 'a', target: 'b' }], algorithm: 'layered' });
  expect(Object.keys(pos).sort()).toEqual(['a', 'b']);
  expect(loaded.n).toBe(1);
  await layoutGraph({ nodes: [{ id: 'a', w: 10, h: 10 }], edges: [], algorithm: 'layered' });
  expect(loaded.n).toBe(1);
});
