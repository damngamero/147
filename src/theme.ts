/** Theme names map to the [data-theme] blocks in styles.css. */

const KEY = '147_theme';

export interface Theme {
  id: string;
  name: string;
  note: string;
  /** bg, surface, accent — just for the picker swatches */
  swatch: [string, string, string];
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    note: 'Dark blue. The default.',
    swatch: ['#0e1015', '#1c2230', '#7c9cff'],
  },
  {
    id: 'paper',
    name: 'Paper',
    note: 'Light, for a bright room.',
    swatch: ['#f6f7fa', '#eef1f6', '#3f62d9'],
  },
  {
    id: 'forest',
    name: 'Forest',
    note: 'Dark green, low glare.',
    swatch: ['#0b1210', '#17241f', '#5fd39b'],
  },
  {
    id: 'ember',
    name: 'Ember',
    note: 'Dark and warm for late nights.',
    swatch: ['#14100e', '#26201c', '#f0894f'],
  },
];

const ACCENT_KEY = '147_accent';

/** Ready-made accents. Any other colour works too — Settings has a free picker. */
export const ACCENTS = [
  '#7c9cff', '#5fd39b', '#f0894f', '#e8c05a', '#c07cff', '#57c7e8', '#f2778c', '#ff5fa2',
];

/** The accent override, or null to use whatever the theme comes with. */
export function currentAccent(): string | null {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function setAccent(hex: string | null): void {
  try {
    if (hex) localStorage.setItem(ACCENT_KEY, hex);
    else localStorage.removeItem(ACCENT_KEY);
  } catch {
    /* storage blocked — still applies for this session */
  }
  applyTheme(currentTheme(), hex);
}

/* ---------- colour maths for the accent shades ---------- */

type RGB = [number, number, number];

function parse(c: string): RGB | null {
  const hex = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const toHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** `amount` of the way from a to b. */
const mix = (a: RGB, b: RGB, amount: number): RGB =>
  [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as RGB;

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const ACCENT_VARS = ['--accent', '--accent-hover', '--accent-dim', '--accent-line', '--accent-fg', '--on-accent'];

/**
 * Every theme defines six accent shades by hand. A custom accent has to fill
 * all six, so they are mixed from the accent and the theme's own background
 * and text — the same accent comes out as a dark tint on Midnight and a pale
 * one on Paper, and stays readable on both.
 */
function applyAccent(hex: string | null): void {
  const root = document.documentElement;
  for (const v of ACCENT_VARS) root.style.removeProperty(v);
  const accent = hex ? parse(hex) : null;
  if (!accent) return;
  const css = getComputedStyle(root);
  const bg = parse(css.getPropertyValue('--bg')) ?? [14, 16, 21];
  const fg = parse(css.getPropertyValue('--fg')) ?? [231, 236, 245];
  const set = (v: string, c: RGB) => root.style.setProperty(v, toHex(c));
  set('--accent', accent);
  set('--accent-hover', mix(accent, fg, 0.15));
  set('--accent-dim', mix(bg, accent, 0.22));
  set('--accent-line', mix(bg, accent, 0.45));
  set('--accent-fg', mix(accent, fg, 0.45));
  // Text on a filled accent button: dark on a bright accent, white on a deep one.
  set('--on-accent', luminance(accent) > 0.4 ? [17, 19, 24] : [255, 255, 255]);
}

export function currentTheme(): string {
  const saved = localStorage.getItem(KEY);
  return THEMES.some((t) => t.id === saved) ? saved! : 'midnight';
}

export function applyTheme(id: string = currentTheme(), accent = currentAccent()): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  // Midnight lives on bare :root, so it needs no attribute.
  if (theme.id === 'midnight') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme.id);
  applyAccent(accent);

  // Keep the phone's status bar and the desktop title bar in step.
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}

export function setTheme(id: string): void {
  localStorage.setItem(KEY, id);
  applyTheme(id);
}
