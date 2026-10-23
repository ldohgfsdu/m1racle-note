import { defineConfig } from 'vite';
import {renderedEditingPolicy} from './editor-policy.mjs';
export default defineConfig({base:'./',plugins:[renderedEditingPolicy()],optimizeDeps:{exclude:['@atomic-editor/editor']},build:{outDir:'../dist',emptyOutDir:true}});
