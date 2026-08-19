/** Theme names map to the [data-theme] blocks in styles.css. */

const KEY = '147_theme';
const UPDATED_KEY = '147_theme_updated_at';

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

export function themeUpdatedAt(): number {
  return Number(localStorage.getItem(UPDATED_KEY) ?? 0);
}

export function setTheme(id: string): void {
  localStorage.setItem(KEY, id);
  localStorage.setItem(UPDATED_KEY, String(Date.now()));
  applyTheme(id);
}

/**
 * Used by cloud sync to adopt a theme pulled from another device. Deliberately
 * does not bump the update clock to now() — it keeps the remote timestamp, so
 * the same value doesn't get pushed straight back as if it were a fresh edit.
 */
export function adoptTheme(id: string, updatedAt: number): void {
  if (!THEMES.some((t) => t.id === id)) return;
  localStorage.setItem(KEY, id);
  localStorage.setItem(UPDATED_KEY, String(updatedAt));
  applyTheme(id);
}
