// Browser harness for e2e/examples: every example thumbnail (ER and relational) inline as real SVG, plus a template
// inserted into an ER and a relational diagram. Exposes `window.__examplesReady` once everything is in the DOM.
import { EXAMPLES, renderExampleThumbnail } from '@/examples';

const root = document.getElementById('root')!;
for (const ex of EXAMPLES) {
  for (const kind of ['er', 'relational'] as const) {
    const h = document.createElement('h2');
    h.textContent = `${ex.id} (${kind})`;
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.example = ex.id;
    card.dataset.kind = kind;
    card.innerHTML = renderExampleThumbnail(ex.id, kind);
    root.append(h, card);
  }
}
(window as unknown as { __examplesReady: boolean }).__examplesReady = true;
