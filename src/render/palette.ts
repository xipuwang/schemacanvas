/**
 * Concrete colours handed to renderers. SVG output must contain concrete values (no CSS
 * variables) so exports render identically anywhere; the app passes the light or dark palette
 * according to the active theme, exports always use `lightPalette` on white/transparent.
 */
export interface Palette {
  background: string;
  /** Node fill. */
  surface: string;
  stroke: string;
  /** Emphasis stroke (selected-state independent), e.g. thick outlines. */
  strokeStrong: string;
  text: string;
  textMuted: string;
  /** Selection / hover accent. */
  accent: string;
  /** Tint used for key-cell backgrounds etc. */
  keyTint: string;
  fkTint: string;
  error: string;
  warning: string;
  info: string;
  gridMinor: string;
  gridMajor: string;
}

export const lightPalette: Palette = {
  background: '#ffffff',
  surface: '#ffffff',
  stroke: '#1f2937',
  strokeStrong: '#111827',
  text: '#111827',
  textMuted: '#6b7280',
  accent: '#2563eb',
  keyTint: '#fef3c7',
  fkTint: '#e0f2fe',
  error: '#dc2626',
  warning: '#d97706',
  info: '#0891b2',
  gridMinor: '#eef0f3',
  gridMajor: '#dde1e7',
};

export const darkPalette: Palette = {
  background: '#0f141a',
  surface: '#1a212b',
  stroke: '#cbd5e1',
  strokeStrong: '#f1f5f9',
  text: '#e5e9f0',
  textMuted: '#94a3b8',
  accent: '#60a5fa',
  keyTint: '#4a3c12',
  fkTint: '#123246',
  error: '#f87171',
  warning: '#fbbf24',
  info: '#22d3ee',
  gridMinor: '#1a212b',
  gridMajor: '#252e3a',
};
