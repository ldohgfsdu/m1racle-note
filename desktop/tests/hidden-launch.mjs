import { _electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const absoluteHiddenMain = fileURLToPath(new URL('./hidden-main.cjs', import.meta.url));
const hiddenLaunchMarker = Symbol.for('m1racle.note.hiddenLaunchWrapper');
const testChromiumSwitchName = 'disable-backgrounding-occluded-windows';
const launchMetadata = new WeakMap();

if (_electron.launch?.[hiddenLaunchMarker] !== true) {
  const originalLaunch = _electron.launch;

  const hiddenLaunch = async options => {
    const nextOptions = {...options};
    const args = Array.isArray(nextOptions.args) ? [...nextOptions.args] : [];
    const alreadyPrefixed = args.some((argument, index) =>
      argument === absoluteHiddenMain && ['-r', '--require'].includes(args[index - 1]));
    nextOptions.args = alreadyPrefixed
      ? args
      : ['-r', absoluteHiddenMain, ...args];

    const electronApp = await originalLaunch.call(_electron, nextOptions);
    let check;
    try {
      check = await electronApp.evaluate(({ app, BrowserWindow }) => ({
        harnessInstalled: globalThis.__noteHiddenBrowserHarnessInstalled === true,
        chromeTestSwitchEnabled: app.commandLine.hasSwitch('disable-backgrounding-occluded-windows'),
        windows: BrowserWindow.getAllWindows().map(window => ({
          isVisible: window.isVisible(),
          isFocused: window.isFocused(),
        })),
      }));
    } catch (error) {
      await electronApp.evaluate(({ app }) => app.exit(1)).catch(() => {});
      throw new Error(`TEST_ENVIRONMENT_ERROR: hidden Electron launch verification failed: ${error?.message || error}`);
    }

    const visible = check.windows.some(window => window.isVisible);
    const focused = check.windows.some(window => window.isFocused);
    if (!check.harnessInstalled || check.windows.length === 0 || visible || focused) {
      await electronApp.evaluate(({ app }) => app.exit(1)).catch(() => {});
      throw new Error(
        'TEST_ENVIRONMENT_ERROR: hidden Electron launch verification failed: ' +
        `harnessInstalled=${check.harnessInstalled}, windows=${check.windows.length}, ` +
        `visible=${visible}, focused=${focused}`,
      );
    }
    launchMetadata.set(electronApp, {
      chromeTestSwitch:testChromiumSwitchName,
      chromeTestSwitchEnabled:check.chromeTestSwitchEnabled,
    });
    return electronApp;
  };

  Object.defineProperty(hiddenLaunch, hiddenLaunchMarker, { value: true });
  _electron.launch = hiddenLaunch;
}

export function getHiddenLaunchMetadata(electronApp) {
  return launchMetadata.get(electronApp) || null;
}
