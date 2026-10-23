import {fileURLToPath} from 'node:url';

// Called only after each platform's pinned-source guard and policy adapter.
export function incrementalPreview(source,{selectionSensitive=true}={}) {
 const replace=(before,after)=>{
  if(!source.includes(before))throw new Error('Preview update adapter target missing: '+before);
  source=source.replace(before,after);
 };
 replace('function buildInlineDecorations(view) {','function buildInlineDecorations(view, region) {');
 replace('tree.iterate({\n        enter: (node) => {',`tree.iterate({
        from: region?.from ?? 0,
        to: region?.to ?? doc.length,
        enter: (node) => {
            if (region && (node.to <= region.from || node.from >= region.to)) return false;`);
 replace('    if (view.hasFocus) {\n        const head = state.selection.main.head;',
  '    if (view.hasFocus && (!region || state.selection.main.head >= region.from && state.selection.main.head <= region.to)) {\n        const head = state.selection.main.head;');
 replace('this.decorations = buildInlineDecorations(view);',
  `this.previewCache = new PreviewCache(view, buildInlineDecorations, {selectionSensitive:${selectionSensitive}});\n        this.decorations = this.previewCache.decorations;`);
 replace('this.decorations = buildInlineDecorations(update.view);',
  'this.decorations = this.previewCache.update(update, treeGrew || readOnlyChanged);');
 const runtime=fileURLToPath(new URL('./src/preview-update.mjs',import.meta.url)).replaceAll('\\','/');
 return `import {PreviewCache} from ${JSON.stringify(runtime)};\n`+source;
}
