import {ensureSyntaxTree} from '@codemirror/language';
import {encodeLinkTarget} from './formatting.mjs';

export function webDestination(value) {
 const target=String(value).trim();
 if(/[\u0000-\u001f\u007f-\u009f\\]/.test(target))throw new Error('网址不能包含换行、控制字符或反斜线。');
 let url;try{url=new URL(target);}catch{throw new Error('请输入完整的网址，例如 https://example.com。');}
 if(!['http:','https:'].includes(url.protocol)||!url.hostname)throw new Error('目前支持 http 或 https 网页链接。');
 return encodeLinkTarget(target);
}

// Locate existing syntax with Lezer. This is a source-range command, never an
// AST serializer or a replacement selection engine.
export function explicitLinkAt(state) {
 if(state.selection.ranges.length!==1)return null;
 const range=state.selection.main,tree=ensureSyntaxTree(state,state.doc.lineAt(range.to).to,50);
 if(!tree)throw new Error('这一段仍在解析，请稍后再操作。');
 let found=null;
 for(const bias of [1,-1]){
  for(let n=tree.resolveInner(range.from,bias);n;n=n.parent){
   if(['Link','Autolink','URL'].includes(n.name)&&!(n.name==='URL'&&n.parent?.name==='Link')&&n.from<=range.from&&n.to>=range.to){found=n;break;}
  }
  if(found)break;
 }
 if(!found&&!range.empty)tree.iterate({from:range.from,to:range.to,enter(node){if(!found&&['Link','Autolink','URL'].includes(node.name))found=node.node;}});
 if(!found)return null;
 const result={kind:'source',document:state.doc,from:found.from,to:found.to,labelFrom:0,labelTo:0,urlFrom:0,urlTo:0,label:'',target:'',editableLabel:false};
 if(range.from<found.from||range.to>found.to)return result;
 const marks=found.getChildren('LinkMark'),url=found.getChild('URL');
 if(found.name!=='Link'||!url||marks.length!==4||state.sliceDoc(marks[0].from,marks[0].to)!=='['||state.sliceDoc(marks[1].from,marks[1].to)!==']'||state.sliceDoc(marks[2].from,marks[2].to)!=='('||state.sliceDoc(marks[3].from,marks[3].to)!==')')return result;
 const labelFrom=marks[0].to,labelTo=marks[1].from,rawLabel=state.sliceDoc(labelFrom,labelTo),urlSource=state.sliceDoc(url.from,url.to),angle=urlSource.startsWith('<')&&urlSource.endsWith('>'),urlFrom=url.from+(angle?1:0),urlTo=url.to-(angle?1:0),target=state.sliceDoc(urlFrom,urlTo);
 if(!/^https?:\/\//i.test(target)||target.includes('\\'))return result;
 const captionNodes=[];for(let n=found.firstChild;n;n=n.nextSibling)if(n.from>=labelFrom&&n.to<=labelTo)captionNodes.push(n);
 const editableLabel=!/[\r\n]/.test(rawLabel)&&captionNodes.every(n=>n.name==='Escape');
 let label=rawLabel;
 if(editableLabel){let at=labelFrom;label='';for(const n of captionNodes){label+=state.sliceDoc(at,n.from)+state.sliceDoc(n.from+1,n.to);at=n.to;}label+=state.sliceDoc(at,labelTo);}
 return {...result,kind:'inline',labelFrom,labelTo,urlFrom,urlTo,label,target,editableLabel};
}

export function linkEditPlan(state,link,{label=link.label,target=link.target}) {
 if(link.kind!=='inline'||state.doc!==link.document)throw new Error('文档已变化，请重新选择链接。');
 const destination=webDestination(target),changes=[];
 if(label!==link.label){
  if(!link.editableLabel)throw new Error('链接文字含排版，请回到正文修改文字。');
  if(!label.trim()||/[\r\n]/.test(label))throw new Error('链接文字不能为空或跨段，请在同一行填写。');
  changes.push({from:link.labelFrom,to:link.labelTo,insert:label.replace(/[\[\]\\]/g,'\\$&')});
 }
 // Keep an unchanged destination byte for byte, including an angle wrapper,
 // optional title, spacing and any noncanonical but supported source form.
 if(String(target).trim()!==link.target)changes.push({from:link.urlFrom,to:link.urlTo,insert:destination});
 return {changes,selection:state.selection.map(state.changes(changes))};
}
