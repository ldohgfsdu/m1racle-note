import {test,expect} from '@playwright/test';

test('unsupported images and tables stay visible and editable with exact undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:393,height:852});
 await page.addInitScript(()=>{(window as any).Native={postMessage:()=>{}};});
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(()=>Boolean((window as any).M1racle));
 const image='![图片说明](images/photo.png)',special='![特殊说明](<images/a b.png>)';
 const raw=`# 可见源码\r\n\r\n${image}\n\n${special}\r\n\r\n| A | B |\r\n| --- | --- |\n| **原文** | ![表内图片](image.png) |\r\n\r\n结尾。\n`;
 await page.evaluate(raw=>(window as any).M1racle.loadDocument({id:'fallback',path:'fallback.md',markdown:raw}),raw);
 await expect(page.locator('.cm-content')).toContainText(image);
 await expect(page.locator('.cm-content')).toContainText(special);
 await expect(page.locator('.cm-content')).toContainText('| **原文** | ![表内图片](image.png) |');
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 const line=page.locator('.cm-line').filter({hasText:image});await line.click();await page.keyboard.press('End');await page.keyboard.insertText('补充');
 await expect.poll(()=>page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw.replace(image,image+'补充'));
 await page.evaluate(()=>(window as any).M1racle.undo());
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 await page.evaluate(()=>(window as any).M1racle.redo());
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw.replace(image,image+'补充'));
 await page.screenshot({path:test.info().outputPath('source-fallback.png')});
 expect(errors).toEqual([]);
});

test('long mixed-EOL document retains a raw-source selection after editing near the end',async({page})=>{
 await page.addInitScript(()=>{(window as any).Native={postMessage:()=>{}};});
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean((window as any).M1racle));
 const raw='# 长文标题\r\n\r\n'+('正文 🌱\r\n\r\n').repeat(10000)+'末尾。';
 await page.evaluate(raw=>{(window as any).M1racle.loadDocument({id:'long-selection',path:'long.md',markdown:raw});(window as any).M1racle.focus();},raw);
 await page.keyboard.press('Control+End');await page.keyboard.insertText('测🌱');
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw+'测🌱');
 expect(await page.evaluate(()=>(window as any).M1racle.getSelection())).toEqual([{from:raw.length+3,to:raw.length+3}]);
 await page.evaluate(()=>(window as any).M1racle.undo());
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 await page.keyboard.press('Control+Home');
 await expect(page.locator('.cm-content')).toContainText('长文标题');
});
