import {test,expect} from '@playwright/test';

test('file actions say import copy and export remains frozen until the host finishes',async({page})=>{
 await page.addInitScript(()=>{(window as any).qaEvents=[];window.Native={postMessage:value=>(window as any).qaEvents.push(JSON.parse(value))};});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean(window.M1racle));
 await page.getByRole('button',{name:'首页菜单',exact:true}).click();await expect(page.getByRole('button',{name:'导入 Markdown 副本',exact:true})).toBeVisible();
 const raw='# 导出\r\n\r\n保留原文。\n尾行\r';
 await page.evaluate(raw=>window.M1racle.loadDocument({id:'export',path:'export.md',markdown:raw}),raw);
 await page.getByRole('button',{name:'更多菜单',exact:true}).click();await expect(page.getByRole('button',{name:'导入 Markdown 副本',exact:true})).toBeVisible();await page.getByRole('button',{name:'导出 Markdown',exact:true}).click();
 await expect(page.getByRole('status',{name:'正在导出文档'})).toBeVisible();await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','false');
 for(const name of ['返回首页','撤销','更多菜单'])await expect(page.getByRole('button',{name,exact:true})).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>(window as any).qaEvents.some((event:any)=>event.type==='export'))).toBe(true);
 await page.evaluate(()=>window.M1racle.focus());await page.keyboard.insertText('不得插入');expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
 await page.evaluate(()=>{window.M1racle.setBusy(false);window.M1racle.setReadOnly(false);});
 for(const name of ['返回首页','撤销','更多菜单'])await expect(page.getByRole('button',{name,exact:true})).toBeEnabled();
 await page.evaluate(()=>window.M1racle.focus());await page.keyboard.press('Control+End');await page.keyboard.insertText('继续写');expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw+'继续写');
 await page.evaluate(()=>window.M1racle.undo());expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);expect(errors).toEqual([]);
});
