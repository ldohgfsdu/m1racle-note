import {parser,GFM} from '@lezer/markdown';

const markdown=parser.configure(GFM);
const marks=new Set(['HeaderMark','EmphasisMark','CodeMark','LinkMark','LinkLabel','LinkTitle','StrikethroughMark']);

function plainText(source,node) {
  let text=source.slice(node.from,node.to);
  const removed=[];
  node.cursor().iterate(child=>{
    if(marks.has(child.name) || (child.name==='URL' && child.node.parent?.name!=='Autolink')) {
      removed.push({from:child.from-node.from,to:child.to-node.from});
    }
  });
  for(const range of removed.sort((a,b)=>b.from-a.from))text=text.slice(0,range.from)+text.slice(range.to);
  return text;
}

function filename(text) {
  let stem=text.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');
  stem=stem.replace(/\.md$/i,'').replace(/[. ]+$/g,'');
  if(/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem))stem='_'+stem;
  // Stay inside the existing 120 UTF-16-unit filename validation, including .md.
  stem=stem.slice(0,116).replace(/[\uD800-\uDBFF]$/,'').replace(/[. ]+$/g,'');
  return stem?stem+'.md':'';
}

// A suggestion only: never serialize the tree or write these normalized bytes.
// Only document-level headings/paragraphs name a note; code and quotes do not.
export function suggestedSaveName(raw) {
  const source=raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
  const tree=markdown.parse(source);
  let paragraph=null;
  for(let node=tree.topNode.firstChild;node;node=node.nextSibling) {
    if(/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) {
      const name=filename(plainText(source,node));
      if(name)return name;
    }
    if(!paragraph && node.name==='Paragraph')paragraph=node;
  }
  return (paragraph && filename(plainText(source,paragraph).split('\n')[0])) || '未命名.md';
}
