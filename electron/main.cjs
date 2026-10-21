const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// Windows needs this to group and pin the app against a stable identity.
app.setAppUserModelId('com.devil.app147');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5190';
const isDev = !app.isPackaged;

const UPDATE_REPO = 'damngamero/147';
const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

/** "0.2.0" -> [0, 2, 0], compared numerically part by part — same rule as src/update.ts. */
function isNewer(latest, current) {
  // Tolerates a stray dot after the v (e.g. a tag typed as "v.0.3.8").
  const a = latest.replace(/^v\.?/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.replace(/^v\.?/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// The desktop side of self-update. Unlike the sideloaded APK, the exe can
// update itself without any user-visible install wizard: the NSIS installer
// built by electron-builder supports a silent `/S` flag for a per-machine:false
// (current-user) install, so this downloads it, quits, and a helper runs it
// silently once the app is fully closed — the installer itself then opens
// the freshly-installed build (see update:install for why it's done that way). userData (where localStorage/IndexedDB live)
// is a separate folder from the install directory, so the account key and
// everything else in it survives untouched.
ipcMain.handle('update:check', async () => {
  try {
    const res = await fetch(UPDATE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) {
      return { ok: false, update: null, message: `GitHub said ${res.status} — no release found yet?` };
    }
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v\.?/i, '');
    // GitHub swaps spaces in uploaded filenames for dots (e.g. "147 Setup 0.3.5.exe" ->
    // "147.Setup.0.3.5.exe"), so match either separator.
    const asset = (rel.assets || []).find((a) => /^147[ .]Setup[ .].*\.exe$/i.test(a.name));
    const current = app.getVersion();

    if (!version || !isNewer(version, current)) {
      return { ok: true, update: null, message: `Up to date (${current}).` };
    }
    if (!asset) {
      return { ok: false, update: null, message: `${version} is out but has no installer attached yet.` };
    }
    return {
      ok: true,
      update: { version, url: asset.browser_download_url, notes: rel.body || '' },
      message: `${version} is available.`,
    };
  } catch (err) {
    return { ok: false, update: null, message: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('update:install', async (_event, url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.join(app.getPath('temp'), '147-update-installer.exe');
    fs.writeFileSync(out, buf);

    // /S = silent NSIS install, no wizard. Works without elevation because
    // the installer is built with perMachine:false (installs under the
    // current user, not Program Files).
    //
    // Two things go wrong if the installer is simply spawned and the app
    // quits a moment later:
    //  - The installer starts while 147 is still shutting down. It finds the
    //    app running, and in silent mode gives up without a word, so the
    //    next launch is still the OLD build and the update has to be done
    //    twice.
    //  - electron-builder's NSIS only relaunches the app after a SILENT
    //    install when it is passed --force-run. Without it, setup finishes
    //    and nothing opens.
    // So a hidden PowerShell waits for every 147 process to be gone (killing
    // stragglers after ~20s), then runs the installer with --force-run, which
    // opens the new build when it's done.
    const exeName = path.parse(process.execPath).name.replace(/'/g, "''");
    const installer = out.replace(/'/g, "''");
    const script = [
      `Wait-Process -Id ${process.pid} -Timeout 20 -ErrorAction SilentlyContinue`,
      `$deadline = (Get-Date).AddSeconds(20)`,
      `while ((Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }`,
      `Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
      `Start-Sleep -Milliseconds 500`,
      `Start-Process -FilePath '${installer}' -ArgumentList '/S','--force-run'`,
    ].join('; ');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();

    // A normal quit, so localStorage gets flushed to disk; the helper holds
    // off until every 147 process is actually gone.
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 780,
    minWidth: 380,
    minHeight: 520,
    backgroundColor: '#0e1015',
    autoHideMenuBar: true,
    title: '147',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Calendar links and anything else external open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// A single instance, so reopening focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
