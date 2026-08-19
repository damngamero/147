/**
 * Builds the Windows .exe.
 *
 *   node scripts/exe.mjs
 *
 * electron-builder normally downloads Electron, unzips it to `win-unpacked.tmp`
 * and renames that folder. On this machine the rename fails with EPERM every
 * time (something keeps a handle on the freshly extracted binaries), so this
 * script unzips the cached Electron itself into `.electron-dist` and hands that
 * to electron-builder via --c.electronDist, which skips the failing step.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, '.electron-dist');
const outDir = join(root, 'release');

function electronVersion() {
  const pkg = JSON.parse(
    execFileSync(process.execPath, ['-p', "JSON.stringify(require('./package.json'))"], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  return (pkg.devDependencies.electron ?? '').replace(/^[^\d]*/, '');
}

/** Hunt the electron download cache for the matching win32-x64 zip. */
function findZip(version) {
  const roots = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'electron', 'Cache'),
    process.env.HOME && join(process.env.HOME, '.cache', 'electron'),
  ].filter(Boolean);
  const wanted = `electron-v${version}-win32-x64.zip`;

  for (const base of roots) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const full = join(base, entry);
      if (statSync(full).isDirectory()) {
        const hit = join(full, wanted);
        if (existsSync(hit)) return hit;
      } else if (entry === wanted) {
        return full;
      }
    }
  }
  return null;
}

const version = electronVersion();
const args = ['electron-builder', '--win'];

const ready = existsSync(join(distDir, 'electron.exe'));
if (!ready) {
  const zip = findZip(version);
  if (zip) {
    console.log(`Unpacking cached Electron ${version}…`);
    rmSync(distDir, { recursive: true, force: true });
    mkdirSync(distDir, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', distDir], { stdio: 'inherit', shell: true });
  } else {
    console.log(`No cached Electron ${version} zip found — letting electron-builder fetch it.`);
  }
}

if (existsSync(join(distDir, 'electron.exe'))) {
  args.push('-c.electronDist=.electron-dist');
}

// A stale temp folder from a previous failed run blocks the next one.
rmSync(join(outDir, 'win-unpacked.tmp'), { recursive: true, force: true });

execFileSync('npx', args, { cwd: root, stdio: 'inherit', shell: true });
console.log(`\nInstaller and portable exe are in ${outDir}`);
