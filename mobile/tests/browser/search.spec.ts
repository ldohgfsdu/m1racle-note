import {test,expect} from '@playwright/test';

test('Chinese search and replacement preserve exact mixed source and undo',async({page})=>{
 await page.setViewportSize({width:393,height:852});
 await page.addInitScript(()=>{(window as any).Native={postMessage:()=>{}};});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean((window as any).M1racle));
 const raw='# 查找替换\r\n\r\n苹果 apple。\n\n另一个 apple 与 APPLE。\r\n';
 await page.evaluate(raw=>{(window as any).M1racle.loadDocument({id:'search',path:'search.md',markdown:raw});(window as any).M1racle.find('apple');},raw);
 const panel=page.locator('.cm-search'),query=panel.getByRole('textbox',{name:'查找',exact:true}),replacement=panel.getByRole('textbox',{name:'替换为',exact:true});
 await expect(query).toHaveValue('apple');await replacement.fill('pear');await replacement.press('End');
 await panel.getByRole('button',{name:'选中全部',exact:true}).click();expect(await page.evaluate(()=>(window as any).M1racle.getSelection())).toHaveLength(3);
 await panel.getByRole('button',{name:'全部替换',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw.replace(/apple/gi,'pear'));
 await page.evaluate(()=>(window as any).M1racle.undo());expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 await query.fill('(apple)');await query.press('End');await panel.getByRole('checkbox',{name:'正则表达式',exact:true}).check();await panel.getByRole('checkbox',{name:'区分大小写',exact:true}).check();
 await replacement.fill('$1 已处理');await replacement.press('End');await panel.getByRole('button',{name:'全部替换',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw.replace(/(apple)/g,'$1 已处理'));
 await page.evaluate(()=>(window as any).M1racle.undo());expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 await page.evaluate(()=>(window as any).M1racle.setReadOnly(true));await panel.getByRole('button',{name:'全部替换',exact:true}).click();expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 await page.screenshot({path:test.info().outputPath('search-mobile.png')});expect(errors).toEqual([]);
});
