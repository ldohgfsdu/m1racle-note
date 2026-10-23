import {EditorSelection} from '@codemirror/state';
import {EditorView,RectangleMarker,layer} from '@codemirror/view';

// Keep CM6's selection, cursor and hit testing. Only split its background
// geometry at hard line breaks, so a newline doesn't paint the whole page.
export const compactSelection=[
  EditorView.editorAttributes.of({class:'m1-compact-selection'}),
  layer({
    above:false,
    class:'cm-compactSelectionLayer',
    update:update=>update.docChanged || update.selectionSet || update.viewportChanged,
    markers(view) {
      const markers=[];
      for(const range of view.state.selection.ranges) {
        if(range.empty)continue;
        const seen=new Set();
        for(const visible of view.visibleRanges) {
          const end=Math.min(range.to,visible.to);
          for(let pos=Math.max(range.from,visible.from);pos<end;) {
            const line=view.state.doc.lineAt(pos);
            if(!seen.has(line.from)) {
              seen.add(line.from);
              const from=Math.max(range.from,line.from),to=Math.min(range.to,line.to);
              if(from<to)markers.push(...RectangleMarker.forRange(view,'cm-selectionBackground',EditorSelection.range(from,to)));
              if(line.to<range.to && line.to>=view.viewport.from && line.to<=view.viewport.to) {
                for(const edge of RectangleMarker.forRange(view,'cm-selectionBackground',EditorSelection.cursor(line.to))) {
                  markers.push(new RectangleMarker('cm-selectionBackground',edge.left,edge.top,Math.max(3,view.defaultCharacterWidth/2),edge.height));
                }
              }
            }
            pos=line.to+1;
          }
        }
      }
      return markers;
    },
  }),
];
