import {createHash} from 'node:crypto';
import {incrementalPreview} from '../../editor/preview-build.mjs';

// Desktop policy for Atomic 0.6.2. Source mode removes this extension;
// mobile has its own policy and neither adapter edits the installed dependency.
const upstreamHash='2a4c765a4973c6916096f950852f0ce960f7e3a5d56882763173202df4ad9b78';
export function renderedEditingPolicy() {
  return {
    name:'m1racle-rendered-editing-policy',enforce:'pre',
    transform(source,id) {
      if(!id.replaceAll('\\','/').split('?')[0].endsWith('/@atomic-editor/editor/dist/inline-preview.js'))return null;
      if(createHash('sha256').update(source).digest('hex')!==upstreamHash)throw new Error('Atomic inline-preview changed. Review the rendered-editing adapter before upgrading.');
      const replace=(before,after)=>{
        if(!source.includes(before))throw new Error(`Atomic adapter target missing: ${before}`);
        source=source.replace(before,after);
      };
      replace('if (view.hasFocus && !readOnly) {','if (false /* Document mode never reveals source on focus. */) {');
      replace("if (node.name === 'Link' && view.hasFocus) {","if (false /* Link labels stay editable without exposing destinations. */) {");
      // The image widget supports a subset of Markdown images. Unsupported
      // images must remain complete source, rather than disappearing.
      replace('tree.iterate({\n        enter: (node) => {',String.raw`tree.iterate({
        enter: (node) => {
            if (node.name === 'Image' && !/^!\[([^\]]*)\]\(([^\s)"']+)(?:\s+["'][^)]*["'])?\)$/.test(doc.sliceString(node.from, node.to))) return false;`);
      // This desktop surface never reveals syntax on selection/focus. Its
      // decorations therefore depend on document/parser changes only. The
      // separate fenced-code selection layer continues to follow CM6.
      replace('if (nextFrozen && !justUnfroze && !update.docChanged)',
        'if (false /* Stable document presentation needs no pointer freeze. */)');
      replace('if (justUnfroze ||\n            update.docChanged ||\n            update.selectionSet ||\n            update.focusChanged ||\n            treeGrew ||\n            readOnlyChanged)',
        'if (update.docChanged || treeGrew || readOnlyChanged)');
      replace('decorations: (v) => v.decorations,',`decorations: (v) => v.decorations,
    // Let CM6 skip collapsed syntax during native cursor/selection movement.
    provide: plugin => {
      let previous, ranges = Decoration.none;
      return EditorView.atomicRanges.of(view => {
        const decorations = view.plugin(plugin)?.decorations;
        if (decorations !== previous) {
          previous = decorations;
          ranges = decorations ? decorations.update({filter: (from, to, decoration) =>
            to > from && !decoration.spec.class && !decoration.spec.attributes && !decoration.spec.widget
          }) : Decoration.none;
        }
        return ranges;
      });
    },`);
      return {code:incrementalPreview(source,{selectionSensitive:false}),map:null};
    },
  };
}
