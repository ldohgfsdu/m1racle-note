import {createHash} from 'node:crypto';
import {incrementalPreview} from '../../editor/preview-build.mjs';

// Keep CodeMirror/Lezer in charge of parsing, selection and transactions.
// Adapt touch geometry and keep unsupported block content visible as source.
// Vite blanks the trailing source-map directive during development. Hash the
// executable source identically in dev/build, keeping dependency changes guarded.
const upstreamHash='7f59ed021f43ae7d73757d4f5e761bd349e4fa3b085718c25920e206123dca10';
export function taskControls() {
  return {
    name:'m1racle-mobile-task-controls',enforce:'pre',
    transform(source,id) {
      if(!id.replaceAll('\\','/').split('?')[0].endsWith('/@atomic-editor/editor/dist/inline-preview.js'))return null;
      const executableSource=source.replace(/\/\/# sourceMappingURL=[^\r\n]*/g,'').trimEnd();
      if(createHash('sha256').update(executableSource).digest('hex')!==upstreamHash)throw new Error('Atomic inline-preview changed. Review mobile task controls before upgrading.');
      const replace=(before,after)=>{
        if(!source.includes(before))throw new Error(`Mobile task adapter target missing: ${before}`);
        source=source.replace(before,after);
      };
      // Mobile does not install block widgets. Keep the complete source of
      // images and tables visible, including all child delimiter/URL nodes.
      replace('tree.iterate({\n        enter: (node) => {',
        "tree.iterate({\n        enter: (node) => {\n            if (node.name === 'Image' || node.name === 'Table') return false;");
      replace("const taskLead = line.text.match(/^(\\s*[-*+]\\s+)\\[[ xX]\\]/);\n                const taskFrom = taskLead != null ? line.from + taskLead[1].length : undefined;",
        "const taskItem = nearestListItem(node.node);\n                const taskFrom = taskItem?.parent?.name === 'OrderedList' ? undefined : taskItem?.getChild('Task')?.getChild('TaskMarker')?.from;");
      replace('const padding = LIST_BASE_EM + LIST_ALCOVE_EM + depth * LIST_LEVEL_EM;',
        "const taskAlcove = `max(${LIST_ALCOVE_EM}em, var(--m1-task-target, 0px))`;\n                    const alcove = !listItem.getChild('Task') ? `${LIST_ALCOVE_EM}em` : listItem.parent?.name === 'OrderedList' ? `calc(${LIST_ALCOVE_EM}em + ${taskAlcove})` : taskAlcove;\n                    const padding = `calc(${LIST_BASE_EM + depth * LIST_LEVEL_EM}em + ${alcove})`;");
      replace('style: `padding-left: ${padding}em; text-indent: ${markerLine ? `-${LIST_ALCOVE_EM}` : \'0\'}em`,',
        'style: `--m1-task-alcove: ${taskAlcove}; padding-left: ${padding}; text-indent: ${markerLine ? `calc(0px - ${alcove})` : \'0px\'}`,');
      // A quote marker precedes the list marker on the same source line. Resolve
      // ownership at the actual parsed ListMark without changing hidden ranges.
      replace('const owner = nearestListItem(tree.resolve(contentFrom, 1));',
        'const owner = nearestListItem(tree.resolve(ownedLine.number === line.number ? node.from : contentFrom, 1));');
      replace("input.setAttribute('contenteditable', 'false');",
        "input.setAttribute('contenteditable', 'false');\n        input.setAttribute('aria-label', this.checked ? '标记为未完成' : '标记为完成');");
      // A caret is also a selection. Never reveal syntax on tap/focus, before
      // Android has finished positioning its long-press selection handles.
      // Explicit source mode removes the presentation extension instead.
      replace('if (view.hasFocus && !readOnly) {','if (false /* Document editing keeps its presentation. */) {');
      replace("if (node.name === 'Link' && view.hasFocus) {","if (false /* Destinations are edited in explicit source mode. */) {");
      replace('if (nextFrozen && !justUnfroze && !update.docChanged)',
        'if (false /* Stable presentation needs no pointer freeze. */)');
      replace('if (justUnfroze ||\n            update.docChanged ||\n            update.selectionSet ||\n            update.focusChanged ||\n            treeGrew ||\n            readOnlyChanged)',
        'if (update.docChanged || treeGrew || readOnlyChanged)');
      // The same CM6 facility used by the desktop surface skips hidden syntax;
      // it leaves native touch selection, composition and transactions to CM6.
      replace('decorations: (v) => v.decorations,',`decorations: (v) => v.decorations,
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
