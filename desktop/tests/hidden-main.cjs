// Test-only hidden harness. Load before the test runner and child Electron.
// The product creates every BrowserWindow with show:false; this harness keeps later show/focus calls inert.
if (!process.versions.electron && typeof require === 'function') {
  // The test runner's child_process imports share this module instance, so the
  // sync ESM export refresh is required for the wrapper to take effect.
  const childProcess = require('node:child_process');
  const moduleApi = require('node:module');
  const originalExecFileSync = childProcess.execFileSync;
  childProcess.execFileSync = function (...args) {
    const last = args.length - 1;
    const hasOptions = args[last] && typeof args[last] === 'object' && !Array.isArray(args[last]);
    if (hasOptions) args[last] = {...args[last], windowsHide: true};
    else args.push({windowsHide: true});
    return originalExecFileSync.apply(this, args);
  };
  moduleApi.syncBuiltinESMExports();
  globalThis.__noteHiddenExecFileSync = true;
}

const fatal = message => {
  process.stderr.write(`TEST_ENVIRONMENT_ERROR: ${message}\n`);
  process.exit(1);
};

const installBrowserHarness = electron => {
  if (globalThis.__noteHiddenBrowserHarnessInstalled === true) return;
  if (!(
    Boolean(electron?.app) &&
    typeof electron.BrowserWindow === 'function' &&
    Boolean(electron?.dialog)
  )) {
    fatal('Electron app, BrowserWindow, and dialog APIs are required after process.loaded');
  }

  const { app, BrowserWindow } = electron;
  const proto = BrowserWindow.prototype;
  const noOp = () => {};
  const requiredMethods = [
    [app, 'on'],
    [proto, 'show'],
    [proto, 'showInactive'],
    [proto, 'focus'],
    [proto, 'moveTop'],
    [app, 'focus'],
  ];
  for (const [owner, method] of requiredMethods) {
    if (typeof owner?.[method] !== 'function') {
      fatal(`Electron ${method} API is unavailable after process.loaded`);
    }
  }

  proto.show = noOp;
  proto.showInactive = noOp;
  proto.focus = noOp;
  proto.moveTop = noOp;
  app.focus = noOp;

  const dialogMethods = [
    'showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showErrorBox',
    'showOpenDialogSync', 'showSaveDialogSync', 'showMessageBoxSync',
  ];
  const guardError = method => {
    throw new Error(`TEST_ENVIRONMENT_ERROR: native dialog.${method} is not stubbed; call installDialogs({${method}}) before using it`);
  };
  globalThis.installDialogs = (stubs = globalThis.__noteQaDialogStubs || {}) => {
    const liveDialog = electron.dialog;
    if (!liveDialog) fatal('Electron dialog is unavailable while installing test stubs');
    globalThis.__noteQaDialogStubs = stubs;
    for (const method of dialogMethods) {
      const implementation = typeof stubs[method] === 'function'
        ? stubs[method]
        : function hiddenDialogGuard() { return guardError(method); };
      if (implementation.__noteHiddenGuard !== true) {
        Object.defineProperty(implementation, '__noteHiddenGuard', {
          value: true, configurable: false, enumerable: false, writable: false,
        });
      }
      try {
        Object.defineProperty(liveDialog, method, {
          value: implementation,
          configurable: true,
          enumerable: true,
          writable: true,
        });
      } catch (error) {
        fatal(`failed to install hidden guard for dialog.${method}: ${error?.message || error}`);
      }
      const installed = liveDialog[method];
      if (installed !== implementation || installed?.__noteHiddenGuard !== true) {
        fatal(`hidden guard verification failed for dialog.${method}`);
      }
    }
    globalThis.__noteHiddenGuardInstalled = true;
    return { installed: true, dialog: liveDialog };
  };

  installDialogs();

  globalThis.__noteHiddenBrowserWindowMode = 'native';

  app.on('browser-window-created', (_event, win) => {
    const webContents = win?.webContents;
    if (
      typeof webContents?.setBackgroundThrottling !== 'function' ||
      typeof webContents?.on !== 'function' ||
      typeof webContents?.debugger?.isAttached !== 'function' ||
      typeof webContents?.debugger?.attach !== 'function' ||
      typeof webContents?.debugger?.sendCommand !== 'function'
    ) {
      fatal('electron webContents background and focus-emulation APIs are unavailable');
    }
    win.webContents.setBackgroundThrottling(false);
    const emulate = () => {
      try {
        if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
        win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      } catch {}
    };
    win.webContents.on('did-start-loading', emulate);
    win.webContents.on('dom-ready', emulate);
    win.webContents.on('did-finish-load', emulate);
    emulate();
  });

  globalThis.__noteHiddenBrowserHarnessInstalled = true;
};

if (typeof require === 'function') {
  process.once('loaded', () => {
    try {
      if (!process.versions.electron) {
        fatal('process.loaded is unsupported outside the Electron runtime');
      }
      installBrowserHarness(require('electron'));
    } catch (error) {
      fatal(`failed to install hidden harness after process.loaded: ${error?.message || error}`);
    }
  });
}
