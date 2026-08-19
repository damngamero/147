/** Lets a view ask for a full re-render without importing main.ts (avoids a cycle). */
let renderFn: () => void = () => {};

export function setRenderer(fn: () => void): void {
  renderFn = fn;
}

export function rerender(): void {
  renderFn();
}
