import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  base: './',
  server: { port: 5190 },
  build: { outDir: 'dist', emptyOutDir: true },
  define: {
    // Baked in at build time so the app can tell what version it is without
    // asking the OS — used to compare against GitHub Releases for updates.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
