import {launchApp,createReporter,sleep,loneSurrogate} from './input-helpers.mjs';
import {expect} from '@playwright/test';
import {resolve,join} from 'node:path';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

// Batch 3B part 2: clipboard contract, selection+history with the floating toolbar,
// mode-switch history contract, draft recovery + undo. Real Electron.
// Contract (read from code): paste/cut/copy are native Chromium operations; CodeMirror inserts clipboard
// text/plain ONLY (HTML is ignored); toolbar copy/cut/paste call webContents.copy/cut/paste (same path).
// There is no separate "paste as plain text" command; plain text is what every paste yields.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3b/raw');
const R=createReporter('history-clipboard-modes-ui');
const {check}=R;
const UNDO='Control+z',REDO='Control+y';
const base='# 标题\n\n第一段：alpha beta gamma。\n\n第二段 second paragraph。\n\n第三段 third **bold** end。\n';
const steps=async(t,key,expectDoc,max=40)=>{let n=0;while(n<max&&(await t.doc())!==expectDoc){await t.page.keyboard.press(key);n++;await sleep(20);}return n;};
const setup=async(raw=base,name='剪贴板.md')=>{const t=await launchApp({raw,name});await t.focus();return t;};
// Real OS clipboard with genuine CF_HTML (+ optional CF_UNICODETEXT), like a browser/Word copy. Windows PowerShell STA.
const osClipboard=(text,html)=>{
 const ps=`Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.DataObject;`+
  (text!==null?`$d.SetText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text,'utf8').toString('base64')}')));`:'')+
  `$frag=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(html,'utf8').toString('base64')}'));`+
  `$pre='<html><body><!--StartFragment-->';$post='<!--EndFragment--></body></html>';$hdr='Version:0.9'+[char]13+[char]10+'StartHTML:0000000000'+[char]13+[char]10+'EndHTML:0000000000'+[char]13+[char]10+'StartFragment:0000000000'+[char]13+[char]10+'EndFragment:0000000000'+[char]13+[char]10;`+
  `$b=[Text.Encoding]::UTF8;$sh=$b.GetByteCount($hdr);$sf=$sh+$b.GetByteCount($pre);$ef=$sf+$b.GetByteCount($frag);$eh=$ef+$b.GetByteCount($post);`+
  `$hdr='Version:0.9'+[char]13+[char]10+('StartHTML:{0:D10}' -f $sh)+[char]13+[char]10+('EndHTML:{0:D10}' -f $eh)+[char]13+[char]10+('StartFragment:{0:D10}' -f $sf)+[char]13+[char]10+('EndFragment:{0:D10}' -f $ef)+[char]13+[char]10;`+
  `$d.SetData('HTML Format',[IO.MemoryStream]::new($b.GetBytes($hdr+$pre+$frag+$post)));[System.Windows.Forms.Clipboard]::SetDataObject($d,$true)`;
 execFileSync('powershell',['-STA','-NoProfile','-Command',ps],{stdio:'ignore',windowsHide:true});
};let originalClipboard=null;

// ---------------- B: clipboard ----------------
{
 const t=await setup();originalClipboard=await t.getClipboard();
 try {
  const end=base.length;
  await check('B1-copy-and-cut-plain-text-exact-and-undoable',async()=>{
   const a=base.indexOf('alpha'),b=a+'alpha beta'.length;await t.setClipboard('');await t.select(a,b);
   await t.page.keyboard.press('Control+c');assert.equal(await t.getClipboard(),'alpha beta');assert.equal(await t.doc(),base);
   await t.page.keyboard.press('Control+x');assert.equal(await t.getClipboard(),'alpha beta');assert.equal(await t.doc(),base.slice(0,a)+base.slice(b));
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);assert.equal(await t.getClipboard(),'alpha beta','undo does not touch the clipboard');
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base.slice(0,a)+base.slice(b));await t.page.keyboard.press(UNDO);
  });
  const paste=async(text,label)=>{await t.setClipboard(text);await t.select(end);await t.page.keyboard.press('Control+v');
   const exp=base+text.replace(/\r\n?/g,'\n'),d=await t.doc();assert.equal(d,exp,label);assert.ok(!loneSurrogate(d));await t.waitSaved(exp);assert.equal(await t.disk(),exp);
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base,label+' undo');await t.page.keyboard.press(REDO);assert.equal(await t.doc(),exp,label+' redo');await t.page.keyboard.press(UNDO);await t.waitSaved(base);};
  await check('B2-paste-single-line',()=>paste('单行文本 single line','single'));
  await check('B2-paste-multiline',()=>paste('第一行\n第二行\n\n第四行','multi'));
  await check('B2-paste-mixed-cjk-latin',()=>paste('Hello 世界 mixed 中英文 text 123 “引号” — ok','mixed'));
  await check('B2-paste-unicode-emoji',()=>paste('😀👨‍👩‍👧 e\u0301 𠮷 مرحبا ①','unicode'));
  await check('B2-paste-markdown-source-fidelity',()=>paste('## 标题\n- a\n- **b** `c`\n> 引用 [链接](http://x.y) ~~s~~\n\n```js\nlet x=1\n```\n<b>raw</b>','markdown'));
  await check('B2-paste-crlf-normalised-in-editor',()=>paste('行1\r\n行2\r\n行3','crlf'));
  await check('B3-rich-clipboard-text-plus-html-inserts-plain-text-only',async()=>{
   osClipboard('纯文本 plain','<b>粗体</b><script>1</script><img src=x>');
   assert.equal(await t.getClipboard(),'纯文本 plain');
   await t.select(end);await t.page.keyboard.press('Control+v');assert.equal(await t.doc(),base+'纯文本 plain','contract: only text/plain is inserted, HTML never reaches the document');
   await t.waitSaved(base+'纯文本 plain');await t.page.keyboard.press(UNDO);await t.waitSaved(base);
  });
  await check('B3-html-only-clipboard-characterised',async()=>{
   osClipboard(null,'<p>只有HTML</p>');
   const readText=await t.getClipboard();await t.select(end);await t.page.keyboard.press('Control+v');await sleep(200);
   const d=await t.doc();assert.ok(d===base||d===base+readText||d===base+'只有HTML','document must be unchanged or plain text only; got '+JSON.stringify(d.slice(base.length)));
   assert.ok(!/<p>|<\/p>/.test(d),'no HTML markup leaks into Markdown source');
   await writeFile(join(output,'B3-html-only-observed.json'),JSON.stringify({clipboardReadText:readText,docDelta:d.slice(base.length)}));
   await steps(t,UNDO,base);
  });
  await check('B4-paste-replaces-selection-and-undo-restores',async()=>{
   const a=base.indexOf('second'),b=a+'second paragraph'.length;await t.setClipboard('剪贴内容\n两行');await t.select(a,b);await t.page.keyboard.press('Control+v');
   assert.equal(await t.doc(),base.slice(0,a)+'剪贴内容\n两行'+base.slice(b));await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
   const s=await t.state();assert.equal([Math.min(s.anchor,s.head),Math.max(s.anchor,s.head)].join(),[a,b].join());
  });
  await check('B5-toolbar-copy-cut-buttons-match-keyboard-and-undo',async()=>{
   const a=base.indexOf('alpha'),b=a+'alpha beta'.length;await t.setClipboard('');await t.select(a,b);await sleep(450);
   const copy=t.page.locator('#selection-menu [data-selection-command="copy"]'),cut=t.page.locator('#selection-menu [data-selection-command="cut"]');
   await copy.click();await expect.poll(()=>t.getClipboard()).toBe('alpha beta');assert.equal(await t.doc(),base);
   await t.select(a,b);await sleep(450);await cut.click();await expect.poll(()=>t.doc()).toBe(base.slice(0,a)+base.slice(b));assert.equal(await t.getClipboard(),'alpha beta');
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
  });
  await check('B6-crlf-bom-file-paste-keeps-file-eol-and-bom',async()=>{
   const t2=await launchApp({raw:'\ufeff# T\r\n\r\npara one\r\n\r\npara two\r\n',name:'crlf.md'});await t2.focus();
   try{
    await t2.setClipboard('P\nQ\r\nR');await t2.select(8);await t2.page.keyboard.press('Control+v');
    await expect.poll(async()=>{const d=await t2.disk();return d.includes('P')&&d.includes('R');},{timeout:6000}).toBe(true);await sleep(800);
    const d=await t2.disk();assert.ok(d.startsWith('\ufeff'));assert.ok(!/[^\r]\n/.test(d.slice(1)),'all line endings stay CRLF: '+JSON.stringify(d));
    assert.equal(d,'\ufeff# T\r\n\r\nparP\r\nQ\r\nRa one\r\n\r\npara two\r\n');
    await t2.page.keyboard.press(UNDO);await expect.poll(()=>t2.disk(),{timeout:6000}).toBe('\ufeff# T\r\n\r\npara one\r\n\r\npara two\r\n');
   }finally{await t2.close();}
  });
 } finally {if(originalClipboard!==null)await t.app.evaluate(({clipboard},v)=>clipboard.writeText(v),originalClipboard).catch(()=>{});await t.close();}
}

// ---------------- C: selection + history + toolbar ----------------
{
 const t=await setup(base,'选区历史.md');
 try {
  await check('C1-cross-paragraph-delete-undo-restores-paragraphs',async()=>{
   const a=base.indexOf('alpha'),b=base.indexOf('third')+5;await t.select(a,b);await t.page.keyboard.press('Delete');
   assert.equal(await t.doc(),base.slice(0,a)+base.slice(b));await t.waitSaved(base.slice(0,a)+base.slice(b));
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);await t.waitSaved(base);
   await t.page.keyboard.press(REDO);await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
  });
  await check('C2-mouse-and-keyboard-selection-then-replace-undo',async()=>{
   const a=base.indexOf('beta'),b=a+4,pa=await t.pos(a),pb=await t.pos(b);
   await t.clickAt(base.indexOf('第三段')+1);
   await t.page.mouse.move(pa.x+1,pa.y);await t.page.mouse.down();await t.page.mouse.move(pb.x+1,pb.y,{steps:4});await t.page.mouse.up();
   await t.page.keyboard.type('B');assert.equal(await t.doc(),base.slice(0,a)+'B'+base.slice(b));await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
   await t.select(a);await t.page.keyboard.press('Shift+ArrowRight');await t.page.keyboard.press('Shift+ArrowRight');await t.page.keyboard.press('Shift+ArrowRight');await t.page.keyboard.press('Shift+ArrowRight');
   await t.page.keyboard.type('B');assert.equal(await t.doc(),base.slice(0,a)+'B'+base.slice(b));await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
  });
  await check('C3-toolbar-bold-keeps-selection-and-undo-state',async()=>{
   const a=base.indexOf('gamma'),b=a+5;await t.select(a,b);await sleep(450);
   await t.page.locator('#selection-menu [data-selection-format="bold"]').click();
   const exp=base.slice(0,a)+'**gamma**'+base.slice(b);assert.equal(await t.doc(),exp);
   const s=await t.state();assert.equal(base.slice(0,a)+'**'+s.doc.slice(Math.min(s.anchor,s.head),Math.max(s.anchor,s.head))+'**'+base.slice(b),exp,'selection still covers the formatted word');
   await t.waitSaved(exp);await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);await t.waitSaved(base);
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),exp);await t.page.keyboard.press(UNDO);
   const extra=await steps(t,UNDO,base);assert.equal(extra,0,'no hidden extra undo step created by the toolbar');
  });
 } finally {await t.close();}
}

// ---------------- D: mode switching ----------------
{
 const raw='\ufeff# 模式\r\n\r\n第一段 alpha。\r\n\r\n第二段 **粗体** beta。\n\n第三段尾。\r\n';
 const t=await setup(raw,'模式.md');
 try {
  const normalized=raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
  await check('D1-toggle-without-edit-keeps-doc-and-disk-bytes',async()=>{
   const before=await t.disk();assert.equal(before,raw);
   for(let i=0;i<4;i++){await t.page.keyboard.press('Control+e');await sleep(400);assert.equal(await t.doc(),normalized);}
   await sleep(900);assert.equal(await t.disk(),raw,'toggling modes never rewrites the file');
   assert.equal((await t.state()).mode,'rendered');
  });
  await check('D2-history-is-shared-across-modes-contract',async()=>{
   // CONTRACT (from code): one EditorView; modes only reconfigure presentation, so undo history survives switches.
   const at=normalized.indexOf('alpha')+5;await t.select(at);await t.page.keyboard.type('一');await sleep(700);
   await t.page.keyboard.press('Control+e');await sleep(400);await t.page.keyboard.type('二');await sleep(700);
   await t.page.keyboard.press('Control+e');await sleep(400);await t.page.keyboard.type('三');
   assert.equal((await t.doc()).slice(at,at+3),'一二三'.slice(0,3));
   await t.page.keyboard.press(UNDO);assert.equal((await t.doc()).slice(at,at+2),'一二');
   await t.page.keyboard.press('Control+e');await sleep(400);await t.page.keyboard.press(UNDO);assert.equal((await t.doc()).slice(at,at+1),'一');
   await t.page.keyboard.press('Control+e');await sleep(400);await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),normalized);
   await t.page.keyboard.press(REDO);await t.page.keyboard.press(REDO);await t.page.keyboard.press(REDO);assert.equal((await t.doc()).slice(at,at+3),'一二三');
   await steps(t,UNDO,normalized);
  });
  await check('D3-mode-switches-add-no-undo-steps',async()=>{
   await t.select(normalized.length);await t.page.keyboard.type('尾');await sleep(700);
   for(let i=0;i<6;i++){await t.page.keyboard.press('Control+e');await sleep(350);}
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),normalized,'single undo removes the typed char; toggles created no extra steps');
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),normalized);
   await t.waitSaved(raw);
  });
  await check('D4-edit-in-one-mode-preserves-bom-eol-and-untouched-regions',async()=>{
   const t2=await launchApp({raw,name:'保真模式.md'});await t2.focus();
   try{
    const at=normalized.indexOf('alpha');await t2.select(at);await t2.page.keyboard.type('X');
    await t2.page.keyboard.press('Control+e');await sleep(400);const at2=normalized.indexOf('beta')+1;await t2.select(at2+1);await t2.page.keyboard.type('Y');
    await t2.page.keyboard.press('Control+e');await sleep(400);
    await expect.poll(async()=>{const d=await t2.disk();return d.includes('Xalpha')&&d.includes('bYeta');},{timeout:6000}).toBe(true);await sleep(800);
    const d=await t2.disk();
    const expected=raw.replace('alpha','Xalpha').replace('beta','bYeta');
    assert.equal(d,expected,'only the two edited characters differ; BOM, CRLF and the lone LF line stay byte-identical');
    await steps(t2,UNDO,normalized);await expect.poll(()=>t2.disk(),{timeout:6000}).toBe(raw);
   }finally{await t2.close();}
  });
  await check('D5-source-mode-shows-exact-markdown-no-silent-rewrite',async()=>{
   const md='# T\n\n* 星号列表\n+ 加号列表\n\n__下划线粗体__ 与 *斜体*\n\n1) 序号\n\n<div>html</div>\n';
   const t2=await launchApp({raw:md,name:'源码.md'});await t2.focus();
   try{await t2.page.keyboard.press('Control+e');await sleep(500);await t2.select(md.length);await t2.page.keyboard.type('!');await t2.page.keyboard.press('Control+e');await sleep(500);
    await t2.waitSaved(md+'!');await t2.page.keyboard.press(UNDO);await t2.waitSaved(md);}
   finally{await t2.close();}
  });
  await check('D-console-clean',async()=>assert.deepEqual(t.errors,[]));
 } finally {await t.close();}
}

// ---------------- A10: recovered draft then edit + undo ----------------
{
 const first=await launchApp({name:'unused.md'});
 const profile=first.profile,dir=first.dir;
 try {
  await check('A10-recovered-draft-continue-editing-and-undo',async()=>{
   await first.page.locator('.cm-content').click();await first.page.keyboard.press('Control+a');await first.page.keyboard.type('草稿正文第一行\n草稿正文第二行');
   await sleep(2600);
   try{execFileSync('taskkill',['/PID',String(first.app.process().pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}
   await sleep(800);
   const second=await launchApp({keepDir:dir,profile,args:[]});
   try{
    await expect(second.page.locator('#recovery')).toBeVisible({timeout:8000});
    await second.page.locator('.recovery-restore').first().click();await expect(second.page.locator('#recovery')).toBeHidden();
    const recovered=await second.doc();assert.equal(recovered,'草稿正文第一行\n草稿正文第二行');
    await second.focus();await second.select(recovered.length);await second.page.keyboard.type('续写');
    assert.equal(await second.doc(),recovered+'续写');
    await second.page.keyboard.press(UNDO);assert.equal(await second.doc(),recovered);
    await second.page.keyboard.press(UNDO);assert.equal(await second.doc(),recovered,'undo never empties the recovered draft');
    await second.page.keyboard.press(REDO);assert.equal(await second.doc(),recovered+'续写');
    await second.page.keyboard.press(UNDO);
   }finally{await second.app.evaluate(({app})=>app.exit(0)).catch(()=>{});await second.app.close().catch(()=>{});}
  });
 } finally {await first.close().catch(()=>{});}
}
await R.finish(output,{scope:'Real Electron + Playwright; IME/external rich text/system clipboard UNVERIFIED (MANUAL-3B-CHECK.md)'});
