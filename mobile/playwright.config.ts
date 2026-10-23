import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({ testDir: './tests/browser', workers: 1, timeout: 60000,
 use: { headless: true }, webServer: { cwd: fileURLToPath(new URL('..', import.meta.url)), command: 'node node_modules/vite/bin/vite.js mobile/editor --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true } });
