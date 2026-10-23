import './hidden-launch.mjs';
import {captureHidden} from './evidence-capture.mjs';
import {_electron as electron} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Batch 3C.0: real Electron geometry for both heading entry points.
const output=process.env.NOTE_QA_OUTPUT || resolve('docs/reviews/batch-3c/raw/green');
const phase=process.env.NOTE_QA_PHASE || 'green';
const caseFilter=process.env.NOTE_QA_CASE || '';
const skippedCases=new Set((process.env.NOTE_QA_SKIP_CASE || '').split(',').filter(Boolean));
const shots=join(output,'screens');
const pageApps=new WeakMap();
const name='floating-heading-menu.md';
const hiddenMain=resolve('desktop/tests/hidden-main.cjs').replaceAll('\\','/');
const raw='\ufeff# heading sample\r\n\r\nhello world\r\n\r\nsecond paragraph stays here\r\n\r\n'+
  Array.from({length:120},(_,index)=>`filler ${index+1}: scroll target line`).join('\r\n')+'\r\n';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function poll(fn,predicate,{timeout=5000,interval=50,message='condition not met',startedAt}={}) {
  const anchored=Number.isFinite(startedAt);
  const started=anchored?startedAt:Date.now();
  let last;
  while(Date.now()-started<=timeout) {
    last=await fn();
    if(await predicate(last)) {
      if(anchored && Date.now()-started>timeout) throw new Error(`${message}: exceeded ${timeout}ms from the action`);
      return last;
    }
    await sleep(interval);
  }
  throw new Error(anchored
    ? `${message}: elapsed ${Date.now()-started}ms exceeds ${timeout}ms: ${String(last)}`
    : `${message}: ${String(last)}`);
}

async function waitFor(page,fn,arg,message,timeout=10000) {
  try {
    await page.waitForFunction(fn,arg,{timeout});
  } catch(error) {
    throw new Error(`${message}: ${error.message}`);
  }
}

async function waitForStage(page,stage,fn,arg,timeout=10000) {
  try {
    await page.waitForFunction(fn,arg,{timeout});
  } catch(error) {
    throw new Error(`${stage}: ${error.message}`);
  }
}

async function settleMeasuredLayout(page) {
  await page.locator('.cm-content').evaluate(content=>new Promise(resolve=>{
    const view=content.cmTile.root.view;
    view.requestMeasure({read:()=>requestAnimationFrame(()=>resolve(true))});
  }));
}

async function waitForSemanticTransitionFrames(page,label,{frames=4,timeout=10000}={}) {
  const started=performance.now();
  const samples=await page.evaluate(({label,frames,timeout})=>new Promise(resolve=>{
    const timestamps=[];
    const began=performance.now();
    let frameId=null;
    let timerId=null;
    let settled=false;
    const finish=(completed,reason)=>{
      if(settled)return;
      settled=true;
      if(frameId!==null)cancelAnimationFrame(frameId);
      if(timerId!==null)clearTimeout(timerId);
      resolve({
        label,completed,reason,frames:timestamps.length,timestamps,
        elapsed:performance.now()-began,timeout,
      });
    };
    const tick=timestamp=>{
      frameId=null;
      timestamps.push(timestamp);
      if(timestamps.length>=frames)return finish(true,'frames');
      frameId=requestAnimationFrame(tick);
    };
    timerId=setTimeout(()=>finish(false,'timeout'),timeout);
    frameId=requestAnimationFrame(tick);
  }),{label,frames,timeout});
  const result={...samples,wallElapsed:performance.now()-started};
  if(!result.completed)throw Object.assign(new Error(
    `${label}: semantic transition exceeded ${timeout}ms after ${result.frames}/${frames} animation frames; samples=${JSON.stringify(result.timestamps)}`,
  ),{transitionSamples:result});
  return result;
}

async function claimTextSelection(page,needle) {
  const from=await page.locator('.cm-content').evaluate((content,text)=>{
    const view=content.cmTile.root.view,from=view.state.doc.toString().indexOf(text);
    view.dispatch({selection:{anchor:from,head:from+text.length},scrollIntoView:true});
    view.focus();
    return from;
  },needle);
  assert.ok(from>=0,'test fixture text is missing');
  await page.waitForFunction(text=>{
    const view=document.querySelector('.cm-content').cmTile.root.view,{from,to}=view.state.selection.main;
    return view.state.doc.sliceString(from,to)===text;
  },needle);
}

function exactHeadingSource(expectedLine) {
  return raw.replace('\r\n\r\nhello world\r\n',`\r\n\r\n${expectedLine}\r\n`);
}

await mkdir(output,{recursive:true});
await mkdir(shots,{recursive:true});


function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function collectProcessLogs(app) {
  const stdout = [], stderr = [], limit = 200000;
  const push = (bucket, chunk) => {
    bucket.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    let size = 0;
    for (const part of bucket) size += part.length;
    while (size > limit && bucket.length > 1) size -= bucket.shift().length;
  };
  const logs = {pid: null, stdout, stderr};
  try {
    const proc = app.process();
    logs.pid = proc.pid ?? null;
    proc.stdout?.on("data", chunk => push(stdout, chunk));
    proc.stderr?.on("data", chunk => push(stderr, chunk));
  } catch (error) {
    stderr.push("process log attach failed: " + (error?.message || error));
  }
  return logs;
}
function splitThirdLine(text) {
  const bom = text.startsWith("\ufeff");
  const body = bom ? text.slice(1) : text;
  const pieces = body.split(/(\r\n|\n|\r)/);
  const hasThird = pieces.length >= 5;
  return {
    bom,
    line: hasThird ? pieces[4] : null,
    prefix: hasThird ? pieces.slice(0, 4).join("") : null,
    suffix: hasThird ? pieces.slice(5).join("") : null,
    crlf: (body.match(/\r\n/g) || []).length,
    bareLf: (body.match(/(?<!\r)\n/g) || []).length,
    bareCr: (body.match(/\r(?!\n)/g) || []).length,
  };
}
function firstMismatch(left, right) {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index++) if (left[index] !== right[index]) return index;
  return left.length === right.length ? -1 : count;
}
function byteRecord(bytes) {
  return {byteLength: bytes.length, sha256: sha256Bytes(bytes), base64: bytes.toString("base64")};
}
function privateFromTraces(events) {
  const traced = (events || []).filter(event => typeof event?.dirty === "boolean");
  if (!traced.length) return {observed: false, source: "not-observed", dirty: null, saveFailed: null, status: null};
  const last = traced[traced.length - 1];
  return {
    observed: true, source: "renderer-field", dirty: last.dirty === true, saveFailed: last.saveFailed === true,
    draftFailed: last.draftFailed === true, status: last.status ?? null, hasFilename: last.hasFilename === true,
    composing: last.composing === true, rawLength: last.rawLength ?? null, rawHashFnv: last.rawHashFnv ?? null,
    savedLength: last.savedLength ?? null, savedHashFnv: last.savedHashFnv ?? null, event: last.event ?? null, at: last.t ?? null,
  };
}
function parseTraceLog(text) {
  const events = String(text || "").split(/\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return {unparsed: line.slice(0, 500)}; }
  });
  return {
    events,
    ipcHookInstalled: events.some(event => event.event === "ipc-hook" && event.ok === true),
    sessionWrapInstalled: events.some(event => event.event === "session-wrap" && event.ok === true),
    pids: [...new Set(events.map(event => event.pid).filter(pid => pid != null))],
    profiles: [...new Set(events.map(event => event.profile).filter(profile => typeof profile === "string" && profile))],
  };
}
function pathsAgree(values) {
  const present = values.map(value => typeof value === "string" && value ? resolve(value).replaceAll("/", "\\").toLowerCase() : null).filter(Boolean);
  return present.length > 0 && present.every(value => value === present[0]);
}
function summarizeSaveEvidence(evidence, file) {
  return {
    file,
    exactBytes: evidence.disk?.matchesExpected === true,
    actualSha256: evidence.disk?.actual?.sha256 ?? null,
    actualBytes: evidence.disk?.actual?.byteLength ?? null,
    domStatus: evidence.dom?.status ?? null,
    domDataState: evidence.dom?.dataState ?? null,
    diagFlag: evidence.diagFlag === true,
    privateDirty: evidence.private?.observed ? evidence.private.dirty : null,
    privateDirtySource: evidence.private?.source || "not-observed",
    privateSaveFailed: evidence.private?.observed ? evidence.private.saveFailed : null,
    privateStatus: evidence.private?.observed ? evidence.private.status : null,
    ipcHookInstalled: evidence.hooks?.ipcHookInstalled === true,
    sessionWrapInstalled: evidence.hooks?.sessionWrapInstalled === true,
    launchPid: evidence.correlation?.launchPid ?? null,
    mainPid: evidence.correlation?.mainPid ?? null,
    mainParentPid: evidence.correlation?.mainParentPid ?? null,
    tracePids: evidence.correlation?.tracePids || [],
    traceMatchesMain: evidence.correlation?.traceMatchesMain === true,
    launcherMatches: evidence.correlation?.launcherMatches === true,
    profiles: evidence.correlation?.profiles || [],
    pidMatches: evidence.correlation?.pidMatches === true,
    profileMatches: evidence.correlation?.profileMatches === true,
  };
}
async function buildSaveEvidence(launched, details) {
  const evidence = {
    schema: 1, id: details.id, phase, at: new Date().toISOString(), pollWindowMs: 5000, diagnosticIo: "after-poll",
    actionEndedAt: details.actionEndedAt ?? null, pollStartedAt: details.pollStartedAt ?? null, typedAt: details.typedAt ?? null,
    elapsedSinceActionMs: details.actionEndedAt == null ? null : Date.now() - details.actionEndedAt,
    error: details.error ? {message: String(details.error.message || details.error), stack: String(details.error.stack || "")} : null,
  };
  try {
    const ui = await launched.page.evaluate(() => {
      const view = document.querySelector(".cm-content")?.cmTile?.root?.view;
      const status = document.querySelector("#status");
      const errorBox = document.querySelector("#error");
      const pane = document.querySelector(".pane");
      const filename = document.querySelector("#filename");
      const doc = view?.state?.doc?.toString() ?? "";
      const selection = view?.state?.selection?.main;
      return {
        dom: {
          errorHidden: errorBox ? errorBox.hidden === true : null,
          errorMessage: document.querySelector("#error-message")?.textContent ?? null,
          status: status?.textContent ?? null,
          dataState: status?.getAttribute("data-state") ?? null,
          mode: pane?.dataset?.mode ?? null,
          filenameText: filename?.textContent ?? null,
          filenameDirtyMark: typeof filename?.textContent === "string" && filename.textContent.endsWith(" \u00b7"),
        },
        editor: {
          composing: view?.composing === true, doc, docLength: doc.length,
          selection: selection ? {empty: selection.empty === true, anchor: selection.anchor, head: selection.head} : null,
        },
        diagFlag: globalThis.__noteQaSaveDiag === true,
        privateTrace: Array.isArray(globalThis.__noteQaSaveTrace) ? globalThis.__noteQaSaveTrace.slice() : null,
      };
    });
    const doc = ui.editor.doc ?? "";
    ui.editor.docUtf8Sha256 = sha256Bytes(Buffer.from(doc, "utf8"));
    delete ui.editor.doc;
    evidence.dom = ui.dom;
    evidence.domNote = "filenameDirtyMark is the visible filename suffix, not Pane.dirty";
    evidence.editor = ui.editor;
    evidence.diagFlag = ui.diagFlag === true;
    evidence.private = privateFromTraces(ui.privateTrace);
    evidence.privateEvents = ui.privateTrace || [];
  } catch (error) {
    evidence.uiError = String(error?.message || error);
    evidence.private = {observed: false, source: "not-observed", dirty: null, saveFailed: null, status: null};
  }
  try {
    evidence.native = await launched.app.evaluate(({BrowserWindow, app}) => ({
      pid: process.pid,
      ppid: process.ppid,
      mainPid: process.pid,
      mainParentPid: process.ppid,
      profile: app.getPath("userData"),
      windows: BrowserWindow.getAllWindows().map(window => ({isVisible: window.isVisible(), isFocused: window.isFocused()})),
    }));
  } catch (error) {
    evidence.nativeError = String(error?.message || error);
  }
  const initialBytes = Buffer.from(String(launched.initialText ?? ""), "utf8");
  const expectedBytes = details.expectedText == null ? null : Buffer.from(String(details.expectedText), "utf8");
  let actualBytes = null;
  try {
    actualBytes = await readFile(launched.file);
  } catch (error) {
    evidence.diskError = {message: String(error?.message || error), code: error?.code ?? null, syscall: error?.syscall ?? null, path: error?.path ?? null};
  }
  const initialParts = splitThirdLine(String(launched.initialText ?? ""));
  const expectedParts = details.expectedText == null ? null : splitThirdLine(String(details.expectedText));
  const actualParts = actualBytes ? splitThirdLine(actualBytes.toString("utf8")) : null;
  evidence.disk = {
    initialMtimeMs: launched.initialStat?.mtimeMs ?? null,
    actualMtimeMs: actualBytes ? (await stat(launched.file)).mtimeMs : null,
    initial: byteRecord(initialBytes),
    expected: expectedBytes ? byteRecord(expectedBytes) : null,
    actual: actualBytes ? byteRecord(actualBytes) : null,
    matchesExpected: !!(actualBytes && expectedBytes && actualBytes.equals(expectedBytes)),
    unchangedFromInitial: !!(actualBytes && actualBytes.equals(initialBytes)),
    firstMismatchOffset: actualBytes && expectedBytes ? firstMismatch(expectedBytes, actualBytes) : null,
    thirdLine: {initial: initialParts.line, expected: expectedParts?.line ?? null, actual: actualParts?.line ?? null},
    versusExpected: expectedParts && actualParts ? {
      bom: actualParts.bom === expectedParts.bom,
      eol: actualParts.crlf === expectedParts.crlf && actualParts.bareLf === expectedParts.bareLf && actualParts.bareCr === expectedParts.bareCr,
      uneditedPrefix: actualParts.prefix != null && actualParts.prefix === expectedParts.prefix,
      uneditedSuffix: actualParts.suffix != null && actualParts.suffix === expectedParts.suffix,
      thirdLine: actualParts.line === expectedParts.line,
    } : null,
    eol: {
      initial: {crlf: initialParts.crlf, bareLf: initialParts.bareLf, bareCr: initialParts.bareCr, bom: initialParts.bom},
      expected: expectedParts ? {crlf: expectedParts.crlf, bareLf: expectedParts.bareLf, bareCr: expectedParts.bareCr, bom: expectedParts.bom} : null,
      actual: actualParts ? {crlf: actualParts.crlf, bareLf: actualParts.bareLf, bareCr: actualParts.bareCr, bom: actualParts.bom} : null,
    },
  };
  let parsed = {events: [], ipcHookInstalled: false, sessionWrapInstalled: false, pids: [], profiles: []};
  if (launched.traceLog) {
    try { parsed = parseTraceLog(await readFile(launched.traceLog, "utf8")); }
    catch (error) { evidence.traceError = String(error?.message || error); }
  } else evidence.traceError = "no trace log requested";
  evidence.hooks = {
    ipcHookInstalled: parsed.ipcHookInstalled === true,
    sessionWrapInstalled: parsed.sessionWrapInstalled === true,
    traceMissing: !parsed.ipcHookInstalled && !parsed.sessionWrapInstalled,
  };
  evidence.traceEvents = parsed.events;
  const launchPid = launched.processLogs?.pid ?? null;
  const mainPid = evidence.native?.mainPid ?? evidence.native?.pid ?? null;
  const mainParentPid = evidence.native?.mainParentPid ?? evidence.native?.ppid ?? null;
  const tracePids = parsed.pids;
  const profiles = [launched.profile, evidence.native?.profile, ...parsed.profiles];
  const traceMatchesMain = mainPid != null && tracePids.length > 0 && tracePids.every(pid => pid === mainPid);
  const launcherMatches = launchPid != null && (launchPid === mainPid || (mainParentPid != null && launchPid === mainParentPid));
  evidence.correlation = {
    launchPid, mainPid, mainParentPid, tracePids, traceProfiles: parsed.profiles,
    traceMatchesMain, launcherMatches,
    launchProfile: launched.profile || null, nativeProfile: evidence.native?.profile ?? null,
    profiles: [...new Set(profiles.filter(profile => typeof profile === "string" && profile))],
    pidMatches: traceMatchesMain && launcherMatches,
    profileMatches: parsed.profiles.length > 0 && pathsAgree(profiles),
    pidNote: "launchPid is app.process(), the Playwright launcher handle. mainPid is process.pid in the app. mainParentPid is process.ppid. Every trace pid must be mainPid. launchPid must be mainPid or mainParentPid.",
  };
  evidence.process = {launchPid, pid: launchPid, stdout: (launched.processLogs?.stdout || []).join(""), stderr: (launched.processLogs?.stderr || []).join("")};
  evidence.rendererConsole = launched.rendererTrace || [];
  evidence.savedState = {
    domStatus: evidence.dom?.status ?? null,
    domDataState: evidence.dom?.dataState ?? null,
    errorMessage: evidence.dom?.errorMessage ?? null,
    privateObserved: evidence.private?.observed === true,
    privateDirty: evidence.private?.observed ? evidence.private.dirty : null,
    privateDirtySource: evidence.private?.source || "not-observed",
    privateSaveFailed: evidence.private?.observed ? evidence.private.saveFailed : null,
    privateStatus: evidence.private?.observed ? evidence.private.status : null,
  };
  return evidence;
}
async function recordSaveOutcome(launched, details) {
  const evidence = await buildSaveEvidence(launched, details);
  const file = join(output, `${phase}-${details.id}-save-outcome.json`);
  await writeFile(file, JSON.stringify(evidence, null, 2));
  return summarizeSaveEvidence(evidence, file);
}
async function attachSaveDiagnostic(launched, error, details) {
  try {
    const evidence = await buildSaveEvidence(launched, {...details, error});
    const file = join(output, `${phase}-${details.id}-save-diagnostic.json`);
    await writeFile(file, JSON.stringify(evidence, null, 2));
    error.saveDiagnostic = file;
  } catch (captureError) {
    error.saveDiagnostic = {captureError: String(captureError?.message || captureError)};
  }
}


function assertDiagnosticSaveAccepted(outcome, label) {
  const problems=[];
  if(!outcome || outcome.recordError) problems.push('evidence record failed: '+(outcome?.recordError||'missing outcome'));
  if(outcome?.diagFlag!==true || outcome?.ipcHookInstalled!==true || outcome?.sessionWrapInstalled!==true || outcome?.pidMatches!==true || outcome?.profileMatches!==true) {
    problems.push('diagnostic install/correlation failed: flag='+outcome?.diagFlag+' ipc='+outcome?.ipcHookInstalled+' session='+outcome?.sessionWrapInstalled+' pid='+outcome?.pidMatches+' traceMatchesMain='+outcome?.traceMatchesMain+' launcherMatches='+outcome?.launcherMatches+' launchPid='+outcome?.launchPid+' mainPid='+outcome?.mainPid+' mainParentPid='+outcome?.mainParentPid+' tracePids='+JSON.stringify(outcome?.tracePids||[])+' profile='+outcome?.profileMatches+' profiles='+JSON.stringify(outcome?.profiles||[]));
  }
  if(outcome?.exactBytes!==true) problems.push('exact bytes failed: sha='+outcome?.actualSha256+' bytes='+outcome?.actualBytes);
  if(outcome?.domStatus!=='已保存' || outcome?.domDataState!=='saved' || outcome?.privateStatus!=='已保存') {
    problems.push('saved state failed: status='+JSON.stringify(outcome?.domStatus)+' data-state='+JSON.stringify(outcome?.domDataState)+' privateStatus='+JSON.stringify(outcome?.privateStatus));
  }
  if(outcome?.privateDirtySource!=='renderer-field' || outcome?.privateDirty!==false || outcome?.privateSaveFailed!==false) {
    problems.push('private save state failed: source='+outcome?.privateDirtySource+' dirty='+outcome?.privateDirty+' saveFailed='+outcome?.privateSaveFailed);
  }
  if(problems.length) throw new Error(label+' diagnostic acceptance failed: '+problems.join(' | ')+' outcome='+(outcome?.file||'none'));
  outcome.accepted=true;
  return outcome;
}

async function launch({dark=false,width=1000,height=700,heading=false,saveDiag=false,diagId='save'}={}) {
  const dir=await mkdtemp(join(tmpdir(),'note-3c0-'));
  const fileName=heading?'floating-heading-h2.md':name;
  const file=join(dir,fileName);
  const initialText=fixtureSource(heading);
  await writeFile(file,initialText);
  const initialStat=await stat(file);
  const env={...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const traceLog=saveDiag?join(output,`${phase}-${diagId}-save-trace.jsonl`):'';
  if(saveDiag){
    env.NOTE_QA_SAVE_DIAG='1';
    env.NOTE_QA_SAVE_DIAG_LOG=traceLog;
  }
  const launchArgs=[resolve('desktop/main.mjs'),file,'--user-data-dir='+join(dir,'profile')];
  // Playwright removes NODE_OPTIONS, so the child gets an explicit -r.
  if(saveDiag)launchArgs.unshift('-r',resolve('desktop/tests/save-diagnostics.cjs'));
  const app=await electron.launch({
    executablePath:resolve('node_modules/electron/dist/electron.exe'),
    args:launchArgs,
    env,
    timeout:60000,
  });
  const page=await app.firstWindow(),errors=[];
  const rendererTrace=[];
  const processLogs=saveDiag?collectProcessLogs(app):null;
  pageApps.set(page,app);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    const text=message.text();
    if(saveDiag && text.startsWith('[note-qa-save]'))rendererTrace.push({type:message.type(),text});
    if(message.type()==='error')errors.push(text);
  });
  await page.locator('#filename').filter({hasText:fileName}).waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('.cm-content')?.cmTile?.root?.view?.state?.doc?.length>0);
  if(saveDiag)await page.evaluate(()=>{globalThis.__noteQaSaveDiag=true;});
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size.width,size.height),{width,height});
  await sleep(180);
  if(dark!==await page.evaluate(()=>document.documentElement.classList.contains('dark'))) {
    await page.locator('#theme').click();
    await page.waitForFunction(want=>document.documentElement.classList.contains('dark')===want,dark);
  }
  return {app,page,errors,dir,file,initialText,initialStat,profile:join(dir,'profile'),traceLog,rendererTrace,processLogs,saveDiag};
}

function fixtureSource(heading=false) {
  return heading?raw.replace('\r\n\r\nhello world\r\n','\r\n\r\n## hello world\r\n'):raw;
}

async function close(launched) {
  await launched.app.evaluate(({app})=>app.exit(0)).catch(()=>{});
  await launched.app.close().catch(()=>{});
  await rm(launched.dir,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{});
}

async function runNarrowAndResize(id) {
  const launched=await launch({width:760,height:600});
  try {
    await selectHelloWorld(launched.page);
    const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>document.querySelector('#selection-text-options')?.hidden===false);
    const before=await geometry(launched.page,id+'-before-resize');
    await launched.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(720,560));
    await sleep(180);
    const after=await geometry(launched.page,id+'-after-resize');
    const image=await shot(launched.page,id+'-after-resize');
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({before,after,image},null,2));
    assertFloating(after);
    assert.deepEqual(after.selection,before.selection,'resize changed the selection');
    return {before,after,image};
  } finally {await close(launched);}
}

async function selectHelloWorld(page) {
  await claimTextSelection(page,'hello world');
  await page.waitForFunction(()=>{
    const menu=document.querySelector('#selection-menu');
    return menu&&!menu.hidden&&menu.getBoundingClientRect().width>0;
  });
  await page.waitForFunction(()=>document.querySelector('[data-selection-submenu="text"]')?.getAttribute('aria-expanded')==='false');
  await sleep(180);
}

async function openFloatingHeading(page) {
  const trigger=await page.locator('[data-selection-submenu="text"]').boundingBox();
  assert.ok(trigger,'floating heading trigger has a box');
  await page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
  await page.waitForFunction(()=>{
    const panel=document.querySelector('#selection-text-options');
    return panel&&!panel.hidden&&panel.getBoundingClientRect().width>0;
  });
  await sleep(100);
}

async function collapseSelection(page,text='hello world') {
  await page.locator('.cm-content').evaluate((content,needle)=>{
    const view=content.cmTile.root.view,at=view.state.doc.toString().indexOf(needle);
    view.dispatch({selection:{anchor:at>=0?at:0}});
    view.focus();
  },text);
  await page.waitForFunction(()=>document.querySelector('#selection-menu').hidden);
}

async function geometry(page,label) {
  return page.evaluate(label=>{
    const round=value=>Math.round(value*100)/100;
    const rect=value=>value&&({
      left:round(value.left),top:round(value.top),right:round(value.right),bottom:round(value.bottom),
      width:round(value.width),height:round(value.height),
    });
    const view=document.querySelector('.cm-content').cmTile.root.view;
    const toolbar=document.querySelector('#selection-menu');
    const trigger=toolbar.querySelector('[data-selection-submenu="text"]');
    const h2=document.querySelector('#selection-text-options [data-selection-format="heading-2"]');
    const floating=document.querySelector('#selection-text-options');
    const topTrigger=document.querySelector('#heading-level');
    const topMenu=document.querySelector('#heading-menu .heading-options');
    const editor=view.scrollDOM.getBoundingClientRect();
    const selection=view.state.selection.main;
    const line=view.state.doc.lineAt(selection.from);
    const mr=floating.hidden?null:floating.getBoundingClientRect();
    const tr=trigger.getBoundingClientRect();
    const tm=topTrigger.closest('details').open?topMenu.getBoundingClientRect():null;
    const tt=topTrigger.getBoundingClientRect();
    const relationship=(menu,anchor)=>menu?({
      leftDelta:round(menu.left-anchor.left),
      rightDelta:round(menu.right-anchor.right),
      belowGap:round(menu.top-anchor.bottom),
      aboveGap:round(anchor.top-menu.bottom),
      horizontalGap:round(menu.left-anchor.right),
      overlapsTrigger:Math.min(menu.right,anchor.right)>Math.max(menu.left,anchor.left)&&
        Math.min(menu.bottom,anchor.bottom)>Math.max(menu.top,anchor.top),
    }):null;
    const overflow=menu=>menu?({
      left:round(Math.max(0,-menu.left)),right:round(Math.max(0,menu.right-innerWidth)),
      top:round(Math.max(0,-menu.top)),bottom:round(Math.max(0,menu.bottom-innerHeight)),
    }):null;
    const cs=getComputedStyle(floating);
    const ancestors=[];
    for(let node=floating.parentElement;node&&node!==document.documentElement;node=node.parentElement){
      const style=getComputedStyle(node),r=node.getBoundingClientRect();
      const noteworthy=style.position!=='static'||style.transform!=='none'||style.filter!=='none'||
        style.perspective!=='none'||style.width!=='0px'||style.height!=='0px';
      if(noteworthy)ancestors.push({
        tag:node.tagName.toLowerCase(),
        id:node.id||null,
        className:typeof node.className==='string'?node.className:null,
        position:style.position,
        transform:style.transform,
        filter:style.filter,
        perspective:style.perspective,
        overflow:style.overflow,
        rect:rect(r),
      });
      if(ancestors.length>=16)break;
    }
    return {
      label,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
      editor:rect(editor),
      toolbar:{hidden:toolbar.hidden,rect:toolbar.hidden?null:rect(toolbar.getBoundingClientRect())},
      trigger:{text:trigger.textContent.trim(),rect:rect(tr),expanded:trigger.getAttribute('aria-expanded')},
      floatingMenu:{
        hidden:floating.hidden,
        text:floating.textContent.replace(/\s+/g,' ').trim(),
        rect:mr?rect(mr):null,
        relationship:relationship(mr,tr),
        overflow:overflow(mr),
        toolbarRightPlus8:round(toolbar.getBoundingClientRect().right+8),
        parent:{
          tag:floating.parentElement?.tagName.toLowerCase()||null,
          id:floating.parentElement?.id||null,
          className:typeof floating.parentElement?.className==='string'?floating.parentElement.className:null,
        },
        offsetParent:floating.offsetParent?{
          tag:floating.offsetParent.tagName.toLowerCase(),
          id:floating.offsetParent.id||null,
          className:typeof floating.offsetParent.className==='string'?floating.offsetParent.className:null,
          rect:rect(floating.offsetParent.getBoundingClientRect()),
        }:null,
        // `position: fixed` is resolved against the viewport, not this box.
        // This chain only identifies ancestor layout that can clip the panel.
        parentLayoutContext:(()=>{
          let node=floating.parentElement;
          while(node){
            const style=getComputedStyle(node);
            if(['transform','filter','perspective','contain','content-visibility','will-change'].some(key=>{
              const value=style.getPropertyValue(key);
              return value&&value!=='none'&&value!=='normal'&&value!=='auto';
            })||style.position!=='static')return {
              tag:node.tagName.toLowerCase(),id:node.id||null,
              className:typeof node.className==='string'?node.className:null,
              position:style.position,transform:style.transform,filter:style.filter,
              rect:rect(node.getBoundingClientRect()),
            };
            node=node.parentElement;
          }
          return null;
        })(),
        ancestors,
        style:{position:cs.position,zIndex:cs.zIndex,overflow:cs.overflow,left:cs.left,top:cs.top,
          inlineLeft:floating.style.left,inlineTop:floating.style.top},
      },
      h2:{rect:rect(h2.getBoundingClientRect()),checked:h2.getAttribute('aria-checked'),disabled:h2.disabled},
      top:{open:topTrigger.closest('details').open,trigger:rect(tt),menu:tm?rect(tm):null,
        relationship:relationship(tm,tt),overflow:overflow(tm)},
      selection:{from:selection.from,to:selection.to,anchor:selection.anchor,head:selection.head,
        empty:selection.empty,text:view.state.doc.sliceString(selection.from,selection.to)},
      anchorCoords:{from:view.coordsAtPos(selection.from,1),to:view.coordsAtPos(selection.to,-1)},
      focus:{activeTag:document.activeElement?.tagName||null,activeId:document.activeElement?.id||null,
        inEditor:view.dom.contains(document.activeElement),inSelectionToolbar:toolbar.contains(document.activeElement),
        inTopToolbar:topTrigger.closest('details').contains(document.activeElement),viewHasFocus:view.hasFocus},
      lines:[...view.contentDOM.querySelectorAll('.cm-line')].map(element=>({
        text:element.textContent,rect:rect(element.getBoundingClientRect()),
      })),
      scroll:{top:round(view.scrollDOM.scrollTop),left:round(view.scrollDOM.scrollLeft)},
      selectionLine:{from:line.from,to:line.to,text:line.text},
      markers:{
        preview:view.contentDOM.querySelectorAll('.style-preview-block').length,
        heading1:view.contentDOM.querySelectorAll('.cm-atomic-h1').length,
        heading2:view.contentDOM.querySelectorAll('.cm-atomic-h2').length,
      },
    };
  },label);
}

async function shot(page,label) {
  const path=join(shots,`${phase}-${label}.png`);
  const app=pageApps.get(page);
  assert.ok(app,'screenshot page is not associated with an Electron app');
  return captureHidden(app,page,path);
}

function sameLines(before,after) {
  const pick=s=>s.lines.map(line=>({text:line.text,rect:line.rect}));
  assert.deepEqual(pick(after),pick(before),'opening the menu changed document line geometry');
}

function assertFloating(opened) {
  const {trigger,floatingMenu,editor,viewport}=opened;
  assert.equal(floatingMenu.hidden,false,'floating menu is visible');
  assert.ok(floatingMenu.rect?.width>0&&floatingMenu.rect?.height>0,'floating menu has a real rect');
  assert.ok(floatingMenu.text.includes('H2 二级'),'triggered menu contains H2');
  const room=viewport.width-floatingMenu.rect.width-8;
  const expected=Math.max(8,Math.min(room,trigger.rect.left));
  assert.ok(Math.abs(floatingMenu.rect.left-expected)<=1.5,
    `menu detached from trigger: menu.left=${floatingMenu.rect.left}, trigger.left=${trigger.rect.left}, expected=${expected}, toolbar.right+8=${floatingMenu.toolbarRightPlus8}`);
  const {belowGap,aboveGap}=floatingMenu.relationship;
  assert.ok((belowGap>=-1&&belowGap<=14)||(aboveGap>=-1&&aboveGap<=14),
    `menu not adjacent to trigger: ${JSON.stringify(floatingMenu.relationship)}`);
  assert.equal(floatingMenu.relationship.overlapsTrigger,false,'menu covers its trigger');
  for(const [edge,amount] of Object.entries(floatingMenu.overflow))assert.ok(amount<=1,`menu overflows ${edge}`);
  assert.ok(floatingMenu.rect.left>=editor.left-1&&floatingMenu.rect.right<=editor.right+1&&
    floatingMenu.rect.top>=editor.top-1&&floatingMenu.rect.bottom<=editor.bottom+1,'menu outside editor viewport');
}

function assertTop(opened) {
  const {top}=opened;
  assert.equal(top.open,true);
  assert.ok(top.menu,'top menu has a real rect');
  assert.ok(Math.abs(top.relationship.leftDelta)<=1.5,`top menu detached: ${top.relationship.leftDelta}`);
  assert.ok(top.relationship.belowGap>=-1&&top.relationship.belowGap<=14,`top menu not below trigger: ${top.relationship.belowGap}`);
  for(const [edge,amount] of Object.entries(top.overflow))assert.ok(amount<=1,`top menu overflows ${edge}`);
}

function assertSelected(opened) {
  assert.equal(opened.selection.text,'hello world');
  assert.deepEqual(opened.focus.inEditor,true,'mouse overlay keeps real renderer editor focus');
}

async function floatingCase(id,dark) {
  const launched=await launch({dark});
  try {
    await selectHelloWorld(launched.page);
    const selected=await geometry(launched.page,id+'-selected');
    const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
    assert.ok(trigger,'floating trigger has a box');
    await launched.page.mouse.move(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await sleep(100);
    const hovered=await geometry(launched.page,id+'-hovered');
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>{
      const menu=document.querySelector('#selection-text-options');
      return menu&&!menu.hidden&&menu.getBoundingClientRect().width>0;
    });
    await launched.page.waitForFunction(()=>document.querySelector('[data-selection-submenu="text"]')?.getAttribute('aria-expanded')==='true');
    await sleep(100);
    const opened=await geometry(launched.page,id+'-opened');
    const image=await shot(launched.page,id+'-opened');
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({
      selected,hovered,opened,image,dark,
      previewVsBefore:{
        selectionSame:JSON.stringify(selected.selection)===JSON.stringify(hovered.selection),
        layoutSame:JSON.stringify(selected.lines)===JSON.stringify(hovered.lines),
      },
    },null,2));
    assert.deepEqual(opened.selection,hovered.selection,'selection changed on menu open');
    sameLines(hovered,opened);
    assertSelected(opened);
    assertFloating(opened);
    assert.deepEqual(launched.errors,[]);
    return {selected,hovered,opened,image,dark};
  } finally {await close(launched);}
}

async function headingCase(id,dark) {
  const launched=await launch({dark,heading:true});
  try {
    await selectHelloWorld(launched.page);
    const selected=await geometry(launched.page,id+'-selected');
    assert.equal(selected.trigger.text,'H2 ▾','fixture did not expose the H2 trigger');
    const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
    await launched.page.mouse.move(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await sleep(100);
    const hovered=await geometry(launched.page,id+'-hovered');
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>{
      const menu=document.querySelector('#selection-text-options');
      return menu&&!menu.hidden&&menu.getBoundingClientRect().width>0;
    });
    await sleep(100);
    const opened=await geometry(launched.page,id+'-opened');
    const image=await shot(launched.page,id+'-opened');
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({
      selected,hovered,opened,image,dark,command:'real mouse drag and click',
      fixedContainingBlock:'viewport',
    },null,2));
    sameLines(hovered,opened);
    assertSelected(opened);
    assertFloating(opened);
    return {selected,hovered,opened,image,dark};
  } finally {await close(launched);}
}

async function topCase(id,dark) {
  const launched=await launch({dark,saveDiag:id==='top-light',diagId:id});
  try {
    await selectHelloWorld(launched.page);
    const selected=await geometry(launched.page,id+'-selected');
    const trigger=await launched.page.locator('#heading-level').boundingBox();
    assert.ok(trigger,'top trigger has a box');
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>document.querySelector('#heading-menu')?.open===true);
    await sleep(100);
    const opened=await geometry(launched.page,id+'-opened');
    const image=await shot(launched.page,id+'-opened');
    assert.deepEqual(opened.selection,selected.selection,'top menu changed selection');
    assertTop(opened);

    // Apply from the top toolbar as well, so this path is a real formatting
    // entry point rather than only an open/geometry check.
    const item=launched.page.locator('#heading-menu [data-format="heading-3"]');
    const itemBox=await item.boundingBox();
    assert.ok(itemBox,'top H3 item has a box');
    const expectedDisk=exactHeadingSource('### hello world');
    await launched.page.mouse.click(itemBox.x+itemBox.width/2,itemBox.y+itemBox.height/2);
    const actionEndedAt=Date.now();
    let pollStartedAt=actionEndedAt;
    let disk;
    let saveOutcome;
    try {
      await launched.page.waitForFunction(()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.line(3).text==='### hello world');
      pollStartedAt=Date.now();
      disk=await poll(()=>readFile(launched.file,'utf8'),value=>value===expectedDisk,
        {timeout:5000,startedAt:actionEndedAt,message:'top H3 autosave did not preserve exact BOM/EOL bytes'});
      saveOutcome=await recordSaveOutcome(launched, {id, actionEndedAt, pollStartedAt, typedAt:null, expectedText:expectedDisk});
      if(launched.saveDiag) assertDiagnosticSaveAccepted(saveOutcome, id);
    } catch(error) {
      if(!error.saveDiagnostic) await attachSaveDiagnostic(launched, error, {id, actionEndedAt, pollStartedAt, typedAt:null, expectedText:expectedDisk});
      throw error;
    }
    const applied=await geometry(launched.page,id+'-applied');
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({selected,opened,applied,image,dark,diskMatch:disk===expectedDisk},null,2));
    assert.equal(applied.selectionLine.text,'### hello world');
    return {selected,opened,applied,image,dark,diskMatch:disk===expectedDisk,saveOutcome};
  } finally {await close(launched);}
}

async function edgeAndScroll(id) {
  const launched=await launch({width:720,height:560});
  try {
    await selectHelloWorld(launched.page);
    const initialScroll=await launched.page.locator('.cm-content').evaluate(content=>content.cmTile.root.view.scrollDOM.scrollTop);
    await launched.page.locator('.cm-content').evaluate(content=>content.cmTile.root.view.scrollDOM.scrollTop=80);
    await sleep(120);
    const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>document.querySelector('#selection-text-options')?.hidden===false);
    const before=await geometry(launched.page,id+'-edge-before');
    await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view,scroller=view.scrollDOM,selection=view.state.selection.main;
      const coords=view.coordsAtPos(selection.from,1);
      if(!coords)return;
      scroller.scrollTop=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,
        scroller.scrollTop+Math.max(16,coords.top-scroller.getBoundingClientRect().top-24)));
    });
    await sleep(120);
    const after=await geometry(launched.page,id+'-edge-after');
    assert.ok(after.scroll.top>before.scroll.top,'fixture did not scroll while the selection stayed visible');
    assertFloating(after);
    assert.deepEqual(after.selection,before.selection,'scroll changed the selection');
    const image=await shot(launched.page,id+'-edge-after');

    // Reopen independently, then let scrolling alone dismiss the toolbar.
    // No Escape is sent on this path because it could hide the menu itself.
    await collapseSelection(launched.page);
    await selectHelloWorld(launched.page);
    await openFloatingHeading(launched.page);
    const outOfViewOpened=await geometry(launched.page,id+'-out-of-view-opened');
    assertFloating(outOfViewOpened);
    const hidden=await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view,scroller=view.scrollDOM,selection=view.state.selection.main;
      const selectionText=view.state.doc.sliceString(selection.from,selection.to);
      scroller.scrollTop=scroller.scrollHeight;
      return {selectionText,scrollTop:scroller.scrollTop};
    });
    await settleMeasuredLayout(launched.page);
    await launched.page.waitForFunction(()=>document.querySelector('#selection-menu').hidden);
    const invalidated=await geometry(launched.page,id+'-selection-out-of-view');
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({
      initialScroll,before,after,outOfViewOpened,hidden,invalidated,image,
    },null,2));
    assert.equal(invalidated.selection.text,'hello world','selection must remain in the model');
    assert.equal(invalidated.toolbar.hidden,true,'toolbar stayed visible for a selection outside the viewport');
    return {before,after,outOfViewOpened,hidden,invalidated,image};
  } finally {await close(launched);}
}

async function runViewportEdges(id) {
  const launched=await launch({width:760,height:520});
  try {
    const triggers=[],diagnostics={
      caseId:id,phase,stages:[],geometrySnapshots:[],
    };
    let stage='initialized';
    const setStage=async name=>{
      stage=name;
      diagnostics.stages.push({name,at:new Date().toISOString()});
      await writeFile(join(output,`${phase}-${id}-last-stage.json`),JSON.stringify(diagnostics,null,2));
    };
    const captureGeometry=async label=>{
      const value=await geometry(launched.page,`${id}-${label}`);
      const snapshot={stage,label,at:new Date().toISOString(),geometry:value};
      diagnostics.geometrySnapshots.push(snapshot);
      await writeFile(join(output,`${phase}-${id}-last-geometry.json`),JSON.stringify(snapshot,null,2));
      return value;
    };
    await setStage('right-scan');
    const viewportMetrics=await launched.page.evaluate(()=>({width:innerWidth,height:innerHeight}));

    // Real narrow viewport, real long line. Dispatch first, wait for the next
    // measured layout, then derive the selection from actual coordinates.
    await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view,line=view.state.doc.line(3);
      view.dispatch({changes:{from:line.from,to:line.to,insert:'边缘右对齐内容'.repeat(18)+'hello world'}});
      view.focus();
    });
    await settleMeasuredLayout(launched.page);
    const rightScan=await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view;
      const updatedLine=view.state.doc.line(3);
      const scrollerRect=view.scrollDOM.getBoundingClientRect();
      const contentStyle=getComputedStyle(content);
      const textRight=content.getBoundingClientRect().right-parseFloat(contentStyle.paddingRight);
      let best=null;
      for(let pos=updatedLine.from+1;pos<=updatedLine.to;pos++) {
        const point=view.coordsAtPos(pos,-1);
        if(!point||point.bottom<scrollerRect.top||point.top>scrollerRect.bottom)continue;
        const textEdgeGap=textRight-point.right;
        if(!best||textEdgeGap<best.textEdgeGap)best={pos,point,textEdgeGap};
      }
      if(!best)throw new Error('could not find a visible right-edge position');
      const from=Math.max(updatedLine.from,best.pos-11);
      view.dispatch({selection:{anchor:from,head:best.pos},scrollIntoView:true});
      view.focus();
      return {
        from,to:best.pos,text:view.state.doc.line(3).text.slice(from-updatedLine.from,best.pos-updatedLine.from),
        textRight,selectionRight:best.point.right,textEdgeGap:best.textEdgeGap,
        edgeDistance:scrollerRect.right-best.point.right,
      };
    });
    await sleep(220);
    await setStage('right-selection-wait');
    await waitForStage(launched.page,'right-selection-wait',
      ()=>!document.querySelector('#selection-menu').hidden,undefined,10000).catch(async error=>{
        await captureGeometry('right-selection-timeout');
        throw error;
      });
    const rightSelection=await captureGeometry('right-selection');
    assert.ok(rightScan.textEdgeGap<=32,
      `fixture did not reach the text right edge: ${JSON.stringify(rightScan)}`);
    await openFloatingHeading(launched.page);
    const right=await geometry(launched.page,id+'-right-opened');
    const rightImage=await shot(launched.page,id+'-right-opened');
    assertFloating(right);
    assert.ok(right.floatingMenu.rect.right<=rightSelection.editor.right+1,'right-edge menu left editor bounds');
    triggers.push({edge:'right',scan:rightScan,selection:rightSelection,opened:right,image:rightImage});
    await setStage('right-submenu-close');
    await launched.page.keyboard.press('Escape');
    await waitForStage(launched.page,'right-submenu-close',
      ()=>document.querySelector('#selection-text-options').hidden,undefined,10000).catch(async error=>{
        await captureGeometry('right-submenu-close-timeout');
        throw error;
      });

    // Restore a normal line, then scroll the final paragraph into place before
    // selecting it. A hidden toolbar does not reposition merely because the
    // selection becomes visible again.
    await setStage('bottom-document-setup');
    await collapseSelection(launched.page);
    const bottomSetup=await launched.page.locator('.cm-content').evaluate((content,source)=>{
      const view=content.cmTile.root.view,scroller=view.scrollDOM;
      const beforeMetrics={scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight};
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:source}});
      const at=view.state.doc.lineAt(view.state.doc.length).from;
      const text='bottom edge hello world';
      const trailing=Array.from({length:12},(_,index)=>`after bottom ${index+1}`).join('\r\n');
      view.dispatch({changes:{from:at,to:view.state.doc.length,insert:text+'\r\n'+trailing}});
      const updatedLine=view.state.doc.lineAt(at);
      const lineBlock=view.lineBlockAt(updatedLine.from);
      view.dispatch({
        selection:{anchor:updatedLine.from},
      });
      scroller.scrollTop=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
      view.focus();
      return {
        beforeMetrics,at:updatedLine.from,text,
        lineBlock:{top:lineBlock.top,height:lineBlock.height},
        afterMetrics:{scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight},
      };
    },fixtureSource(false));
    await settleMeasuredLayout(launched.page);
    await setStage('bottom-layout-scroll');
    const bottomAdjustment=await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view,scroller=view.scrollDOM,selection=view.state.selection.main;
      const point=view.coordsAtPos(selection.to,-1);
      const editor=scroller.getBoundingClientRect();
      if(!point)throw new Error('selection has no measured bottom coordinate');
      const targetBottom=editor.bottom-20;
      const beforeScroll=scroller.scrollTop;
      const delta=point.bottom-targetBottom;
      const maxScroll=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
      scroller.scrollTop=Math.max(0,Math.min(maxScroll,beforeScroll+delta));
      return {
        selectionBottom:point.bottom,targetBottom,delta,
        beforeScroll,afterScroll:scroller.scrollTop,maxScroll,
      };
    });
    await settleMeasuredLayout(launched.page);

    // Recreate the selection only after the document is scrolled. The actual
    // selection change triggers the toolbar schedule at the settled layout.
    await setStage('bottom-selection');
    const bottomSelectionSetup=await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view,text='bottom edge hello world';
      const from=view.state.doc.toString().indexOf(text);
      if(from<0)throw new Error('bottom selection text is missing');
      const to=from+text.length;
      if(view.state.doc.sliceString(from,to)!==text)throw new Error('bottom selection text is missing');
      view.dispatch({selection:{anchor:from,head:to}});
      view.focus();
      return {from,to,text:view.state.doc.sliceString(from,to)};
    });
    await sleep(220);
    await setStage('bottom-selection-wait');
    await waitForStage(launched.page,'bottom-selection-wait',
      ()=>!document.querySelector('#selection-menu').hidden,undefined,10000).catch(async error=>{
        await captureGeometry('bottom-selection-timeout');
        throw error;
      });
    const bottomMeasurement=await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view,scroller=view.scrollDOM,selection=view.state.selection.main;
      const point=view.coordsAtPos(selection.to,-1);
      const editor=scroller.getBoundingClientRect();
      return {
        editorBottom:editor.bottom,selectionBottom:point?.bottom??null,
        distanceToEditorBottom:point?editor.bottom-point.bottom:null,
        targetBottom:editor.bottom-20,scrollTop:scroller.scrollTop,
      };
    });
    const bottomSelection=await captureGeometry('bottom-selection');
    assert.notEqual(bottomMeasurement.selectionBottom,null,'selection has no measured bottom coordinate');
    assert.ok(Math.abs(bottomMeasurement.selectionBottom-bottomMeasurement.targetBottom)<=2.5,
      `selection was not moved to the real bottom target: ${JSON.stringify(bottomMeasurement)}`);
    await setStage('bottom-submenu-open');
    await openFloatingHeading(launched.page).catch(async error=>{
      await captureGeometry('bottom-submenu-open-timeout');
      throw error;
    });
    await setStage('bottom-submenu-open-ended');
    const bottom=await geometry(launched.page,id+'-bottom-opened');
    const bottomImage=await shot(launched.page,id+'-bottom-opened');
    assertFloating(bottom);
    assert.ok(bottom.floatingMenu.rect.bottom<=bottomSelection.editor.bottom+1,'bottom-edge menu left editor bounds');
    assert.ok(bottom.floatingMenu.relationship.aboveGap>=-1&&bottom.floatingMenu.relationship.aboveGap<=14,
      `bottom-edge menu did not flip above its trigger: ${JSON.stringify(bottom.floatingMenu.relationship)}`);
    assert.ok(bottom.floatingMenu.rect.bottom<=bottom.trigger.rect.top+1,
      'bottom-edge menu visibly did not open above its trigger');
    triggers.push({
      edge:'bottom',selection:bottomSelection,bottomSelectionSetup,bottomAdjustment,bottomMeasurement,
      opened:bottom,image:bottomImage,
    });
    await setStage('bottom-submenu-close');
    await launched.page.keyboard.press('Escape');
    await waitForStage(launched.page,'bottom-submenu-close',
      ()=>document.querySelector('#selection-text-options').hidden,undefined,10000).catch(async error=>{
        await captureGeometry('bottom-submenu-close-timeout');
        throw error;
      });

    const image=await shot(launched.page,id);
    await setStage('complete');
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({
      viewportMetrics,triggers,image,diagnostics,
    },null,2));
    return {viewportMetrics,triggers,image,diagnostics};
  } finally {await close(launched);}
}

async function runMinimumWindow(id) {
  const requestedSize={width:900,height:360};
  const launched=await launch(requestedSize);
  try {
    const actualWindow=await launched.app.evaluate(({BrowserWindow})=>{
      const window=BrowserWindow.getAllWindows()[0];
      return {
        bounds:window.getBounds(),contentBounds:window.getContentBounds(),
        minimumSize:window.getMinimumSize(),
      };
    });
    await selectHelloWorld(launched.page);
    const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>!document.querySelector('#selection-text-options').hidden);
    const opened=await geometry(launched.page,id);
    const image=await shot(launched.page,id);
    const actualViewport=await launched.page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
    const testBoundary={
      minimumSupportedWindowHeight:actualWindow.minimumSize[1],
      requestedHeight:requestedSize.height,actualWindowHeight:actualWindow.bounds.height,
      note:'360px window height is not testable because the native minimum clamps it; internal scrolling at 360px is UNVERIFIED.',
    };
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({
      requestedSize,actualWindow,actualViewport,testBoundary,opened,image,
    },null,2));
    assertFloating(opened);
    assert.equal(actualWindow.minimumSize[1],480,'product minimum window height changed');
    assert.ok(actualWindow.bounds.height>=actualWindow.minimumSize[1],'window is below its declared minimum height');
    assert.deepEqual(opened.viewport,actualViewport,'geometry viewport differs from the actual renderer viewport');
    assert.ok(opened.floatingMenu.rect.height<=opened.editor.height-12,'menu exceeds the actual minimum-window editor space');
    return {requestedSize,actualWindow,actualViewport,testBoundary,opened,image};
  } finally {await close(launched);}
}

async function keyboardAndDismiss(id) {
  const launched=await launch();
  try {
    await selectHelloWorld(launched.page);
    await launched.page.keyboard.press('Alt+F10');
    await launched.page.locator('[data-selection-submenu="text"]').focus();
    await launched.page.keyboard.press('Enter');
    await launched.page.waitForFunction(()=>!document.querySelector('#selection-text-options').hidden);
    const keyboardOpen=await geometry(launched.page,id+'-keyboard');
    assertFloating(keyboardOpen);
    const focused=await launched.page.evaluate(()=>document.activeElement?.getAttribute('data-selection-format'));
    assert.ok(['heading-0','heading-1','heading-2','heading-3','heading-4','heading-5','heading-6'].includes(focused),'keyboard did not enter heading menu');
    await launched.page.keyboard.press('Escape');
    await launched.page.waitForFunction(()=>document.querySelector('#selection-text-options').hidden);
    const escaped=await geometry(launched.page,id+'-escaped');
    assert.deepEqual(escaped.selection,keyboardOpen.selection,'Escape changed selection');

    // Reopen independently for the outside-click path.
    await selectHelloWorld(launched.page);
    await openFloatingHeading(launched.page);
    const outsideOpened=await geometry(launched.page,id+'-outside-opened');
    assertFloating(outsideOpened);
    await launched.page.mouse.click(600,400);
    await launched.page.waitForFunction(()=>document.querySelector('#selection-menu').hidden);
    const outside=await geometry(launched.page,id+'-outside');
    assert.equal(outside.toolbar.hidden,true);

    // Reopen independently for selection invalidation.
    await selectHelloWorld(launched.page);
    await openFloatingHeading(launched.page);
    const invalidOpened=await geometry(launched.page,id+'-invalid-opened');
    assertFloating(invalidOpened);
    await launched.page.locator('.cm-content').evaluate(content=>{
      const view=content.cmTile.root.view;
      view.dispatch({selection:{anchor:0}});
      view.focus();
    });
    await launched.page.waitForFunction(()=>document.querySelector('#selection-menu').hidden);
    const invalid=await geometry(launched.page,id+'-invalid-selection');
    assert.equal(invalid.selection.empty,true);
    assert.equal(invalid.floatingMenu.hidden,true,'heading menu stayed open after selection invalidated');

    // Space opens the focused submenu; ArrowDown/Right moves focus inside it.
    await selectHelloWorld(launched.page);
    await launched.page.keyboard.press('Alt+F10');
    await launched.page.locator('[data-selection-submenu="text"]').focus();
    await launched.page.keyboard.press(' ');
    await launched.page.waitForFunction(()=>!document.querySelector('#selection-text-options').hidden);
    const spaceOpened=await geometry(launched.page,id+'-space-opened');
    assertFloating(spaceOpened);
    const spaceFocus=await launched.page.evaluate(()=>document.activeElement?.getAttribute('data-selection-format'));
    assert.ok(spaceFocus?.startsWith('heading-'),'Space did not focus a heading item');
    await launched.page.keyboard.press('ArrowRight');
    const rightFocus=await launched.page.evaluate(()=>document.activeElement?.getAttribute('data-selection-format'));
    assert.ok(rightFocus?.startsWith('heading-')&&rightFocus!==spaceFocus,'ArrowRight did not move inside the heading menu');
    await launched.page.keyboard.press('ArrowDown');
    const downFocus=await launched.page.evaluate(()=>document.activeElement?.getAttribute('data-selection-format'));
    assert.ok(downFocus?.startsWith('heading-')&&downFocus!==rightFocus,'ArrowDown did not move inside the heading menu');
    const itemLevel=await launched.page.evaluate(type=>{
      const button=document.activeElement,number=Number(type?.slice('heading-'.length));
      return Number.isInteger(number)&&number>=0?number:null;
    },downFocus);
    assert.notEqual(itemLevel,null,'focused item has no heading level');
    const expectedLine=itemLevel===0?'hello world':'#'.repeat(itemLevel)+' hello world';
    await launched.page.keyboard.press('Enter');
    await launched.page.waitForFunction(expected=>{
      const view=document.querySelector('.cm-content').cmTile.root.view;
      return view.state.doc.line(3).text===expected;
    },expectedLine);
    const expectedDisk=exactHeadingSource(expectedLine);
    await poll(()=>readFile(launched.file,'utf8'),value=>value===expectedDisk,
      {timeout:5000,message:'keyboard Enter did not preserve exact source and disk bytes'});
    const postApply=await geometry(launched.page,id+'-enter-applied');
    assert.equal(postApply.selectionLine.text,expectedLine,'Enter applied the wrong heading level');
    await launched.page.keyboard.press('Escape');
    await launched.page.waitForFunction(()=>document.querySelector('#selection-menu').hidden);
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({
      keyboardOpen,escaped,outsideOpened,outside,invalidOpened,invalid,
      spaceOpened,spaceFocus,rightFocus,downFocus,itemLevel,expectedLine,postApply,
    },null,2));
    return {
      keyboardOpen,escaped,outsideOpened,outside,invalidOpened,invalid,
      spaceOpened,spaceFocus,rightFocus,downFocus,itemLevel,expectedLine,postApply,
    };
  } finally {await close(launched);}
}

async function applyEachHeading(id) {
  const applied={};
  let image;
  for(let level=0;level<=6;level++) {
    const launched=await launch({heading:true});
    try {
      const expected=level===0?'hello world':'#'.repeat(level)+' hello world';
      const expectedDisk=exactHeadingSource(expected);
      await selectHelloWorld(launched.page);
      await waitFor(launched.page,()=>!document.querySelector('#selection-menu').hidden,
        null,`H${level} selection toolbar did not appear`);
      const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
      await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
      await waitFor(launched.page,
        ()=>!document.querySelector('#selection-text-options').hidden,
        null,`H${level} heading menu did not open`);
      const item=launched.page.locator(`#selection-text-options [data-selection-format="heading-${level}"]`);
      const box=await item.boundingBox();
      await launched.page.mouse.click(box.x+box.width/2,box.y+box.height/2);
      await waitFor(launched.page,expected=>{
        const view=document.querySelector('.cm-content').cmTile.root.view;
        return view.state.doc.line(3).text===expected;
      },expected,`H${level} formatting was not applied`);
      const source=await launched.page.locator('.cm-content').evaluate(content=>content.cmTile.root.view.state.doc.toString());
      assert.ok(source.includes(expected),`H${level} source missing`);
      const disk=await poll(()=>readFile(launched.file,'utf8'),value=>value===expectedDisk,
        {timeout:5000,message:`H${level} autosave did not preserve BOM/EOL and exact bytes`});
      const appliedState=await geometry(launched.page,`${id}-h${level}`);
      applied[level]={expected,expectedDiskMatches:disk===expectedDisk,sourceLine:appliedState.selectionLine.text};
      await launched.page.keyboard.press('Escape');
      await waitFor(launched.page,()=>document.querySelector('#selection-menu').hidden,
        null,`H${level} toolbar did not close after Escape`);
      await launched.page.keyboard.press('Control+e');
      await waitFor(launched.page,()=>document.querySelector('.pane').dataset.mode==='source',
        null,`H${level} source mode did not open`);
      assert.ok((await launched.page.locator('.cm-content').innerText()).includes(expected),`source view lost H${level}`);
      const sourceTransition=await waitForSemanticTransitionFrames(
        launched.page,`H${level} source transition`,{frames:4,timeout:10000});
      applied[level].sourceTransition=sourceTransition;
      await launched.page.keyboard.press('Control+e');
      await waitFor(launched.page,()=>document.querySelector('.pane').dataset.mode==='rendered',
        null,`H${level} rendered mode did not return`);
      await poll(()=>readFile(launched.file,'utf8'),value=>value===expectedDisk,
        {timeout:5000,message:`H${level} saved state was not stable before the next round`});
      if(level===6)image=await shot(launched.page,id);
    } finally {
      await close(launched);
    }
  }
  await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({applied,image},null,2));
  return {applied,image};
}

async function h3ContinueAndReopen(id) {
  const launched=await launch({heading:true,saveDiag:true,diagId:id});
  let stage='launch';
  let diagnosticFile=join(output,`${phase}-${id}-diagnostic.json`);
  let lastGeometry=null;
  let actionEndedAt=null;
  let pollStartedAt=null;
  let typedAt=null;
  let expectedText=null;
  let saveOutcome=null;
  const captureStage=async(label,extra={})=>{
    const current=await geometry(launched.page,`${id}-${label}`);
    const state=await launched.page.evaluate(()=>({
      mode:document.querySelector('.pane')?.dataset.mode??null,
      doc:document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()??null,
      status:document.querySelector('#status')?.textContent??null,
    }));
    lastGeometry=current;
    const diagnostic={stage:label,phase,caseId:id,at:new Date().toISOString(),state,geometry:current,...extra};
    await writeFile(diagnosticFile,JSON.stringify(diagnostic,null,2));
    return current;
  };
  try {
    stage='select-hello-world';
    await selectHelloWorld(launched.page);
    const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
    stage='open-floating-heading';
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>!document.querySelector('#selection-text-options').hidden);
    const item=launched.page.locator('#selection-text-options [data-selection-format="heading-3"]');
    const box=await item.boundingBox();
    await launched.page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await launched.page.mouse.down();
    await launched.page.mouse.up();
    await captureStage('after-mouse-up-applied');
    stage='wait-after-mouse-up-applied';
    await waitFor(launched.page,()=>{
      const view=document.querySelector('.cm-content').cmTile.root.view,selection=view.state.selection.main;
      return view.state.doc.line(3).text==='### hello world'&&selection.empty;
    },null,'H3 floating mouse.up did not apply heading');
    const afterApply=await geometry(launched.page,id+'-applied');
    assert.equal(afterApply.selection.empty,true,'block formatting must collapse the heading selection');
    assert.equal(afterApply.selectionLine.from<=afterApply.selection.from&&afterApply.selection.to<=afterApply.selectionLine.to,true,
      'selection is not on the formatted heading text');
    assert.equal(afterApply.focus.inEditor,true);
    stage='type-exclamation';
    await launched.page.keyboard.type('!');
    typedAt=Date.now();
    actionEndedAt=typedAt;
    const expected=exactHeadingSource('### hello world!');
    expectedText=expected;
    const typedState=await geometry(launched.page,id+'-typed-immediate');
    assert.ok(typedState.selectionLine.text.endsWith('### hello world!'),
      `continued typing did not reach the heading: ${JSON.stringify(typedState.selectionLine)} selection=${JSON.stringify(typedState.selection)}`);
    pollStartedAt=Date.now();
    await poll(()=>readFile(launched.file,'utf8'),value=>value===expected,
      {timeout:5000,startedAt:actionEndedAt,message:'disk did not receive exact H3 + typing result'});
    saveOutcome=await recordSaveOutcome(launched, {id, actionEndedAt, pollStartedAt, typedAt, expectedText});
    assertDiagnosticSaveAccepted(saveOutcome, id);
    await captureStage('after-typing',{expected});
    const beforeReopen=await geometry(launched.page,id+'-typed');
    assert.equal(beforeReopen.selection.empty,true,'typing must keep a collapsed heading caret');
    assert.equal(beforeReopen.selection.text,'');
    assert.ok(beforeReopen.selectionLine.text.endsWith('### hello world!'),'continued typing did not reach the heading');
    stage='ctrl-e-to-source';
    await launched.page.keyboard.press('Control+e');
    await waitFor(launched.page,()=>document.querySelector('.pane').dataset.mode==='source',
      null,'H3 first Ctrl+E did not open source mode');
    assert.equal(await readFile(launched.file,'utf8'),expected);
    const sourceState=await captureStage('after-ctrl-e-source',{expected});
    const sourceTransition=await waitForSemanticTransitionFrames(
      launched.page,'H3 source transition',{frames:4,timeout:10000});
    stage='ctrl-e-to-rendered';
    await launched.page.keyboard.press('Control+e');
    await waitFor(launched.page,()=>document.querySelector('.pane').dataset.mode==='rendered',
      null,'H3 second Ctrl+E did not return rendered mode');
    await waitFor(launched.page,()=>document.querySelector('.cm-content').cmTile.root.view.state.doc.toString().includes('### hello world!'),
      null,'H3 rendered mode lost continued heading text');
    const renderedState=await captureStage('after-ctrl-e-rendered',{expected});
    const reopened=await geometry(launched.page,id+'-reopened-source-switch');
    const image=await shot(launched.page,id);
    stage='complete';
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({lastStage:stage,afterApply,beforeReopen,sourceState,sourceTransition,renderedState,reopened,expected,image},null,2));
    return {afterApply,beforeReopen,sourceState,sourceTransition,renderedState,reopened,expected,image,saveOutcome};
  } catch(error) {
    if(!error.saveDiagnostic) await attachSaveDiagnostic(launched, error, {id, actionEndedAt, pollStartedAt, typedAt, expectedText});
    let diagnostics=null;
    try {
      diagnostics=await captureStage(`error-at-${stage}`,{
        error:String(error?.message||error),
        stack:String(error?.stack||error),
      });
    } catch(diagnosticError) {
      await writeFile(diagnosticFile,JSON.stringify({
        stage,phase,caseId:id,at:new Date().toISOString(),
        error:String(error?.message||error),stack:String(error?.stack||error),
        lastGeometry,diagnosticError:String(diagnosticError?.message||diagnosticError),
      },null,2)).catch(()=>{});
    }
    error.h3Diagnostic={stage,geometry:diagnostics||lastGeometry,file:diagnosticFile};
    throw error;
  } finally {await close(launched);}
}

async function zoomCheck(id) {
  const launched=await launch({width:1000,height:700});
  try {
    await selectHelloWorld(launched.page);
    const trigger=await launched.page.locator('[data-selection-submenu="text"]').boundingBox();
    await launched.page.mouse.click(trigger.x+trigger.width/2,trigger.y+trigger.height/2);
    await launched.page.waitForFunction(()=>!document.querySelector('#selection-text-options').hidden);
    const before=await geometry(launched.page,id+'-before');
    await launched.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.15));
    await sleep(250);
    const after=await geometry(launched.page,id+'-after');
    const image=await shot(launched.page,id);
    await writeFile(join(output,`${phase}-${id}-geometry.json`),JSON.stringify({before,after,image},null,2));
    assertFloating(after);
    assert.deepEqual(after.selection,before.selection,'zoom changed selection');
    await launched.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    return {before,after,image};
  } finally {await close(launched);}
}

const results=[],failures=[];
async function run(name,fn,{expectedRed=false}={}) {
  if(caseFilter && !caseFilter.split(',').includes(name) || skippedCases.has(name))return;
  console.log('START',name);
  try {
    const evidence=await fn();
    await writeFile(join(output,`${phase}-${name}.json`),JSON.stringify(evidence,null,2));
    results.push({name,status:'PASS',expectedRed});
    console.log('FUNCTIONAL PASS',name);
  } catch(error) {
    failures.push({name,message:String(error?.message||error),expectedRed,saveDiagnostic:error?.saveDiagnostic||null});
    console.log('FUNCTIONAL FAIL',name,String(error?.message||error));
    await writeFile(join(output,`${phase}-${name}.json`),JSON.stringify({
      name,status:'FAIL',expectedRed,error:String(error?.message||error),
      saveDiagnostic:error?.saveDiagnostic||null,
    },null,2));
  }
}

await run('floating-light',()=>floatingCase('floating-light',false),{expectedRed:phase==='red'});
await run('floating-dark',()=>floatingCase('floating-dark',true),{expectedRed:phase==='red'});
await run('floating-h2-light',()=>headingCase('floating-h2-light',false),{expectedRed:phase==='red'});
await run('floating-h2-dark',()=>headingCase('floating-h2-dark',true),{expectedRed:phase==='red'});
await run('top-light',()=>topCase('top-light',false));
await run('top-dark',()=>topCase('top-dark',true));
if(phase!=='red') {
  await run('narrow-resize',()=>runNarrowAndResize('narrow-resize'));
  await run('edge-scroll',()=>edgeAndScroll('edge-scroll'));
  await run('viewport-edges',()=>runViewportEdges('viewport-edges'));
  await run('minimum-window',()=>runMinimumWindow('minimum-window'));
  await run('keyboard-dismiss',()=>keyboardAndDismiss('keyboard-dismiss'));
  await run('apply-headings',()=>applyEachHeading('apply-headings'));
  await run('h3-continue-reopen',()=>h3ContinueAndReopen('h3-continue-reopen'));
  await run('zoom',()=>zoomCheck('zoom'));
}

const redConfirmed=phase==='red'&&results.length===2&&failures.length===4&&
  failures.every(failure=>failure.expectedRed&&failure.message.includes('menu detached'));
const report={suite:'floating-heading-menu-ui',phase,hiddenHarness:true,
  evidenceClass:'FUNCTIONAL', visualStatus:'VISUAL_UNVERIFIED',
  visualAcceptance:'Independent pixel review required. Functional PASS never implies visual PASS.',
  focusEvidence:{
    rendererEquivalent:'CDP focus emulation and CodeMirror DOM focus assertions',
    realOperatingSystemForeground:'UNVERIFIED',
  },
  environment:{
    electron:JSON.parse(await readFile(resolve('node_modules/electron/package.json'),'utf8')).version,
    playwright:JSON.parse(await readFile(resolve('node_modules/@playwright/test/package.json'),'utf8')).version,
    os:process.platform,
  },
  results,failures,redConfirmed};
await writeFile(join(output,`${phase}-summary.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(failures.length)process.exitCode=1;
