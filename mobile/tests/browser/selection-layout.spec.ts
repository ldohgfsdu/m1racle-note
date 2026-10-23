import {test,expect} from '@playwright/test';

test.use({hasTouch:true});
test('extending a nonempty selection keeps preview geometry and source unchanged',async({page})=>{
 await page.setViewportSize({width:375,height:445});
 await page.addInitScript(()=>{(window as any).qaChanges=[];window.Native={postMessage:value=>{const event=JSON.parse(value);if(event.type==='change')(window as any).qaChanges.push(event);}};});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean(window.M1racle));
 const raw='# 选字\r\n\r\n**粗体中文** 和 [链接文字](https://example.invalid) 在同一段。\r第二段保留换行。\n\n末尾。';
 await page.evaluate(raw=>window.M1racle.loadDocument({id:'handles',path:'handles.md',markdown:raw}),raw);
 await page.evaluate(()=>{window.M1racle.focus();const v=(document.querySelector('.cm-content') as any).cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.length}});});
 const line=page.locator('.cm-line').filter({hasText:'粗体中文'});
 const rendered=await line.textContent();expect(rendered).not.toContain('**');expect(rendered).not.toContain('https://');
 const select=async(first:string,last:string)=>page.evaluate(({first,last})=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view,text=v.state.doc.toString();v.dispatch({selection:{anchor:text.indexOf(first),head:text.indexOf(last)+last.length}});},{first,last});
 // Native handles change CM selection without editing. This regression covers
 // the presentation response; it does not claim physical handle acceptance.
 for(const [first,last] of [['粗体','体'],['粗体','链接文字'],['粗体','第二段保留换行。'],['第二段','粗体中文']]){
  await select(first,last);await expect.poll(()=>line.textContent()).toBe(rendered);
  expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
  const expectedFrom=raw.indexOf(first),expectedTo=raw.indexOf(last)+last.length;
  expect(await page.evaluate(()=>window.M1racle.getSelection())).toEqual([{from:Math.min(expectedFrom,expectedTo),to:Math.max(expectedFrom,expectedTo)}]);
 }
 expect(await page.evaluate(()=>(window as any).qaChanges)).toEqual([]);
 await page.screenshot({path:test.info().outputPath('cross-paragraph-selection.png')});
 await select('粗体','链接文字');await page.keyboard.insertText('替换🌱');
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw.slice(0,raw.indexOf('粗体'))+'替换🌱'+raw.slice(raw.indexOf('链接文字')+'链接文字'.length));
 await page.evaluate(()=>window.M1racle.undo());expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
 await page.evaluate(()=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view;v.dispatch({selection:{anchor:v.state.doc.toString().indexOf('粗体')+1}});});
 await expect.poll(()=>line.textContent()).toBe(rendered);
 await page.evaluate(()=>window.M1racle.setReadOnly(true));await expect.poll(()=>line.textContent()).toBe(rendered);
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);expect(errors).toEqual([]);
});
