import {getHiddenLaunchMetadata} from './hidden-launch.mjs';
import {_electron as electron} from '@playwright/test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Read-only trace for the current C0 H0/H3 click -> Ctrl+E round-trip.
// This script does not import the C0 suite or execute product assertions.
const requested=(process.argv[2] || process.env.NOTE_QA_MODE || 'both').toUpperCase();
const cases=requested==='BOTH'?['H0','H3']:[requested];
if(cases.some(value=>!['H0','H3'].includes(value))) {
  throw new Error('usage: node desktop/tests/trace-heading-ctrle.mjs H0|H3|both');
}
const output=resolve(process.env.NOTE_QA_OUTPUT || 'docs/reviews/batch-3c/raw/trace-heading-ctrle');
const raw='\ufeff# heading sample\r\n\r\nhello world\r\n\r\nsecond paragraph stays here\r\n\r\n'+
  Array.from({length:120},(_,index)=>`filler ${index+1}: scroll target line`).join('\r\n')+'\r\n';
const fixture=raw.replace('\r\n\r\nhello world\r\n','\r\n\r\n## hello world\r\n');
await mkdir(output,{recursive:true});

function withDeadline(promise,timeoutMs,message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(message)),timeoutMs);
    }),
  ]).finally(()=>clearTimeout(timer));
}

async function traceCase(kind) {
  const level=Number(kind.slice(1));
  const dir=await mkdtemp(join(tmpdir(),`note-ctrle-${kind.toLowerCase()}-`));
  const file=join(dir,'floating-heading-h2.md');
  let launched;
  const evidence={case:kind,status:'running',deadlineMs:10000,events:[],snapshots:[],errors:[]};
  const tracePath=join(output,`${kind.toLowerCase()}-trace.json`);
  const writeEvidence=()=>writeFile(tracePath,JSON.stringify(evidence,null,2));
  const stage=(name,detail={})=>{
    evidence.events.push({name,at:Date.now(),...detail});
  };
  let launchMetadata;
  let chromeTestSwitchEnabled=null;
  let windowHandle;
  const snapshot=async(page,label)=>{
    if(!windowHandle)windowHandle=await launched.browserWindow(page);
    const [renderer,backgroundState]=await Promise.all([
      page.evaluate(label=>{
      const pane=document.querySelector('.pane');
      const content=document.querySelector('.cm-content');
      const view=content?.cmTile?.root?.view;
      const selection=view?.state?.selection?.main;
      const line=selection?view.state.doc.lineAt(selection.head):null;
      const error=document.getElementById('error');
      return {
        label,at:performance.now(),mode:pane?.dataset.mode||null,
        hidden:document.hidden,visibilityState:document.visibilityState,
        active:view?.hasFocus===true,
        activeElement:{
          tag:document.activeElement?.tagName||null,id:document.activeElement?.id||null,
          className:typeof document.activeElement?.className==='string'?document.activeElement.className:null,
        },
        selectionHidden:document.getElementById('selection-menu')?.hidden??null,
        blockHidden:document.getElementById('selection-text-options')?.hidden??null,
        appError:error?.hidden===false?document.getElementById('error-message')?.textContent:null,
        selection:selection?{
          anchor:selection.anchor,head:selection.head,from:selection.from,to:selection.to,
          empty:selection.empty,text:view.state.doc.sliceString(selection.from,selection.to),
        }:null,
        line:line?{number:line.number,from:line.from,to:line.to,text:line.text}:null,
        trace:globalThis.__noteCtrleTrace?{
          rafCount:globalThis.__noteCtrleTrace.rafCount,
          keydowns:globalThis.__noteCtrleTrace.keydowns.slice(),
          modeChanges:globalThis.__noteCtrleTrace.modeChanges.slice(),
          selectionReads:globalThis.__noteCtrleTrace.selectionReads.slice(),
          animationFrames:globalThis.__noteCtrleTrace.animationFrames.slice(),
        }:null,
      };
      },label),
      windowHandle.evaluate(window=>{
        const contents=window.webContents;
        let api;
        if(typeof contents.getLastWebPreferences==='function') {
          try {
            api={available:true,value:contents.getLastWebPreferences()};
          } catch(error) {
            api={available:true,error:String(error?.message||error)};
          }
        } else api={available:false,reason:'webContents.getLastWebPreferences is unavailable'};
        return {
          windowMode:globalThis.__noteHiddenBrowserWindowMode??null,
          isOffscreen:typeof contents.isOffscreen==='function'?contents.isOffscreen():null,
          getBackgroundThrottling:contents.getBackgroundThrottling(),
          getFrameRate:typeof contents.getFrameRate==='function'?contents.getFrameRate():null,
          getLastWebPreferences:api,
        };
      }).catch(error=>({
        error:String(error?.message||error),
      })),
    ]);
    const value={
      ...renderer,
      main:{
        windowMode:backgroundState.windowMode??null,
        isOffscreen:backgroundState.isOffscreen??null,
        webContentsBackgroundThrottling:backgroundState.getBackgroundThrottling,
        webContentsFrameRate:backgroundState.getFrameRate??null,
        lastWebPreferences:backgroundState.getLastWebPreferences,
        chromeTestSwitchEnabled,
        launchMetadata,
        error:backgroundState.error??null,
      },
    };
    evidence.snapshots.push(value);
    await writeEvidence();
    return value;
  };
  const ctrlE=async(page,label)=>{
    await snapshot(page,`${label}:before`);
    stage(`${label}:keydown`);
    await page.keyboard.down('Control');
    await page.keyboard.down('e');
    await snapshot(page,`${label}:keydown-immediate`);
    await page.keyboard.up('e');
    await page.keyboard.up('Control');
    await snapshot(page,`${label}:immediate`);
    await page.waitForTimeout(300);
    await snapshot(page,`${label}:after-300ms`);
  };

  try {
    await writeFile(file,fixture);
    const env={...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    launched=await withDeadline(electron.launch({
      executablePath:resolve('node_modules/electron/dist/electron.exe'),
      args:[resolve('desktop/main.mjs'),file,'--user-data-dir='+join(dir,'profile')],
      env,timeout:10000,
    }),10000,`${kind}: Electron launch exceeded 10000ms`);
    const page=await withDeadline(
      launched.firstWindow(),
      10000,
      `${kind}: firstWindow exceeded 10000ms`,
    );
    launchMetadata=getHiddenLaunchMetadata(launched);
    chromeTestSwitchEnabled=await launched.evaluate(({app})=>
      app.commandLine.hasSwitch('disable-backgrounding-occluded-windows'));
    page.on('pageerror',error=>evidence.errors.push({kind:'pageerror',message:error.message}));
    page.on('console',message=>{
      if(message.type()==='error')evidence.errors.push({kind:'console',message:message.text()});
    });

    await withDeadline((async()=>{
      await page.locator('#filename').filter({hasText:'floating-heading-h2.md'}).waitFor({timeout:10000});
      await page.waitForFunction(()=>document.querySelector('.cm-content')?.cmTile?.root?.view?.state?.doc?.length>0);

      // Observe the real event path. Pane.busy is an object field, so the
      // source of an ignored toggle is inferred from keydown and mode changes.
      await page.evaluate(()=>{
        const trace={keydowns:[],modeChanges:[],selectionReads:[],animationFrames:[],rafCount:0};
        globalThis.__noteCtrleTrace=trace;
        const recordKey=(event,phase)=>{
          if(event.key.toLowerCase()!=='e' || !(event.ctrlKey||event.metaKey))return;
          const content=document.querySelector('.cm-content');
          const view=content?.cmTile?.root?.view;
          const selection=view?.state?.selection?.main;
          const entry={
            phase,at:performance.now(),key:event.key,code:event.code,
            ctrl:event.ctrlKey,alt:event.altKey,shift:event.shiftKey,meta:event.metaKey,
            repeat:event.repeat,isComposing:event.isComposing,keyCode:event.keyCode,
            defaultPrevented:event.defaultPrevented,target:event.target?.tagName||null,
            active:document.activeElement?.tagName||null,
            mode:document.querySelector('.pane')?.dataset.mode||null,
            selection:selection?{anchor:selection.anchor,head:selection.head,empty:selection.empty}:null,
          };
          trace.keydowns.push(entry);
          trace.selectionReads.push({source:`keydown:${phase}`,...entry});
        };
        document.addEventListener('keydown',event=>recordKey(event,'capture'),true);
        document.addEventListener('keyup',event=>recordKey(event,'keyup-capture'),true);
        new MutationObserver(records=>{
          const content=document.querySelector('.cm-content');
          const view=content?.cmTile?.root?.view;
          const selection=view?.state?.selection?.main;
          for(const record of records) {
            if(record.attributeName!=='data-mode')continue;
            const mode=document.querySelector('.pane')?.dataset.mode||null;
            const entry={
              at:performance.now(),oldValue:record.oldValue,mode,
              selection:selection?{anchor:selection.anchor,head:selection.head,empty:selection.empty}:null,
            };
            trace.modeChanges.push(entry);
            trace.selectionReads.push({source:'mode-mutation',...entry});
          }
        }).observe(document.querySelector('.pane'),{
          attributes:true,attributeFilter:['data-mode'],attributeOldValue:true,
        });
        globalThis.__noteCtrleRafs=()=>new Promise(resolve=>{
          const started=performance.now(),frames=[];
          let timer,requestId,finished=false;
          const finish=value=>{
            if(finished)return;
            finished=true;
            clearTimeout(timer);
            if(requestId!==undefined)cancelAnimationFrame(requestId);
            const result={...value,frames:frames.slice(),rafCount:trace.rafCount,
              mode:document.querySelector('.pane')?.dataset.mode||null};
            trace.animationFrames.push(result);
            resolve(result);
          };
          const tick=timestamp=>{
            if(finished)return;
            trace.rafCount++;
            frames.push({index:frames.length+1,at:performance.now(),timestamp});
            if(frames.length===5)finish({durationMs:performance.now()-started});
            else requestId=requestAnimationFrame(tick);
          };
          timer=setTimeout(()=>finish({
            durationMs:performance.now()-started,error:'5-frame wait exceeded 3000ms',
          }),3000);
          requestId=requestAnimationFrame(tick);
        });
      });
      await snapshot(page,'initial');

      await page.locator('.cm-content').evaluate(content=>{
        const view=content.cmTile.root.view,from=view.state.doc.toString().indexOf('hello world');
        if(from<0)throw new Error('hello world is missing from the fixture');
        view.dispatch({selection:{anchor:from,head:from+'hello world'.length},scrollIntoView:true});
        view.focus();
      });
      await page.waitForFunction(()=>!document.querySelector('#selection-menu').hidden);
      await snapshot(page,'selected');

      const trigger=await page.locator('[data-selection-submenu="text"]').boundingBox();
      await page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
      await page.waitForFunction(()=>!document.querySelector('#selection-text-options').hidden);
      await snapshot(page,'heading-menu-open');
      const item=page.locator(`#selection-text-options [data-selection-format="heading-${level}"]`);
      const itemBox=await item.boundingBox();
      await page.mouse.click(itemBox.x+itemBox.width/2,itemBox.y+itemBox.height/2);
      const formatted=level===0?'hello world':'### hello world';
      await page.waitForFunction(formatted=>{
        const view=document.querySelector('.cm-content').cmTile.root.view;
        return view.state.doc.line(3).text===formatted;
      },formatted);
      await snapshot(page,'formatted');

      if(kind==='H3') {
        await page.keyboard.type('!');
        await page.waitForFunction(()=>{
          const view=document.querySelector('.cm-content').cmTile.root.view;
          return view.state.doc.line(3).text==='### hello world!';
        });
        await snapshot(page,'typed');
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.querySelector('#selection-menu').hidden);
      await snapshot(page,'selection-dismissed');

      await ctrlE(page,'ctrl-e-1');
      await withDeadline(page.evaluate(()=>globalThis.__noteCtrleRafs()),3500,
        `${kind}: five-frame trace after first Ctrl+E exceeded 3500ms`);
      await snapshot(page,'ctrl-e-1:five-frames');
      await ctrlE(page,'ctrl-e-2');
      await withDeadline(page.evaluate(()=>globalThis.__noteCtrleRafs()),3500,
        `${kind}: five-frame trace after second Ctrl+E exceeded 3500ms`);
      await snapshot(page,'ctrl-e-2:five-frames');
      evidence.status='PASS';
    })(),10000,`${kind}: renderer trace exceeded 10000ms`);
  } catch(error) {
    evidence.status='FAIL';
    evidence.error=String(error?.stack||error);
    // Preserve the original failure before attempting app shutdown.
    await writeEvidence().catch(()=>{});
  } finally {
    if(launched) {
      await launched.evaluate(({app})=>app.exit(0)).catch(()=>{});
    }
    await windowHandle?.dispose().catch(()=>{});
    await writeEvidence().catch(()=>{});
    await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{});
  }
  await writeFile(join(output,`${kind.toLowerCase()}-trace-summary.json`),JSON.stringify({
    case:kind,status:evidence.status,error:evidence.error||null,
  },null,2));
  return evidence;
}

const summaries=[];
for(const kind of cases)summaries.push(await traceCase(kind));
console.log(JSON.stringify({output,summaries:summaries.map(item=>({
  case:item.case,status:item.status,error:item.error||null,
}))},null,2));
if(summaries.some(item=>item.status!=='PASS'))process.exitCode=1;
