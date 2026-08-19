const { contextBridge, ipcRenderer } = require('electron');

// Bridges the desktop self-update IPC calls into the sandboxed renderer.
// src/update.ts looks for window.desktopUpdater to tell a desktop build
// apart from the Android Capacitor build, which uses a different plugin.
contextBridge.exposeInMainWorld('desktopUpdater', {
  check: () => ipcRenderer.invoke('update:check'),
  install: (url) => ipcRenderer.invoke('update:install', url),
});
