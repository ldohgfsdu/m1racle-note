import {build} from 'vite';
import {chromium} from '@playwright/test';
import {mkdtemp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {renderedEditingPolicy} from '../desktop/renderer/editor-policy.mjs';
import {taskControls} from '../mobile/editor/task-controls.mjs';

// The full pinned builder is the oracle. Compare decorations after each real
// CM6 transaction, independently of the application's file/session tests.
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-preview-evidence-'));
await mkdir(output,{recursive:true});
const directory=await mkdtemp(join(tmpdir(),'note-preview-probe-'));
const path=name=>resolve(name).replaceAll('\\','/');
const corpus=[];
for(const name of await readdir('editor-corpus')) {
 if(!name.endsWith('.md'))continue;
 const text=await readFile('editor-corpus/'+name,'utf8');if(text.length<50000)corpus.push({name,text:text.replace(/\r\n|\r/g,'\n')});
}
corpus.push({name:'structural-boundaries',text:'# 标题\n\n段落 **粗体** 与 [引用][ref]。\n\n- [ ] 待办\n  - 嵌套\n\n> 引用\n> 下一行\n\n| A | B |\n| --- | --- |\n| 一 | 二 |\n\n```md\n# 围栏内容\n```\n\nSetext 标题\n---\n\n![图](image.png)\n\n[ref]: https://example.com\n'});
for(const [name,text] of Object.entries({
 'list-continuation':'- 第一项\n\n第二段\n\n- 第三项\n',
 'nested-numbered-tasks':'1. [ ] 第一项\n   - [x] 子项\n\n2. 第二项\n',
 'quoted-definitions':'> [a]: /first\n\n引用 [文字][a]。\n',
 'multiline-inline':'一段 **跨越\n两行** 与 [文字](https://example.com)。\n',
 'fence-empty-last-line':'```md\n代码\n',
 'table-delimiter':'| A | B |\n| --- | --- |\n| **一** | 二 |\n',
 'reference-retarget':'[引用][ref]\n\n中间段落。\n\n[ref]: https://example.com\n',
 'indented-blocks':'  段落\n\n    缩进代码\n    下一行\n\n  - 列表\n',
}))corpus.push({name,text});
const entry=join(directory,'probe.js');
await writeFile(entry,String.raw`
import {EditorState} from ${JSON.stringify(path('node_modules/@codemirror/state/dist/index.js'))};
import {EditorView} from ${JSON.stringify(path('node_modules/@codemirror/view/dist/index.js'))};
import {markdown,markdownLanguage} from ${JSON.stringify(path('node_modules/@codemirror/lang-markdown/dist/index.js'))};
import {history,undo,redo} from ${JSON.stringify(path('node_modules/@codemirror/commands/dist/index.js'))};
import {highlightMarkdown} from ${JSON.stringify(path('node_modules/@atomic-editor/editor/dist/index.js'))};
import {inlinePreview,buildReferenceDecorations,previewPlugin} from ${JSON.stringify(path('node_modules/@atomic-editor/editor/dist/inline-preview.js'))};
function snapshot(set){const result=[];for(let cursor=set.iter();cursor.value;cursor.next()){const value=cursor.value,spec={...value.spec};if(spec.widget)spec.widget={name:spec.widget.constructor.name,checked:spec.widget.checked,src:spec.widget.src,alt:spec.widget.alt};result.push(JSON.stringify({from:cursor.from,to:cursor.to,side:value.startSide,endSide:value.endSide,spec}));}return result.sort();}
window.previewProbe=async function(corpus){
 const checks=[];let count=0,seed=719,partial=0,full=0;
 const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
 const parent=document.createElement('div');parent.style.height='600px';document.body.append(parent);
 const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 for(const fixture of corpus){
  const view=new EditorView({parent,state:EditorState.create({doc:fixture.text,extensions:[markdown({base:markdownLanguage,extensions:highlightMarkdown}),history(),inlinePreview({onLinkClick:()=>{}})]})});
  view.focus();await frame();
  // CM6 reports focus through a 10ms timer; wait for that notification too.
  await new Promise(resolve=>setTimeout(resolve,20));
  const verify=label=>{const actual=snapshot(view.plugin(previewPlugin).decorations),expected=snapshot(buildReferenceDecorations(view));count++;if(JSON.stringify(actual)!==JSON.stringify(expected)){const counts=list=>{const m=new Map();for(const value of list)m.set(value,(m.get(value)||0)+1);return m;},a=counts(actual),e=counts(expected);throw new Error(JSON.stringify({fixture:fixture.name,label,actualCount:actual.length,expectedCount:expected.length,different:[...new Set([...actual,...expected])].filter(value=>a.get(value)!==e.get(value)).slice(0,8).map(value=>({value,actual:a.get(value)||0,expected:e.get(value)||0})),text:view.state.doc.toString().slice(0,1400)}));}};
  verify('mount');
  const inserts=['测','\n','\n\n','# ','**','- [ ] ','> ','\x60\x60\x60\n','[ref]: /target\n'];
  for(let i=0;i<18;i++){
   const length=view.state.doc.length,from=i<3?[0,Math.floor(length/2),length][i]:random(length+1),to=Math.min(length,from+(i%3===0?random(Math.min(4,length-from)+1):0));
   view.dispatch({changes:{from,to,insert:inserts[i%inserts.length]},selection:{anchor:from},userEvent:'input.type'});verify('edit-'+i);
   view.dispatch({selection:{anchor:random(view.state.doc.length+1)}});verify('selection-'+i);
  }
  undo(view);verify('undo');redo(view);verify('redo');
  const cache=view.plugin(previewPlugin).previewCache;if(cache){partial+=cache.stats.partial;full+=cache.stats.full;}
  checks.push(fixture.name);view.destroy();
 }
 parent.remove();return {passed:true,comparisons:count,partialRebuilds:partial,fullRebuilds:full,fixtures:checks};
};
`);
const results=[];
for(const platform of ['desktop','mobile']) {
 const bundleDir=join(directory,platform);
 await build({configFile:false,logLevel:'error',plugins:[platform==='desktop'?renderedEditingPolicy():taskControls(),{
  name:'preview-oracle-exports',enforce:'post',transform(code,id){
   if(id.replaceAll('\\','/').endsWith('/@atomic-editor/editor/dist/inline-preview.js'))return code+'\nexport {buildInlineDecorations as buildReferenceDecorations,inlinePreviewPlugin as previewPlugin};';
  },
 }],build:{outDir:bundleDir,emptyOutDir:true,lib:{entry,formats:['iife'],name:'PreviewProbe',fileName:()=> 'probe.js'}}});
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><title>Preview equivalence</title><style>body{margin:0}.cm-editor{height:600px}.cm-scroller{overflow:auto}</style>');
  await page.addScriptTag({path:join(bundleDir,'probe.js')});
  const result=await page.evaluate(corpus=>window.previewProbe(corpus),corpus);assert.deepEqual(errors,[]);
  results.push({platform,...result});console.log(JSON.stringify(results.at(-1)));
 }catch(error){await writeFile(join(output,'preview-failure-'+platform+'.txt'),String(error.stack || error));throw error;}
 finally{await browser.close();}
}
await writeFile(join(output,'preview-equivalence.json'),JSON.stringify({date:new Date().toISOString(),scope:'Browser decoration equivalence, not Android device acceptance',results},null,2));
