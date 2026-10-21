/**
 * Inline SVG icon set on a 16px grid. Every icon is stroke-based (1.5px, round caps/joins, `currentColor`); filled
 * accents use `fill="currentColor"`. Add an icon by adding a key here — the `IconName` type follows.
 */
const circle = (cx: number, cy: number, r: number, extra = ''): string => `<circle cx="${cx}" cy="${cy}" r="${r}" ${extra}/>`;
const p = (d: string, extra = ''): string => `<path d="${d}" ${extra}/>`;
const dot = (cx: number, cy: number): string => circle(cx, cy, 0.9, 'fill="currentColor" stroke="none"');

export const ICONS = {
  select: p('M3.2 2.2l9.6 4.6-4.3 1.4-1.5 4.4z'),
  hand: p('M5.5 8.3V3.6a1 1 0 012 0V7m0-.3V2.9a1 1 0 012 0V7m0-3a1 1 0 012 0v4.6c0 2.9-1.6 4.4-4 4.4-1.9 0-3-.8-4-2.4L2.7 8.9a1 1 0 011.6-1.2l1.2 1.3'),
  undo: p('M5.5 3.5l-3 3 3 3M3 6.5h6.5a3.5 3.5 0 010 7H6'),
  redo: p('M10.5 3.5l3 3-3 3M13 6.5H6.5a3.5 3.5 0 000 7H10'),
  new: p('M4 1.5h5l3.5 3.5v9.5H4zM9 1.5V5h3.5M8.2 8v4M6.2 10h4'),
  open: p('M1.5 13V3h4l1.5 1.5h5.5V7M1.5 13l2-5.5h11.5L13 13z'),
  save: p('M2.5 2.5h9l2 2v9h-11zM5 2.5v3.5h5.2V2.5M5 13.5V9h6v4.5'),
  export: p('M8 10.5V2M5 4.7l3-3 3 3M3 9v4.5h10V9'),
  import: p('M8 2v8.5M5 7.8l3 3 3-3M3 9v4.5h10V9'),
  layout: p('M6 2.5h4v3H6zM2 10.5h4v3H2zM10 10.5h4v3h-4zM8 5.5v2.5M4 10.5V8h8v2.5'),
  validate: circle(8, 8, 6) + p('M5.2 8.2l2 2 3.6-4'),
  convert: p('M2.5 5h10.5M10.5 2.5L13 5l-2.5 2.5M13.5 11H3M5.5 8.5L3 11l2.5 2.5'),
  'zoom-in': circle(7, 7, 4.8) + p('M10.6 10.6L14 14M7 5v4M5 7h4'),
  'zoom-out': circle(7, 7, 4.8) + p('M10.6 10.6L14 14M5 7h4'),
  'zoom-fit': p('M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M5.5 5.5h5v5h-5z'),
  grid: p('M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11'),
  snap: p('M3 9.5V3h3v6.5a2 2 0 004 0V3h3v6.5a5 5 0 01-10 0zM3 6h3M10 6h3'),
  'align-left': p('M2.5 2v12M5 4h8v3H5zM5 9h5v3H5z'),
  'align-center': p('M8 2v12M3.5 4h9v3h-9zM5 9h6v3H5z'),
  'align-right': p('M13.5 2v12M3 4h8v3H3zM6 9h5v3H6z'),
  'align-top': p('M2 2.5h12M4 5h3v8H4zM9 5h3v5H9z'),
  'align-middle': p('M2 8h12M4 3.5h3v9H4zM9 5h3v6H9z'),
  'align-bottom': p('M2 13.5h12M4 3h3v8H4zM9 6h3v5H9z'),
  'distribute-h': p('M2.5 2v12M13.5 2v12M6.5 4.5h3v7h-3z'),
  'distribute-v': p('M2 2.5h12M2 13.5h12M4.5 6.5h7v3h-7z'),
  'match-size': p('M2 2.5h6v6H2zM10 6.5h4v4h-4zM3.5 12.5h9M5 11l-1.5 1.5L5 14M11 11l1.5 1.5L11 14'),
  trash: p('M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4M9.5 6.5v4'),
  copy: p('M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3'),
  paste: p('M5 3.5H3.5v10h9v-10H11M5.5 2h5v3h-5zM5.5 8.5h5M5.5 11h3'),
  cut: circle(4.5, 3.4, 1.8) + circle(4.5, 12.6, 1.8) + p('M6 4.5l8 7.5M6 11.5l8-7.5'),
  duplicate: p('M2.5 2.5h7v7h-7zM6.5 6.5h7v7h-7z'),
  lock: p('M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 015 0v2M8 10v1.5'),
  unlock: p('M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 014.8-1M8 10v1.5'),
  front: p('M5.5 5.5h8v8h-8zM2.5 10.5v-8h8'),
  back: p('M2.5 2.5h8v8h-8zM5.5 13.5h8v-8'),
  key: circle(5, 8, 3) + p('M8 8h6.5M12 8v2.5'),
  link: p('M6.8 9.2a2.5 2.5 0 003.5 0l2.2-2.2a2.5 2.5 0 00-3.5-3.5l-.7.7M9.2 6.8a2.5 2.5 0 00-3.5 0L3.5 9a2.5 2.5 0 003.5 3.5l.7-.7'),
  table: p('M1.5 5.5h13v5h-13zM5.5 5.5v5M10 5.5v5'),
  entity: p('M2 4h12v8H2z'),
  relationship: p('M8 2l6 6-6 6-6-6z'),
  attribute: '<ellipse cx="8" cy="8" rx="6" ry="4"/>',
  settings: p('M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7') + circle(10.5, 4.5, 1.5) + circle(5.5, 11.5, 1.5),
  help: circle(8, 8, 6) + p('M6.2 6.3a1.9 1.9 0 113.1 1.4c-.7.5-1.3.9-1.3 1.8') + dot(8, 11.5),
  search: circle(7, 7, 4.5) + p('M10.3 10.3L14 14'),
  'chevron-down': p('M3.5 6l4.5 4.5L12.5 6'),
  'chevron-up': p('M3.5 10l4.5-4.5L12.5 10'),
  'chevron-left': p('M10 3.5L5.5 8l4.5 4.5'),
  'chevron-right': p('M6 3.5L10.5 8 6 12.5'),
  close: p('M3.5 3.5l9 9M12.5 3.5l-9 9'),
  plus: p('M8 3v10M3 8h10'),
  minus: p('M3 8h10'),
  check: p('M3 8.5l3.2 3L13 4.5'),
  warning: p('M8 2L14.5 13.5h-13zM8 6.6v3.1') + dot(8, 11.7),
  error: circle(8, 8, 6) + p('M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4'),
  info: circle(8, 8, 6) + p('M8 7.4v3.8') + dot(8, 5.2),
  sun: circle(8, 8, 2.8) + p('M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2'),
  moon: p('M13 9.6A5.5 5.5 0 116.4 3a4.4 4.4 0 006.6 6.6z'),
  sheet: p('M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3'),
  sql: p('M2 4c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2zM2 4v4c0 1.1 2.7 2 6 2s6-.9 6-2V4M2 8v4c0 1.1 2.7 2 6 2s6-.9 6-2V8'),
  image: p('M2 3h12v10H2zM2.5 12l3.5-3.7 2.8 2.7 2-1.8 2.7 2.8') + circle(10.5, 6, 1),
  pdf: p('M4 1.5h5l3.5 3.5v9.5H4zM9 1.5V5h3.5M6.2 9h4.3M6.2 11.5h4.3'),
  folder: p('M1.5 3.5h4.5l1.5 1.5h7v8h-13z'),
  example: p('M3 2.5h8a2 2 0 012 2v9H5a2 2 0 01-2-2zM3 11.5a2 2 0 012-2h8'),
  'panel-left': p('M2 3h12v10H2zM6 3v10'),
  'panel-right': p('M2 3h12v10H2zM10 3v10'),
  'panel-bottom': p('M2 3h12v10H2zM2 9.5h12'),
  more: dot(3.5, 8) + dot(8, 8) + dot(12.5, 8),
  command: p('M5.5 5.5h5v5h-5zM5.5 5.5V4a1.5 1.5 0 10-1.5 1.5zM10.5 5.5V4A1.5 1.5 0 1112 5.5zM5.5 10.5V12A1.5 1.5 0 114 10.5zM10.5 10.5V12a1.5 1.5 0 101.5-1.5z'),
  keyboard: p('M1.5 4.5h13v7h-13zM4 7h.4M7 7h.4M10 7h.4M12.4 7h.4M5 9.5h6'),
  rename: p('M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 012 2L5.5 12.8zM9.6 4.1l2.3 2.3'),
} as const;

/** Alternative names other modules use for the same glyph (command `icon` fields). */
export const ICON_ALIASES: Record<string, keyof typeof ICONS> = {
  pointer: 'select',
  cursor: 'select',
  fit: 'zoom-fit',
  'distribute-horizontal': 'distribute-h',
  'distribute-vertical': 'distribute-v',
  'match-width': 'match-size',
  'match-height': 'match-size',
  download: 'export',
  upload: 'import',
  delete: 'trash',
};

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
export const isIconName = (name: string | undefined): name is IconName => !!name && Object.prototype.hasOwnProperty.call(ICONS, name);
/** Resolve aliases; `undefined` when the glyph does not exist. */
export const resolveIcon = (name: string | undefined): IconName | undefined => (isIconName(name) ? name : name && Object.prototype.hasOwnProperty.call(ICON_ALIASES, name) ? ICON_ALIASES[name] : undefined);
