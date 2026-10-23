// Test-harness only: silent mode. Loaded into the Electron main process via NODE_OPTIONS=--require.
// Windows are shown without activation and never take focus; renderer focus is emulated over CDP so
// focus-dependent assertions (view.hasFocus, caret) still hold. No product code is changed.
if (process.type === 'browser' && process.env.NOTE_TEST_FOREGROUND !== '1') {
  const { app, BrowserWindow } = require('electron');
  const P = BrowserWindow.prototype;
  P.show = function () { return this.showInactive(); };
  P.focus = function () {};
  P.moveTop = function () {};
  app.on('browser-window-created', (_e, win) => {
    const emulate = () => { try { if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3'); win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {}); } catch {} };
    win.webContents.on('did-start-loading', emulate); win.webContents.on('dom-ready', emulate); emulate();
  });
  app.focus = function () {};
}