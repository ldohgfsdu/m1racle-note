import {test,expect} from '@playwright/test';

for(const [paper,theme] of [['fluid','light'],['a4','light'],['a5','light'],['a4','dark'],['a5','dark']] as const){
 test(`selected text is visibly painted on ${paper} paper in ${theme} theme`,async({page})=>{
  await page.setViewportSize({width:393,height:650});
  await page.addInitScript(()=>{window.Native={postMessage:()=>{}};});
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>Boolean(window.M1racle));
  const raw='# 选区显示\n\n这段用于确认选中的文字清楚可见。\n';
  await page.evaluate(({raw,paper,theme})=>{window.M1racle.loadDocument({id:'visibility',path:'visibility.md',markdown:raw});window.M1racle.changePreferences({paper,theme});window.M1racle.focus();},{raw,paper,theme});
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const before=await page.screenshot({path:test.info().outputPath('before.png'),scale:'css'});
  await page.evaluate(()=>{const v=(document.querySelector('.cm-content') as any).cmTile.root.view,t=v.state.doc.toString(),from=t.indexOf('选中的文字');v.dispatch({selection:{anchor:from,head:from+5}});});
  const highlight=page.locator('.cm-selectionBackground');await expect(highlight).toHaveCount(1);const rect=await highlight.boundingBox();expect(rect).not.toBeNull();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const after=await page.screenshot({path:test.info().outputPath('after.png'),scale:'css'});
  // A nontransparent computed color is insufficient: an opaque paper layer can
  // cover it. Compare the actual pixels beneath the selected text instead.
  const difference=await page.evaluate(async({before,after,rect})=>{
   const pixels=async(encoded:string)=>{const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);const data=context.getImageData(0,0,bitmap.width,bitmap.height);bitmap.close();return data;};
   const a=await pixels(before),b=await pixels(after);let changed=0,total=0;
   for(let y=Math.ceil(rect.y);y<Math.floor(rect.y+rect.height);y++)for(let x=Math.ceil(rect.x);x<Math.floor(rect.x+rect.width);x++){
    const i=(y*a.width+x)*4;total++;if(Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])))>=8)changed++;
   }
   return {changed,total};
  },{before:before.toString('base64'),after:after.toString('base64'),rect:rect!});
  expect(difference.changed).toBeGreaterThan(difference.total*.15);
  expect(await page.evaluate(()=>window.M1racle.getMarkdown())).toBe(raw);
 });
}
