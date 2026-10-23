import {test,expect} from '@playwright/test';

test.use({hasTouch:true});
test('tapping keeps document presentation; explicit source toggle preserves text, selection and undo',async({page})=>{
 await page.setViewportSize({width:393,height:650});
 await page.addInitScript(()=>{(window as any).qaChanges=[];window.Native={postMessage:value=>{const event=JSON.parse(value);if(event.type==='change')(window as any).qaChanges.push(event);}};});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean(window.M1racle));
 const raw='# 直接写作\r\n\r\n**粗体中文** 和 [链接文字](https://example.invalid) 在同一段。\r第二段保留换行。\n\n末尾。';
 await page.evaluate(raw=>window.M1racle.loadDocument({id:'rendered-writing',path:'rendered-writing.md',markdown:raw}),raw);
 const line=page.locator('.cm-line').filter({hasText:'粗体中文'}),rendered=await line.textContent();
 expect(rendered).not.toContain('**');expect(rendered).not.toContain('https://');
 await page.getByText('粗体中文',{exact:true}).tap();
 // Atomic releases its pointer freeze after the gesture; assert the settled
 // presentation as well as the initial touch frame.
 await page.waitForTimeout(450);
 await expect.poll(()=>line.textContent()).toBe(rendered);
 await page.getByText('链接文字',{exact:true}).tap();
 await page.waitForTimeout(450);
 await expect.poll(()=>line.textContent()).toBe(rendered);
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
 expect(await page.evaluate(()=>(window as any).qaChanges)).toEqual([]);
 await page.evaluate(()=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view,t=v.state.doc.toString();v.dispatch({selection:{anchor:t.indexOf('粗体'),head:t.indexOf('链接文字')+4}});});
 const selection=await page.evaluate(()=>window.M1racle.getSelection());
 await page.getByRole('button',{name:'更多菜单',exact:true}).click();await page.getByRole('button',{name:'显示 Markdown 源码',exact:true}).click();
 await expect(line).toContainText('**粗体中文**');await expect(line).toContainText('https://example.invalid');
 expect(await page.evaluate(()=>window.M1racle.getSelection())).toEqual(selection);
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
 expect(await page.evaluate(()=>(window as any).qaChanges)).toEqual([]);
 await page.getByRole('button',{name:'更多菜单',exact:true}).click();await page.getByRole('button',{name:'返回排版编辑',exact:true}).click();
 await expect.poll(()=>line.textContent()).toBe(rendered);expect(await page.evaluate(()=>window.M1racle.getSelection())).toEqual(selection);
 await page.keyboard.insertText('替换🌱');const expected=raw.slice(0,selection[0].from)+'替换🌱'+raw.slice(selection[0].to);
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(expected);
 await page.getByRole('button',{name:'更多菜单',exact:true}).click();await page.getByRole('button',{name:'显示 Markdown 源码',exact:true}).click();
 await page.getByRole('button',{name:'撤销',exact:true}).first().click();expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
 await page.getByRole('button',{name:'更多菜单',exact:true}).click();await page.getByRole('button',{name:'返回排版编辑',exact:true}).click();
 await expect.poll(()=>line.textContent()).toBe(rendered);expect(errors).toEqual([]);
});

test('link text stays editable and its arrow requests the Android web opener',async({page})=>{
 await page.addInitScript(()=>{(window as any).qaEvents=[];window.Native={postMessage:value=>(window as any).qaEvents.push(JSON.parse(value))};});
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean(window.M1racle));
 const raw='[链接文字](https://example.com/path?x=1#part)';
 await page.evaluate(raw=>window.M1racle.loadDocument({id:'web-link',path:'web-link.md',markdown:raw}),raw);
 const link=page.locator('.cm-atomic-link');await page.getByText('链接文字',{exact:true}).tap();await page.waitForTimeout(150);
 expect(await page.evaluate(()=>(window as any).qaEvents.filter((e:any)=>e.type==='open-link'))).toEqual([]);
 const bounds=await link.boundingBox();expect(bounds).not.toBeNull();await link.click({position:{x:bounds!.width-4,y:bounds!.height/2}});
 expect(await page.evaluate(()=>(window as any).qaEvents.filter((e:any)=>e.type==='open-link'))).toEqual([{type:'open-link',url:'https://example.com/path?x=1#part'}]);
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
});
