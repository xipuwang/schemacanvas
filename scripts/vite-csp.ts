import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Production-only Content-Security-Policy delivered as <meta http-equiv>, because GitHub Pages cannot send response headers.
 * The script-src hashes are computed from the inline scripts of each built HTML page, so the pin can never go stale.
 * frame-ancestors / report-uri / sandbox are not allowed in a meta CSP (browsers ignore them with a console error), so they are
 * left out; framing protection needs a host that sends headers (README "Deployment"). Not applied to the dev server, where Vite
 * injects its own inline scripts. scripts/check-dist.mjs re-verifies the result.
 */
export const CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'{hashes}",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
];

export const inlineScriptHashes = (html: string): string[] =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`);

export function metaCsp(): Plugin {
  return {
    name: 'schemacanvas-meta-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = inlineScriptHashes(html);
        const policy = CSP_DIRECTIVES.join('; ').replace('{hashes}', hashes.length ? ` ${hashes.join(' ')}` : '');
        // must precede every script, so it goes right after <meta charset>
        const tags = `\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="no-referrer" />`;
        return html.replace(/(<meta charset="UTF-8" \/>)/, `$1${tags}`);
      },
    },
  };
}
