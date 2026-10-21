import type { Page } from '@playwright/test';

export interface Overflow {
  selector: string;
  text: string;
  kind: string;
  detail: string;
}

/**
 * Detects clipped or escaping UI text in the live DOM (everything except the diagram SVG, whose text is geometry).
 * An element is reported when
 *  - it clips horizontally (overflow-x hidden/clip, or text-overflow: ellipsis) and its content is wider than its box,
 *  - it clips vertically (overflow-y hidden/clip, e.g. line-clamp) and its content is taller than its box,
 *  - any of its text lines is painted outside the viewport horizontally,
 *  - its text is painted outside the box of an ancestor that clips (overflow other than visible), by more than 1px.
 * Scroll containers (overflow auto/scroll) are not a problem by themselves: their children are checked against the viewport.
 * Elements that are visually hidden (screen-reader-only, 0-size, display none) are ignored.
 */
export async function detectOverflow(page: Page, scope = 'body'): Promise<Overflow[]> {
  return page.evaluate((scopeSel) => {
    const out: { selector: string; text: string; kind: string; detail: string }[] = [];
    const root = document.querySelector(scopeSel) ?? document.body;
    const vw = document.documentElement.clientWidth;
    const describe = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      for (let i = 0; cur && i < 3 && cur !== document.body; i++, cur = cur.parentElement) {
        const cls = [...cur.classList].slice(0, 2).join('.');
        const tid = cur.getAttribute('data-testid');
        parts.unshift(cur.tagName.toLowerCase() + (tid ? `[data-testid=${tid}]` : '') + (cls ? `.${cls}` : ''));
      }
      return parts.join(' > ');
    };
    const visible = (el: Element, cs: CSSStyleDeclaration): boolean => {
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) return false;
      return true;
    };
    const seen = new Set<string>();
    /** Only UI strings are in scope: text without a Chinese character is user data (names) or a product name and may be truncated by design. */
    const isUi = (el: Element): boolean => /\p{Script=Han}/u.test(el.textContent ?? '');
    const push = (el: Element, kind: string, detail: string) => {
      if (!isUi(el)) return;
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const key = `${describe(el)}|${kind}|${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ selector: describe(el), text, kind, detail });
    };
    const textRects = (el: Element): DOMRect[] => {
      const rects: DOMRect[] = [];
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType !== Node.TEXT_NODE || !(n.textContent ?? '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) rects.push(r);
      }
      return rects;
    };
    const clipsAncestors = (el: Element): Element[] => {
      const list: Element[] = [];
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') list.push(p);
      }
      return list;
    };
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (el.closest('.sc-canvas')) continue; // diagram geometry is checked by the export / editor specs
      if (['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (!visible(el, cs)) continue;
      const own = textRects(el);
      const hasText = own.length > 0 || (el instanceof HTMLInputElement && el.value !== '') || el instanceof HTMLSelectElement;
      if (!hasText) continue;
      const html = el as HTMLElement;
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis';
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (clipX && html.scrollWidth > html.clientWidth + 1 && html.clientWidth > 0) push(el, 'clip-x', `scrollWidth ${html.scrollWidth} > clientWidth ${html.clientWidth}`);
      // -webkit-line-clamp is deliberate truncation (summaries on cards); the catalogue keeps those texts short enough for 1440 px
      const clamped = (cs as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
      if (clipY && !(clamped && clamped !== 'none') && html.scrollHeight > html.clientHeight + 1 && html.clientHeight > 0) push(el, 'clip-y', `scrollHeight ${html.scrollHeight} > clientHeight ${html.clientHeight}`);
      /** True when the rect lies entirely outside a clipping ancestor: scrolled away or parked off-screen on purpose (skip links). */
      const hiddenByAncestor = (r: DOMRect): boolean =>
        clipsAncestors(el).some((anc) => {
          const ar = anc.getBoundingClientRect();
          return r.left >= ar.right || r.right <= ar.left || r.top >= ar.bottom || r.bottom <= ar.top;
        });
      for (const r of own) {
        if ((r.right > vw + 1 || r.left < -1) && !hiddenByAncestor(r)) {
          push(el, 'outside-viewport', `text spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
          break;
        }
      }
      if (own.length) {
        for (const anc of clipsAncestors(el)) {
          const ar = anc.getBoundingClientRect();
          const acs = getComputedStyle(anc);
          const hClip = acs.overflowX !== 'visible' && acs.overflowX !== 'auto' && acs.overflowX !== 'scroll';
          const vClip = acs.overflowY !== 'visible' && acs.overflowY !== 'auto' && acs.overflowY !== 'scroll';
          // partially clipped = the text crosses the edge of the clipping box (fully outside is handled above)
          const crosses = (r: DOMRect) => {
            const inter = r.left < ar.right && r.right > ar.left && r.top < ar.bottom && r.bottom > ar.top;
            return inter && ((hClip && (r.right > ar.right + 1 || r.left < ar.left - 1)) || (vClip && (r.bottom > ar.bottom + 1 || r.top < ar.top - 1)));
          };
          const bad = own.find((r) => crosses(r) && !hiddenByAncestor(r));
          // inside a scroller (auto / scroll) a half-visible row is ordinary scrolling, not clipping
          const scrolls = (hClip ? false : acs.overflowX === 'auto' || acs.overflowX === 'scroll') || (vClip ? false : acs.overflowY === 'auto' || acs.overflowY === 'scroll');
          if (scrolls) break;
          if (bad && ar.width > 4 && ar.height > 4) {
            push(el, 'outside-clip-ancestor', `text ${Math.round(bad.left)},${Math.round(bad.top)}..${Math.round(bad.right)},${Math.round(bad.bottom)} vs ${describe(anc)} ${Math.round(ar.left)},${Math.round(ar.top)}..${Math.round(ar.right)},${Math.round(ar.bottom)}`);
            break;
          }
        }
      }
    }
    return out;
  }, scope);
}
