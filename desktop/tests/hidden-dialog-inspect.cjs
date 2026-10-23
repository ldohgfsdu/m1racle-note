// Diagnostic only. This intentionally creates no BrowserWindow and calls no dialog method.
const { app, dialog } = require('electron');

const describe = value => ({
  type: typeof value,
  writable: value?.writable ?? null,
  configurable: value?.configurable ?? null,
  hasGetter: typeof value?.get === 'function',
  hasSetter: typeof value?.set === 'function',
});

const inspectMethod = (dialog, method) => {
  const fn = dialog[method];
  return {
    marker: fn?.__noteHiddenGuard === true,
    type: typeof fn,
    sourcePrefix: typeof fn === 'function'
      ? Function.prototype.toString.call(fn).slice(0, 120)
      : null,
  };
};

app.whenReady().then(() => {
  const earlyDialog = dialog;
  const live = require('electron');
  const liveDialog = live.dialog;
  const repeated = require('electron').dialog;
  const methods = [
    'showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showErrorBox',
    'showOpenDialogSync', 'showSaveDialogSync', 'showMessageBoxSync',
  ];
  process.stdout.write(`${JSON.stringify({
    stage: 'ready',
    installDialogsType: typeof globalThis.installDialogs,
    guardInstalledFlag: globalThis.__noteHiddenGuardInstalled === true,
    guardStubTypes: Object.fromEntries(methods.map(method => [
      method, typeof globalThis.__noteQaDialogStubs?.[method],
    ])),
    earlyDialogMatchesLive: earlyDialog === liveDialog,
    liveDialogMatchesRepeated: liveDialog === repeated,
    sameMethodIdentity: methods.map(method => [
      method, earlyDialog[method] === liveDialog[method],
    ]),
    methodType: typeof liveDialog.showOpenDialog,
    methods: Object.fromEntries(methods.map(method => [
      method,
      {
        ...inspectMethod(liveDialog, method),
        descriptor: describe(Object.getOwnPropertyDescriptor(liveDialog, method)),
        prototypeDescriptor: describe(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(liveDialog), method)),
      },
    ])),
  })}\n`);
  app.exit(0);
}).catch(error => {
  process.stderr.write(`${JSON.stringify({
    stage: 'failed',
    error: String(error?.stack || error),
  })}\n`);
  app.exit(1);
});
