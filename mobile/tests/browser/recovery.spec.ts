import {test,expect} from '@playwright/test';

test('save failure keeps writing and offers retry or a separate Markdown copy',async({page})=>{
 await page.setViewportSize({width:320,height:640});
 await page.addInitScript(()=>{
  (window as any).qaEvents=[];
  (window as any).Native={postMessage:(value:string)=>(window as any).qaEvents.push(JSON.parse(value))};
 });
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean((window as any).M1racle));
 const raw='# 保留我的文字\r\n\r\n未保存的内容。\n尾行\r';
 await page.evaluate(raw=>(window as any).M1racle.loadDocument({id:'recovery',path:'recovery.md',markdown:raw}),raw);
 await page.evaluate(()=>(window as any).M1racle.reportError('文件已在外部改变，已暂停保存',true));
 const banner=page.getByRole('alert'),retry=banner.getByRole('button',{name:'重试保存',exact:true}),copy=banner.getByRole('button',{name:'保存副本',exact:true});
 await expect(retry).toBeVisible();await expect(copy).toBeVisible();
 await expect(banner.getByRole('button',{name:'关闭提示',exact:true})).toHaveCount(0);
 for(const button of [retry,copy]){
  const box=await button.boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeGreaterThanOrEqual(48);expect(box!.width).toBeGreaterThanOrEqual(48);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(320);
 }
 await page.screenshot({path:test.info().outputPath('save-failure-light.png')});
 await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('继续写');
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw+'继续写');
 await retry.click();expect(await page.evaluate(()=>(window as any).qaEvents.some((event:any)=>event.type==='retry-save'))).toBe(true);
 await page.evaluate(()=>(window as any).M1racle.clearSaveError('other-document'));await expect(banner).toBeVisible();
 await page.evaluate(()=>(window as any).M1racle.clearSaveError('recovery'));await expect(banner).toHaveCount(0);
 const beforeLayout=await page.evaluate(()=>({selection:(window as any).M1racle.getSelection(),markdown:(window as any).M1racle.getMarkdown(),changes:(window as any).qaEvents.filter((event:any)=>event.type==='change').length}));
 await page.evaluate(()=>(window as any).M1racle.reportError('保存仍未完成',true));
 await page.evaluate(()=>(window as any).M1racle.setPreferences({theme:'dark',size:24,leading:2.2}));await page.setViewportSize({width:320,height:400});
 for(const button of [retry,copy]){const box=await button.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(400);}
 await page.evaluate(()=>(window as any).M1racle.focus());await page.keyboard.press('Control+End');
 await expect.poll(async()=>{
  const caret=await page.locator('.cm-content').evaluate((element:any)=>{const view=element.cmTile.root.view;return view.coordsAtPos(view.state.selection.main.head);});
  return caret!.bottom;
 }).toBeLessThan((await banner.boundingBox())!.y);
 expect(await page.evaluate(()=>({selection:(window as any).M1racle.getSelection(),markdown:(window as any).M1racle.getMarkdown(),changes:(window as any).qaEvents.filter((event:any)=>event.type==='change').length}))).toEqual(beforeLayout);
 await page.screenshot({path:test.info().outputPath('save-failure-dark-short.png')});
 await copy.click();await expect(page.getByRole('status',{name:'正在打开文档'})).toBeVisible();
 await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','false');
 expect(await page.evaluate(()=>(window as any).qaEvents.some((event:any)=>event.type==='save-copy'))).toBe(true);
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw+'继续写');
 await page.evaluate(raw=>(window as any).M1racle.loadDocument({id:'copy',path:'note-copy.md',markdown:raw+'继续写'}),raw);
 await expect(banner).toHaveCount(0);await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true');
 await page.evaluate(()=>(window as any).M1racle.reportError('不支持这个文件的编码'));
 await expect(banner.getByRole('button',{name:'保存副本',exact:true})).toHaveCount(0);
 await banner.getByRole('button',{name:'关闭提示',exact:true}).click();await expect(banner).toHaveCount(0);
 expect(errors).toEqual([]);await page.screenshot({path:test.info().outputPath('recovered-mobile.png')});
});
