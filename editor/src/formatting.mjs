import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {EditorSelection} from '@codemirror/state';

// Format only visible text, preserving surrounding whitespace byte for byte.
export function inlineFormatRange(state,selection=state.selection.main) {
  let {from,to}=selection;
  const selected=state.sliceDoc(from,to);
  if(selected){from+=selected.length-selected.trimStart().length;to-=selected.length-selected.trimEnd().length;}
  return {from,to:Math.max(from,to)};
}

const inlineNodes={bold:'StrongEmphasis',italic:'Emphasis',strike:'Strikethrough',inlinecode:'InlineCode'};
function enclosingStyle(state,type,from,to) {
  const tree=ensureSyntaxTree(state,state.doc.length,50) || syntaxTree(state);
  let node=tree.resolveInner(from,1);
  for(;node;node=node.parent)if(node.name===inlineNodes[type] && node.from<=from && node.to>=to) {
    const marks=node.getChildren(type==='inlinecode'?'CodeMark':type==='strike'?'StrikethroughMark':'EmphasisMark');
    if(marks.length>=2)return {node,open:marks[0],close:marks.at(-1)};
  }
  return null;
}
export function activeInlineStyle(state,type) {
  return state.selection.ranges.every(selection=>{const range=inlineFormatRange(state,selection);return !!enclosingStyle(state,type,range.from,range.to);});
}
export function inlineStylePlan(state,type) {
  if(state.selection.ranges.length>1)return multipleInlineStyles(state,type);
  const original=state.selection.main,{from,to}=inlineFormatRange(state);
  if(!original.empty && from===to)return null;
  const selected=state.sliceDoc(from,to),existing=enclosingStyle(state,type,from,to);
  if(existing) {
    const {node,open,close}=existing;
    const start=original.empty?open.to:Math.max(from,open.to),end=original.empty?close.from:Math.min(to,close.from);
    const marker=state.sliceDoc(open.from,open.to);
    const wrap=text=>{
      const core=text.trim();if(!core)return text;
      const leading=text.length-text.trimStart().length,trailing=text.length-text.trimEnd().length;
      return text.slice(0,leading)+marker+core+marker+(trailing?text.slice(-trailing):'');
    };
    // Splitting across a nested delimiter needs a separate range command;
    // keep the document untouched instead of emitting malformed markup.
    for(const boundary of [start,end]) {
      let inner=syntaxTree(state).resolveInner(boundary,1);
      for(;inner && inner.from>=node.from && inner.to<=node.to;inner=inner.parent) {
        const isOwner=inner.from===node.from && inner.to===node.to && inner.name===node.name;
        if(!isOwner && Object.values(inlineNodes).includes(inner.name) && inner.from<boundary && inner.to>boundary)throw new Error('这段文字包含嵌套格式，请选中完整的格式片段后再调整。');
      }
    }
    const left=wrap(state.sliceDoc(open.to,start)),text=state.sliceDoc(start,end),right=wrap(state.sliceDoc(end,close.from));
    return {changes:{from:node.from,to:node.to,insert:left+text+right},selection:original.empty?{anchor:from-(open.to-open.from)}:{anchor:node.from+left.length,head:node.from+left.length+text.length},preview:{from:start,to:end,remove:true,contentFrom:open.to,contentTo:close.from}};
  }
  const placeholders={bold:'粗体文字',italic:'斜体文字',strike:'删除线文字',inlinecode:'代码'};
  const text=selected || placeholders[type];
  if(/\n\s*\n/.test(text))throw new Error('请在同一段落内设置文字样式；跨段落可分段设置。');
  const delimiters=type==='inlinecode'?inlineCode(text):{prefix:{bold:'**',italic:'*',strike:'~~'}[type],suffix:{bold:'**',italic:'*',strike:'~~'}[type]};
  const {prefix,suffix}=delimiters;
  const plan={changes:{from,to,insert:prefix+text+suffix},selection:{anchor:from+prefix.length,head:from+prefix.length+text.length},preview:{from,to,remove:false}};
  // Check the same CM6 grammar that will render the committed range.
  const next=state.update(plan).state;ensureSyntaxTree(next,next.doc.length,50);
  if(!enclosingStyle(next,type,plan.selection.anchor,plan.selection.head))throw new Error('当前选区跨越了其他格式的边界，请选择完整文字后再应用。');
  return plan;
}

function multipleInlineStyles(state,type) {
  const remove=activeInlineStyle(state,type),parts=[];
  const pieces=state.selection.ranges.map(range=>{
    const single=state.update({selection:EditorSelection.single(range.anchor,range.head)}).state;
    const trimmed=inlineFormatRange(single),existing=enclosingStyle(single,type,trimmed.from,trimmed.to);
    // Mixed selections apply the style to the missing ranges, keeping ranges
    // which already have it. A uniformly styled selection toggles it off.
    const plan=!remove && existing?{changes:[],selection:{anchor:range.anchor,head:range.head},preview:{...trimmed,remove:false}}:inlineStylePlan(single,type);
    if(plan)parts.push(plan.preview);
    return plan || {changes:[],selection:{anchor:range.anchor,head:range.head}};
  });
  if(!parts.length)return null;
  const changes=pieces.flatMap(piece=>Array.isArray(piece.changes)?piece.changes:[piece.changes]).sort((a,b)=>a.from-b.from || a.to-b.to);
  for(let i=1;i<changes.length;i++)if(changes[i].from<changes[i-1].to)throw new Error('多处选区涉及同一段格式，请分别调整或选择完整片段。');
  let index=0;
  const result=state.changeByRange(()=>{const plan=pieces[index++];return {changes:plan.changes,range:EditorSelection.range(plan.selection.anchor,plan.selection.head)};});
  return {...result,preview:{parts,remove}};
}

export function blockChanges(state,type) {
  const {from,to,empty}=state.selection.main,doc=state.doc;
  const first=doc.lineAt(from).number,last=doc.lineAt(!empty && to>from && doc.lineAt(to).from===to?to-1:to).number;
  const lines=Array.from({length:last-first+1},(_,i)=>doc.line(first+i));
  const patterns={quote:/^> ?/,list:/^[-+*] (?!\[[ xX]\] )/,ordered:/^\d+[.)] /,task:/^[-+*] \[[ xX]\] /};
  const pattern=patterns[type],indent=line=>line.text.match(/^[ \t]*/)[0];
  const remove=lines.every(line=>pattern.test(line.text.slice(indent(line).length)));
  return lines.map((line,index)=>{
    const start=line.from+indent(line).length,body=doc.sliceString(start,line.to);
    const own=body.match(pattern)?.[0] || '';
    const existing=type==='quote'?own:body.match(/^(?:[-+*] \[[ xX]\] |[-+*] |\d+[.)] )/)?.[0] || '';
    const prefix=type==='quote'?'> ':type==='ordered'?`${index+1}. `:type==='task'?'- [ ] ':'- ';
    return {from:start,to:start+(remove?own.length:existing.length),insert:remove?'':prefix};
  });
}

const blockContexts=new WeakMap();
const formatPlans=new WeakMap();
const blockKinds=new Set(['quote','list','ordered','task']);
const unsupportedBlocks=/^(?:FencedCode|CodeBlock|Table|HTMLBlock|HorizontalRule|LinkReference|SetextHeading[12])$/;
function selectedBlockLines(state) {
  const numbers=new Set();
  for(const range of state.selection.ranges) {
    const first=state.doc.lineAt(range.from).number;
    const last=state.doc.lineAt(!range.empty && state.doc.lineAt(range.to).from===range.to?range.to-1:range.to).number;
    for(let number=first;number<=last;number++)numbers.add(number);
  }
  return [...numbers].sort((a,b)=>a-b).map(number=>state.doc.line(number));
}
function blockContext(state) {
  if(blockContexts.has(state))return blockContexts.get(state);
  const lines=selectedBlockLines(state),tree=ensureSyntaxTree(state,lines.at(-1).to,50);
  if(!tree)throw new Error('文档仍在解析，请稍后再调整段落格式。');
  const rows=[];
  for(const line of lines) {
    const nodes=[];
    tree.iterate({from:line.from,to:Math.min(state.doc.length,line.to+1),enter(node){
      if(node.from<=line.from && node.to>line.from || node.from>=line.from && node.from<line.to)nodes.push(node.node);
    }});
    if(nodes.some(node=>unsupportedBlocks.test(node.name)))throw new Error('选区包含代码、表格、HTML 或下划线标题；请保留源码结构，或先选择普通段落。');
    const items=nodes.filter(node=>node.name==='ListItem');
    if(items.length>1 || items.some(node=>state.doc.lineAt(node.from).number!==line.number || state.doc.lineAt(node.to).number!==line.number))throw new Error('选区包含嵌套或跨行列表，请先选择独立列表项，或在源码中调整结构。');
    const quotes=nodes.filter(node=>node.name==='Blockquote');
    const quoteMarks=nodes.filter(node=>node.name==='QuoteMark').sort((a,b)=>a.from-b.from);
    if(quotes.length && !quoteMarks.length && line.text.trim())throw new Error('这行延续了上一行的引用，请选择带引用标记的完整行，或在源码中调整。');
    const header=nodes.find(node=>/^ATXHeading[1-6]$/.test(node.name));
    if(header && items.length)throw new Error('列表内的标题请先在源码中调整，避免改变列表层级。');
    const bom=line.from===0 && line.text.startsWith('\ufeff')?1:0;
    const indentation=line.text.slice(bom).match(/^[ \t]*/)[0];
    const indent=indentation.length;
    if(!line.text.slice(bom).trim() && (indent>=4 || indentation.includes('\t')))throw new Error('光标位于缩进空行，请先取消缩进，再设置段落格式。');
    let start=line.from+bom+indent,end=start,kind='paragraph',number=null,checked=false;
    const listMark=nodes.find(node=>node.name==='ListMark');
    const headerMarks=header?.getChildren('HeaderMark') || [];
    let closing=null;
    if(listMark) {
      start=listMark.from;end=listMark.to;
      end+=state.sliceDoc(end,line.to).match(/^[ \t]*/)[0].length;
      const task=state.sliceDoc(end,line.to).match(/^\[([ xX])\](?:[ \t]+|$)/);
      kind=items[0]?.parent?.name==='OrderedList'?'ordered':task?'task':'list';
      if(task){end+=task[0].length;checked=task[1].toLowerCase()==='x';}
      if(kind==='ordered')number=parseInt(state.sliceDoc(listMark.from,listMark.to),10);
    }else if(header) {
      kind='heading';start=headerMarks[0].from;end=headerMarks[0].to;
      end+=state.sliceDoc(end,line.to).match(/^[ \t]*/)[0].length;
      if(headerMarks.length>1) {
        const last=headerMarks.at(-1);
        const space=state.sliceDoc(end,last.from).match(/[ \t]*$/)[0].length;
        closing={from:Math.max(end,last.from-space),to:last.to,insert:''};
      }
    }
    if(quotes.length && !listMark && !header) {
      end=quoteMarks.at(-1)?.to ?? end;
      if(state.sliceDoc(end,end+1)===' ')end++;
    }
    rows.push({line,start,end,kind,number,checked,headerLevel:header?Number(header.name.at(-1)):0,closing,quotes:quotes.length,quoteMark:quoteMarks[0] || null,blank:!line.text.slice(bom).trim()});
  }
  blockContexts.set(state,rows);return rows;
}

// One grammar-checked plan drives both the view-only preview and the committed source edits.
export function blockStylePlan(state,type) {
  const heading=type.match(/^heading-([0-6])$/),level=heading?Number(heading[1]):null;
  if(!heading && !blockKinds.has(type))throw new Error('未知段落格式。');
  const rows=blockContext(state).filter(row=>!row.blank || state.selection.main.empty);
  if(!rows.length)return null;
  if(type!=='quote' && rows.some(row=>row.quotes))throw new Error('请先取消引用，再调整其中的标题或列表，避免改变嵌套结构。');
  const active=heading?rows.every(row=>row.headerLevel===level && (level!==0 || row.kind==='paragraph')):type==='quote'?rows.every(row=>row.quotes>0):rows.every(row=>row.kind===type);
  const changes=[],preview=[];let ordinal=1;
  for(const row of rows) {
    const {line}=row;
    if(type==='quote') {
      if(active) {
        if(row.quoteMark) {
          let to=row.quoteMark.to;if(state.sliceDoc(to,to+1)===' ')to++;
          changes.push({from:row.quoteMark.from,to,insert:''});
        }
      }else if(!row.quotes)changes.push({from:line.from+(line.from===0 && line.text.startsWith('\ufeff')?1:0),to:line.from+(line.from===0 && line.text.startsWith('\ufeff')?1:0),insert:'> '});
      preview.push({from:line.from,to:line.to,type:'quote',remove:active,quoteRemains:!active || row.quotes>1,preserveTextStyle:true});
      continue;
    }
    const remove=!heading && active;
    let prefix=heading?(level?'#'.repeat(level)+' ':''):remove?'':type==='task'?`- [${row.checked?'x':' '}] `:type==='ordered'?`${ordinal}. `:'- ';
    const keep=!heading && !remove && row.kind===type;
    if(type==='ordered') {
      if(keep && row.number!==null)ordinal=row.number;
      ordinal++;
    }
    if(!keep) {
      const existing=state.sliceDoc(row.start,row.end);
      if(existing!==prefix)changes.push({from:row.start,to:row.end,insert:prefix});
      if(row.closing && (!heading || level===0))changes.push(row.closing);
    }
    const target=heading?(level?`heading-${level}`:'paragraph'):remove?'paragraph':type;
    preview.push({from:line.from,to:line.to,type:target,marker:target==='ordered'?keep?state.sliceDoc(row.start,row.end).trim():prefix.trim():target==='list'?'•':target==='task'?row.checked?'☑':'☐':'',checked:target==='task' && row.checked});
  }
  changes.sort((a,b)=>a.from-b.from || a.to-b.to);
  const changeSet=state.changes(changes);
  // A block format owns whole physical lines. Leaving the covered text
  // selected lets the next keystroke — usually Enter, to continue after the
  // heading — replace it, so the just-formatted text appears to vanish while
  // the line marker stays. Collapse one text selection to its mapped end;
  // carets and multiple selections keep CodeMirror's own mapped ranges.
  const selection=state.selection.ranges.length>1 || state.selection.main.empty?state.selection.map(changeSet):EditorSelection.cursor(changeSet.mapPos(state.selection.main.to,1));
  return {changes,selection,active,preview:{block:true,rows:preview,remove:!heading && active}};
}

export function formatPlan(state,type) {
  let plans=formatPlans.get(state);if(!plans){plans=new Map();formatPlans.set(state,plans);}
  if(plans.has(type))return plans.get(type);
  const plan=['bold','italic','strike','inlinecode'].includes(type)?inlineStylePlan(state,type):blockStylePlan(state,type);
  plans.set(type,plan);return plan;
}
export function activeFormat(state,type) {
  return ['bold','italic','strike','inlinecode'].includes(type)?activeInlineStyle(state,type):!!formatPlan(state,type)?.active;
}

export function inlineCode(text) {
  const runs=text.match(/`+/g)||[],size=Math.max(0,...runs.map(run=>run.length))+1;
  const marker='`'.repeat(size),pad=/^`|`$/.test(text)?' ':'';
  return {prefix:marker+pad,suffix:pad+marker};
}

export function tableInsertion(state) {
  // Insert beside the selection; never replace its text with a template.
  // Leave blank lines around the block so adjacent prose stays prose.
  const at=state.selection.main.to;
  const before=state.sliceDoc(Math.max(0,at-2),at),after=state.sliceDoc(at,at+2);
  const prefix=at===0?'':before.endsWith('\n\n')?'':before.endsWith('\n')?'\n':'\n\n';
  const suffix=at===state.doc.length?'\n':after.startsWith('\n\n')?'':after.startsWith('\n')?'\n':'\n\n';
  const template='| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |';
  const anchor=at+prefix.length+2;
  return {changes:{from:at,to:at,insert:prefix+template+suffix},selection:{anchor,head:anchor+2}};
}

export function encodeLinkTarget(target) {
  return target.replaceAll('\\','/').replace(/[\s()<>"\[\]]/g,char=>['(',')'].includes(char)?'%'+char.charCodeAt(0).toString(16).toUpperCase():encodeURIComponent(char));
}

// Validate the RAW typed address before any URL parser normalises it.
// Only http(s) authorities are checked here: the host must exist and must not
// contain whitespace/control characters, literally or percent-encoded.
// Percent-encoding inside the path/query/fragment is legitimate and untouched.
const HOST_BLANK=/[\s\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;
export function validateLinkTarget(raw) {
  const match=/^https?:\/\/([^/?#\\]*)/i.exec(raw);
  if(!match)return;// mailto: and #anchors keep their existing rules
  const authority=match[1];
  const host=authority.slice(authority.lastIndexOf('@')+1).replace(/:\d*$/,'');
  if(HOST_BLANK.test(authority))throw new Error('链接地址的主机名无效，不能包含空格。');
  if(!host)throw new Error('链接地址缺少主机名。');
  let decoded=host;
  try{decoded=decodeURIComponent(host);}catch{throw new Error('链接地址的主机名无效，不能包含无效的编码。');}
  if(HOST_BLANK.test(decoded))throw new Error('链接地址的主机名无效，不能包含空格。');
  if(!decoded.replace(/[\[\]]/g,''))throw new Error('链接地址缺少主机名。');
}

export function insertion(type,{label='',target='',language=''},selected='') {
  if(type==='fence') {
    if(!/^[\w+#.-]*$/.test(language))throw new Error('代码语言只能包含字母、数字、短横线、下划线、点、+ 或 #。');
    const runs=selected.match(/`+/g)||[],marker='`'.repeat(Math.max(2,...runs.map(run=>run.length))+1);
    return {prefix:marker+language+'\n',text:selected || '在这里输入代码',suffix:'\n'+marker};
  }
  target=target.trim();
  if(!target)throw new Error(type==='image'?'请输入图片相对路径。':'请输入链接地址。');
  if(type==='link' && !/^(https?:\/\/|mailto:|#)/i.test(target))throw new Error('支持 https://、http://、mailto: 或 #标题 链接。');
  if(type==='link' && !target.startsWith('#')) {
    validateLinkTarget(target);
    try{new URL(target);}catch{throw new Error('链接地址不完整，请检查后再插入。');}
  }
  if(type==='image' && (/^(?:[a-z][\w+.-]*:|[\\/])/i.test(target)||target.split(/[\\/]/).includes('..')))throw new Error('请使用当前文档目录内的图片相对路径，例如 images/photo.png。');
  if(type==='image' && !/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(target))throw new Error('支持 PNG、JPEG、GIF、WebP、AVIF 和 BMP 图片。');
  target=encodeLinkTarget(target);
  return {prefix:type==='image'?'![':'[',text:(label || (type==='image'?'图片说明':'链接文字')).replace(/[\[\]\\]/g,'\\$&'),suffix:`](${target})`};
}

export function headingTarget(state,fragment) {
  let wanted;
  try{wanted=decodeURIComponent(fragment.slice(1)).toLowerCase();}catch{throw new Error('标题链接编码无效。');}
  const tree=ensureSyntaxTree(state,state.doc.length,50);
  if(!tree)throw new Error('文档仍在解析，请稍后再试。');
  const counts=new Map();let target=null;
  tree.iterate({enter(node){
    if(!/^(ATXHeading|SetextHeading)[1-6]$/.test(node.name))return;
    let text=state.sliceDoc(node.from,node.to),removed=[];
    node.node.cursor().iterate(child=>{
      if(['HeaderMark','EmphasisMark','CodeMark','LinkMark','URL','LinkTitle'].includes(child.name))removed.push({from:child.from-node.from,to:child.to-node.from});
    });
    for(const range of removed.sort((a,b)=>b.from-a.from))text=text.slice(0,range.from)+text.slice(range.to);
    const base=text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu,'').replace(/\s/g,'-');
    let slug=base,index=0;while(counts.has(slug))slug=`${base}-${++index}`;counts.set(slug,true);
    if(slug===wanted && target===null)target=node.from;
  }});
  return target;
}
