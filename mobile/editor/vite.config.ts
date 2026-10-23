import { defineConfig } from 'vite';
import { taskControls } from './task-controls.mjs';
export default defineConfig({
  plugins: [taskControls()],
  // The adapted ESM dependency must share the app's CodeMirror/Lezer instances.
  optimizeDeps: { exclude: ['@atomic-editor/editor'], include: [
    'react/jsx-runtime', '@codemirror/state', '@codemirror/view', '@codemirror/language',
    '@codemirror/commands', '@codemirror/lang-markdown', '@lezer/common', '@lezer/markdown', '@lezer/highlight',
  ] },
  base: './', build: { outDir: 'dist', emptyOutDir: true },
});
