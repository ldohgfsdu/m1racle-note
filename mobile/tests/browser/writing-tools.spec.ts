import {test,expect} from '@playwright/test';

const raw='\ufeff# 写作\r\n\r\n第一段保留中文🌱。\r第二段。\n';
async function load(page:any,text=raw){await page.addInitScript(()=>{window.Native={postMessage:()=>{}};});await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean(window.M1racle));await page.evaluate((markdown:string)=>window.M1racle.loadDocument({id:'writing',path:'writing.md',markdown}),text);}
async function select(page:any,text:string){await page.evaluate((text:string)=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view,from=v.state.doc.toString().indexOf(text);v.dispatch({selection:{anchor:from,head:from+text.length}});v.focus();},text);}
const markdown=(page:any)=>page.evaluate(()=>window.M1racle.getMarkdown());

test('Android writing bar has six separate 48px targets at 320px and keeps selected formatting undoable',async({page})=>{
 await page.setViewportSize({width:320,height:640});await load(page);await select(page,'中文🌱');
 const bar=page.getByRole('toolbar',{name:'写作工具栏'});await expect(bar.getByRole('button')).toHaveCount(6);
 const boxes=await bar.getByRole('button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};}));
 for(let i=0;i<boxes.length;i++){expect(boxes[i].width).toBeGreaterThanOrEqual(48);expect(boxes[i].height).toBeGreaterThanOrEqual(48);expect(boxes[i].right).toBeLessThanOrEqual(320);if(i)expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].right);}
 await bar.getByRole('button',{name:'加粗',exact:true}).click();expect(await markdown(page)).toBe(raw.replace('中文🌱','**中文🌱**'));await expect(bar.getByRole('button',{name:'加粗',exact:true})).toHaveAttribute('aria-pressed','true');
 await bar.getByRole('button',{name:'撤销上一步'}).click();expect(await markdown(page)).toBe(raw);
});

test('format panel applies heading and all inline and paragraph commands with exact undo',async({page})=>{
 await load(page);
 for(const [label,expected] of [['二级标题','## 第一段保留中文🌱。'],['斜体','*第一段保留中文🌱。*'],['删除线','~~第一段保留中文🌱。~~'],['行内代码','`第一段保留中文🌱。`'],['编号列表','1. 第一段保留中文🌱。'],['引用','> 第一段保留中文🌱。']] as const){
  await select(page,'第一段保留中文🌱。');await page.getByRole('toolbar',{name:'写作工具栏'}).getByRole('button',{name:'标题',exact:true}).click();const dialog=page.getByRole('dialog',{name:'标题与格式'});await dialog.getByRole('button',{name:label,exact:true}).click();expect(await markdown(page)).toBe(raw.replace('第一段保留中文🌱。',expected));await page.getByRole('button',{name:'撤销上一步'}).click();expect(await markdown(page)).toBe(raw);
 }
 for(const [label,prefix] of [['列表','- '],['待办','- [ ] ']] as const){await select(page,'第一段保留中文🌱。');await page.getByRole('toolbar',{name:'写作工具栏'}).getByRole('button',{name:label,exact:true}).click();expect(await markdown(page)).toBe(raw.replace('第一段保留中文🌱。',prefix+'第一段保留中文🌱。'));await page.getByRole('button',{name:'撤销上一步'}).click();expect(await markdown(page)).toBe(raw);}
});

test('link form retains selected text and range while fields have focus, validates URL and cancels without changes',async({page})=>{
 await load(page);await select(page,'中文🌱');await page.getByRole('button',{name:'插入',exact:true}).click();await page.getByRole('button',{name:'链接',exact:true}).click();const form=page.getByRole('dialog',{name:'插入链接'});
 await expect(form.getByLabel('显示文字')).toHaveValue('中文🌱');await form.getByLabel('网址').fill('javascript:alert(1)');await form.getByRole('button',{name:'插入链接',exact:true}).click();await expect(form.getByRole('alert')).toBeVisible();expect(await markdown(page)).toBe(raw);
 await form.getByLabel('网址').fill('https://example.com/a(b)');await form.getByRole('button',{name:'插入链接',exact:true}).click();expect(await markdown(page)).toBe(raw.replace('中文🌱','[中文🌱](https://example.com/a%28b%29)'));await expect(page.locator('.cm-content')).toBeFocused();await page.getByRole('button',{name:'撤销上一步'}).click();expect(await markdown(page)).toBe(raw);
 await page.getByRole('button',{name:'插入',exact:true}).click();await page.getByRole('button',{name:'链接',exact:true}).click();await page.getByRole('dialog',{name:'插入链接'}).getByRole('button',{name:'取消'}).click();expect(await markdown(page)).toBe(raw);
});

test('insertion panel provides code blocks, divider and explicit table source template, each reversible',async({page})=>{
 await load(page);for(const kind of ['代码块','分隔线','表格源码模板']){await select(page,'第二段。');await page.getByRole('button',{name:'插入',exact:true}).click();await page.getByRole('button',{name:kind,exact:true}).click();if(kind==='代码块'){const form=page.getByRole('dialog',{name:'插入代码块'});await form.getByLabel('代码语言').fill('python');await form.getByRole('button',{name:'插入代码块',exact:true}).click();expect(await markdown(page)).toContain('```python\r\n第二段。\r\n```');}else if(kind==='分隔线'){expect(await markdown(page)).toContain('---');expect(await markdown(page)).toContain('第二段。');}else{expect(await markdown(page)).toContain('| 标题 | 标题 |');expect(await markdown(page)).toContain('第二段。');await expect(page.locator('.cm-content')).toContainText('| --- | --- |');}await page.getByRole('button',{name:'撤销上一步'}).click();expect(await markdown(page)).toBe(raw);}
});

test('read-only, composing and stale document reject writing actions without replacing source',async({page})=>{
 await load(page);await select(page,'中文🌱');await page.evaluate(()=>window.M1racle.setReadOnly(true));await expect(page.getByRole('button',{name:'加粗',exact:true})).toBeDisabled();expect(await markdown(page)).toBe(raw);await page.evaluate(()=>window.M1racle.setReadOnly(false));
 await page.evaluate(()=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view;v.inputState.composing=1;});await page.getByRole('button',{name:'加粗',exact:true}).click();expect(await markdown(page)).toBe(raw);await page.evaluate(()=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view;v.inputState.composing=-1;});
 await page.getByRole('button',{name:'插入',exact:true}).click();await page.getByRole('button',{name:'链接',exact:true}).click();await page.getByLabel('网址',{exact:true}).fill('https://example.com');await page.evaluate(()=>window.M1racle.loadDocument({id:'other',path:'other.md',markdown:'另一篇笔记'}));await expect(page.getByRole('dialog')).toHaveCount(0);expect(await markdown(page)).toBe('另一篇笔记');
});

test('a stale insertion range cannot overwrite edits made while its form was open',async({page})=>{
 await load(page);await select(page,'中文🌱');await page.getByRole('button',{name:'插入',exact:true}).click();await page.getByRole('button',{name:'链接',exact:true}).click();const form=page.getByRole('dialog',{name:'插入链接'});await form.getByLabel('网址').fill('https://example.com');
 await page.evaluate(()=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view;v.dispatch({changes:{from:v.state.doc.length,insert:'新内容'}});});await form.getByRole('button',{name:'插入链接',exact:true}).click();await expect(form.getByRole('alert')).toContainText('文档已变化');expect(await markdown(page)).toBe(raw+'新内容');
});

test('bold toggles off, empty-caret placeholders remain selected, and list Enter continues or exits',async({page})=>{
 await load(page);await select(page,'中文🌱');const bold=page.getByRole('button',{name:'加粗',exact:true});await bold.click();await bold.click();expect(await markdown(page)).toBe(raw);
 await page.evaluate(()=>window.M1racle.loadDocument({id:'empty',path:'empty.md',markdown:''}));await bold.click();expect(await markdown(page)).toBe('**粗体文字**');await page.keyboard.insertText('开始写作');expect(await markdown(page)).toBe('**开始写作**');
 await page.evaluate(()=>window.M1racle.loadDocument({id:'list',path:'list.md',markdown:'- 第一项'}));await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');expect(await markdown(page)).toBe('- 第一项\n- ');await page.keyboard.press('Enter');expect(await markdown(page)).toBe('- 第一项\n');
});

test('writing controls and insertion form stay usable in a short dark viewport without console errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.setViewportSize({width:320,height:420});await load(page);await page.evaluate(()=>window.M1racle.changePreferences({theme:'dark',size:24}));await select(page,'中文🌱');
 const bar=page.getByRole('toolbar',{name:'写作工具栏'});await expect(bar).toBeVisible();await page.screenshot({path:test.info().outputPath('writing-dark-320.png')});await bar.getByRole('button',{name:'插入',exact:true}).click();await page.getByRole('button',{name:'链接',exact:true}).click();const form=page.getByRole('dialog',{name:'插入链接'});await form.getByLabel('网址').fill('https://example.com');
 const bounds=await form.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(320);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(421);await page.screenshot({path:test.info().outputPath('insert-dark-320.png')});await form.getByRole('button',{name:'插入链接',exact:true}).click();expect(await markdown(page)).toContain('[中文🌱](https://example.com)');await expect(page.locator('.cm-content')).toBeFocused();expect(errors).toEqual([]);
});

test('format sheet follows measured viewport changes and never has a zero height',async({page})=>{
 await page.setViewportSize({width:393,height:650});await load(page);await page.getByRole('button',{name:'标题',exact:true}).click();const sheet=page.getByRole('dialog',{name:'标题与格式'});
 for(const height of [420,650]){await page.setViewportSize({width:393,height});await expect.poll(()=>sheet.evaluate(el=>parseFloat(getComputedStyle(el).maxHeight))).toBeCloseTo(height*.75,0);const r=await sheet.boundingBox();expect(r!.height).toBeGreaterThan(100);expect(r!.y+r!.height).toBeLessThanOrEqual(height+1);}
 await sheet.getByRole('button',{name:'关闭写作面板'}).click();expect(await markdown(page)).toBe(raw);
});
