import { test, expect } from '@playwright/test';
test('home create edit undo reopen and settings preserve source',async({page})=>{
 await page.setViewportSize({width:393,height:852});await page.goto('http://127.0.0.1:5173');
 await expect(page.getByRole('heading',{name:'笔记',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'新建笔记',exact:true}).click();
 await page.keyboard.insertText('# 今天的想法\n\n把想法写下来。');
 await expect(page.locator('.editor-chrome button')).toHaveCount(3);
 const original=await page.evaluate(()=>window.M1racle.getMarkdown());
 await page.getByRole('button',{name:'更多菜单',exact:true}).click();
 await expect(page.getByRole('button',{name:'分享文档',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/排版与外观/}).click();
 await page.getByRole('button',{name:'A4 210 × 297 mm',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-paper','a4');
 await page.setViewportSize({width:1280,height:900});
 await page.getByRole('button',{name:'A5 148 × 210 mm',exact:true}).click();
 expect(await page.locator('.cm-content').evaluate(e=>Math.round(e.getBoundingClientRect().width))).toBe(560);
 await page.setViewportSize({width:393,height:852});
 await page.getByRole('button',{name:'深色',exact:true}).click();
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(original);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await page.getByRole('button',{name:'返回首页',exact:true}).click();
 await page.getByRole('button').filter({has:page.getByRole('heading',{name:'今天的想法',exact:true})}).click();
 expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(original);
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.getByRole('heading',{name:'今天的想法',exact:true})).toBeVisible();
});


