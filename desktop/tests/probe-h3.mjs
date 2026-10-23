import {_electron as electron} from '@playwright/test';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const raw='\ufeff# heading sample\r\n\r\n## hello world\r\n\r\nsecond paragraph stays here\r\n\r\n'+
  Array.from({length:10},(_,index)=>`filler ${index+1}: scroll target line`).join('\r\n')+'\r\n';
const dir=await mkdtemp(join(tmpdir(),'note-probe-'));
const file=join(dir,'probe.md');
await writeFile(file,raw);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),file,'--user-data-dir='+join(dir,'profile')],env,timeout:60000});
const page=await app.firstWindow();
await page.locator('#filename').waitFor({timeout:30000});
await page.waitForTimeout(2500);
await page.locator('.cm-content').evaluate(content=>{
  const view=content.cmTile.root.view,from=view.state.doc.toString().indexOf('hello world');
  view.dispatch({selection:{anchor:from,head:from+'hello world'.length}});view.focus();
});
for(const delay of [100,300,600,1000,2000]) {
  await page.waitForTimeout(delay);
  console.log(JSON.stringify(await page.evaluate(()=>({
    menuHidden:document.querySelector('#selection-menu').hidden,
    menuRect:document.querySelector('#selection-menu').getBoundingClientRect().toJSON(),
    points:[...document.querySelector('.cm-content').cmTile.root.view.state.selection.ranges].map(r=>document.querySelector('.cm-content').cmTile.root.view.coordsAtPos(r.from,1)),
  }))));
}
await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
await app.close().catch(()=>{});
