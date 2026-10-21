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

export function currentTheme(): string {
  const saved = localStorage.getItem(KEY);
  return THEMES.some((t) => t.id === saved) ? saved! : 'midnight';
}

export function applyTheme(id: string = currentTheme()): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  // Midnight lives on bare :root, so it needs no attribute.
  if (theme.id === 'midnight') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme.id);

  // Keep the phone's status bar and the desktop title bar in step.
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}

export function setTheme(id: string): void {
  localStorage.setItem(KEY, id);
  applyTheme(id);
}
