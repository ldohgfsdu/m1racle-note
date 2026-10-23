import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, clipboard, nativeImage, nativeTheme, screen, session as sharedSession } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, basename, resolve, relative, isAbsolute, extname } from 'node:path';
import { realpath } from 'node:fs/promises';
import { FileSession } from './session.mjs';
import {registerMarkdown,openDefaultSettings,queryMarkdownDefaults} from './associations.mjs';
import {readOnboarding,dismissOnboarding} from './onboarding.mjs';
import {listDrafts,writeDraft,clearDraft,readDraft,serializeDraftOp} from './drafts.mjs';
import {readSession,writeSession} from './session-state.mjs';
import {recordRecent,removeRecent,listRecent,recentStatus,recentKey} from './recent-state.mjs';
import {readLibrary,updateLibrary,pathKey as libraryKey} from './library-state.mjs';
import {storeAUMID} from './store-identity.mjs';
import {createNoteIcon} from './icons.mjs';
const here = dirname(fileURLToPath(import.meta.url));
app.setName('M1racle Note');
if(process.windowsStore)app.setAppUserModelId(storeAUMID);
const windows=new Map();
let lastFocused=null, openWindow=null;
let focusSeq=0, reportSeq=0, sessionTimer=0, sessionWrite=Promise.resolve(), lastSessionKey='';
// The restored document belongs to the most recently focused window that
// reported a session state; ties fall back to the most recent report. This is
// the documented, repeatable rule for "last active document" across windows.
const sessionOwner=()=>[...windows.values()].filter(state=>state.sessionState)
 .sort((left,right)=>(right.focusedSeq-left.focusedSeq)||(right.reportSeq-left.reportSeq))[0] || null;
const persistSession=async()=>{
 const owner=sessionOwner();
 if(!owner)return;
 const record={version:1,updatedAt:Date.now(),path:owner.sessionState.path,mode:owner.sessionState.mode,cursor:owner.sessionState.cursor,scrollTop:owner.sessionState.scrollTop};
 const key=JSON.stringify(record.cursor)+'|'+record.path+'|'+record.mode+'|'+record.scrollTop;
 if(key===lastSessionKey)return;
 lastSessionKey=key;
 await writeSession(app.getPath('userData'),record).catch(()=>{});
};
const scheduleSessionPersist=()=>{
 clearTimeout(sessionTimer);
 sessionTimer=setTimeout(()=>{sessionTimer=0;sessionWrite=sessionWrite.then(persistSession).catch(()=>{});},300);
};
const flushSessionPersist=async()=>{
 clearTimeout(sessionTimer);sessionTimer=0;
 sessionWrite=sessionWrite.then(persistSession).catch(()=>{});
 await sessionWrite;
};
// A successful open (never a failed one, never a focus change) updates the
// history. The history is a side record: failing to write it never fails the open.
// startedAt = when the open began; a removal made after that moment wins.
const notifyLibrary=()=>{for(const state of windows.values())if(!state.window.isDestroyed())state.window.webContents.send('library-changed');};
const noteOpened=async(path,startedAt=Date.now())=>{
 if(!path)return;
 await recordRecent(app.getPath('userData'),path,Date.now(),startedAt).catch(()=>{});
 try { await updateLibrary(app.getPath('userData'),{type:'remember',path,openedAt:startedAt}); }
 catch(error){for(const state of windows.values())state.window.webContents.send('library-error',String(error?.message||error));}
 notifyLibrary();
};
async function libraryList() {
 const directory=app.getPath('userData'),record=await readLibrary(directory),recent=await listRecent(directory);
 const removed=new Set((record.removed||[]).map(item=>item.key));
 const entries=new Map(record.items.map(item=>[recentKey(item.path),item]));
 for(const item of recent)if(!removed.has(libraryKey(item.path))&&!entries.has(recentKey(item.path)))entries.set(recentKey(item.path),{path:item.path,groupId:null,pinned:false,fixed:false});
 const statuses=new Map(recent.map(item=>[recentKey(item.path),item.status]));
 const items=await Promise.all([...entries.values()].map(async item=>({...item,name:basename(item.path),dir:dirname(item.path),status:statuses.get(recentKey(item.path)) || await recentStatus(item.path)})));
 return {...record,items};
}
const imageExtensions=['.png','.jpg','.jpeg','.gif','.webp','.avif','.bmp'];
const fileArgument=argv=>argv.find(argument=>!argument.startsWith('-') && /\.(md|markdown)$/i.test(argument));
const comparablePath=value=>{try{return resolve(value).toLowerCase();}catch{return '';}};
const paneIdOf=payload=>typeof payload?.pane==='string' && /^[a-z][a-z0-9-]{0,39}$/i.test(payload.pane) ? payload.pane : 'primary';
const sessionFor=(state,id)=>{let session=state.sessions.get(id);if(!session){session=new FileSession();state.sessions.set(id,session);}return session;};
const orderedSessions=state=>{
  const ids=[...state.paneOrder,state.activePane,'primary'].filter(Boolean);
  return [...new Set(ids)].map(id=>state.sessions.get(id)).filter(session=>session?.path);
};
const windowHasFile=(state,path)=>Boolean(state.initialFile) && comparablePath(state.initialFile)===comparablePath(path) || orderedSessions(state).some(session=>comparablePath(session.path)===comparablePath(path));
const windowFor=path=>[...windows.values()].find(state=>windowHasFile(state,path));
const focusWindow=state=>{const target=state.window;if(target.isMinimized())target.restore();target.show();target.focus();};
const showWindowFailure=error=>dialog.showErrorBox('M1racle Note 打开窗口失败',String(error));
protocol.registerSchemesAsPrivileged([{scheme:'note-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(!app.requestSingleInstanceLock())app.quit();
else {
app.on('second-instance',(_event,argv)=>{
  app.whenReady().then(()=>{
    if(!openWindow)return;
    const file=fileArgument(argv);
    const existing=file ? windowFor(file) : null;
    if(existing)focusWindow(existing);
    else (file ? openWindow(file) : openWindow('',true)).ready.catch(showWindowFailure);
  });
});
app.whenReady().then(async () => {
listDrafts(app.getPath('userData')).catch(()=>{});
const nightIcon=createNoteIcon(nativeImage,join(here,'assets'),'night');
const dayIcon=createNoteIcon(nativeImage,join(here,'assets'),'day');
protocol.handle('note-asset', async request => {
  try {
    const url = new URL(request.url);
    const state = windows.get(Number(url.host.replace(/^w/,'')));
    if (!state) return new Response('',{status:404});
    const rel = decodeURIComponent(url.pathname).replace(/^\//,'');
    for (const session of orderedSessions(state)) {
      try {
        const root = await realpath(dirname(session.path));
        const target = await realpath(resolve(root,rel));
        const check = relative(root,target);
        if(check.startsWith('..') || isAbsolute(check) || !imageExtensions.includes(extname(target).toLowerCase())) continue;
        return net.fetch(pathToFileURL(target).href);
      } catch { continue; }
    }
    return new Response('',{status:404});
  } catch { return new Response('',{status:404}); }
});
sharedSession.defaultSession.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
sharedSession.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
  if(details.resourceType!=='image' || !details.url.startsWith('file:')){callback({});return;}
  try {
    const rel=relative(join(here,'dist'),fileURLToPath(details.url));
    if(/^assets[\\/](?:master-symbol-(?:day|night)|icon-(?:32|128)-(?:day|night))-[\w-]+\.png$/.test(rel)){callback({});return;}
    const id=details.webContentsId ?? details.webContents?.id ?? 0;
    const state=windows.get(id);
    if(!state || !orderedSessions(state).length || rel.startsWith('..') || isAbsolute(rel)){callback({cancel:true});return;}
    callback({redirectURL:'note-asset://w'+id+'/'+rel.split(/[\\/]/).map(encodeURIComponent).join('/')});
  }catch{callback({cancel:true});}
});
openWindow=(file,fresh=false)=>{
  const state={sessions:new Map(),activePane:'primary',paneOrder:[],queue:Promise.resolve(),canClose:false,initialFile:file?resolve(file):'',fresh,window:null,ready:null,draftIds:new Set(),sessionState:null,focusedSeq:0,reportSeq:0};
  const focused=BrowserWindow.getFocusedWindow(),placement={};
  if(focused && !focused.isDestroyed()) {
    const [x,y]=focused.getPosition(),area=screen.getDisplayMatching(focused.getBounds()).workArea;
    placement.x=Math.min(Math.max(x+32,area.x),area.x+area.width-360);
    placement.y=Math.min(Math.max(y+32,area.y),area.y+area.height-260);
  }
  const window=new BrowserWindow({...placement,width:1180,height:820,minWidth:720,minHeight:480,title:'M1racle Note',frame:false,roundedCorners:false,titleBarStyle:'hidden',titleBarOverlay:{color:'#ffffff',symbolColor:'#111111',height:44},autoHideMenuBar:true,icon:nativeTheme.shouldUseDarkColors?nightIcon:dayIcon,backgroundColor:'#ffffff',show:false,webPreferences:{preload:join(here,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const id=window.webContents.id;
  state.window=window;windows.set(id,state);
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate',event => event.preventDefault());
  window.once('ready-to-show',() => window.show());
  window.on('focus',()=>{lastFocused=state;state.focusedSeq=++focusSeq;scheduleSessionPersist();});
  window.on('close',event => { if(!state.canClose) {event.preventDefault();window.webContents.send('command','close');} });
  window.on('closed',() => {windows.delete(id);scheduleSessionPersist();});
  window.setMenuBarVisibility(false);
  state.ready=window.loadFile(join(here,'dist','index.html'));
  return state;
};
ipcMain.on('session-report',(event,payload) => {
  const state=windows.get(event.sender.id);
  if(!state)return;
  if(typeof payload?.path!=='string' || payload.path.length>4096)return;
  if(payload.mode!=='read' && payload.mode!=='code')return;
  const anchor=payload?.cursor?.anchor,head=payload?.cursor?.head;
  if(!Number.isInteger(anchor) || !Number.isInteger(head) || anchor<0 || head<0 || anchor>0x7fffffff || head>0x7fffffff)return;
  if(!Number.isFinite(payload.scrollTop) || payload.scrollTop<0 || payload.scrollTop>0x7fffffff)return;
  state.sessionState={path:payload.path,mode:payload.mode,cursor:{anchor,head},scrollTop:payload.scrollTop};
  state.reportSeq=++reportSeq;
  if(!state.focusedSeq)state.focusedSeq=++focusSeq;
  scheduleSessionPersist();
});
ipcMain.on('close-ready',event => {
  const state=windows.get(event.sender.id);
  if(!state)return;
  // The final position must reach disk before the window disappears, otherwise
  // a quick close-and-reopen would restore a stale cursor.
  flushSessionPersist().then(()=>{state.canClose=true;state.window.close();},()=>{state.canClose=true;state.window.close();});
});
ipcMain.handle('document',async (event,type,payload) => {
  const state=windows.get(event.sender.id);
  if(!state || event.senderFrame !== event.sender.mainFrame) throw new Error('非法请求');
  if(type==='theme-icon') {
    if(typeof payload?.dark!=='boolean' || !/^#[0-9a-f]{6}$/i.test(payload.background) || !/^#[0-9a-f]{6}$/i.test(payload.foreground))throw new Error('无效主题');
    state.window.setIcon(payload.dark?nightIcon:dayIcon);
    // Resolve the native window colors from the same bundled semantic tokens as the renderer.
    state.window.setBackgroundColor(payload.background);
    state.window.setTitleBarOverlay({color:payload.background,symbolColor:payload.foreground});return true;
  }
  if(type==='copy-text') {
    if(typeof payload?.text!=='string' || payload.text.length>4_000_000)throw new Error('无法复制这段内容');
    clipboard.writeText(payload.text);return true;
  }
  if(type==='edit-action') {
    if(!['cut','copy','paste'].includes(payload?.action))throw new Error('无效编辑操作');
    state.window.webContents[payload.action]();return true;
  }
  if(type==='draft-write' || type==='draft-clear' || type==='draft-list') {
    const directory=app.getPath('userData');
    if(type==='draft-write') {
      if(typeof payload?.id!=='string' || typeof payload?.raw!=='string' || payload.raw.length>8_000_000 || typeof payload?.path!=='string')throw new Error('无效的草稿');
      const owner=state.sessions.get(paneIdOf(payload));
      const base=typeof owner?.baseHash==='string'?owner.baseHash:undefined;
      await serializeDraftOp(payload.id,()=>writeDraft(directory,{id:payload.id,path:payload.path,raw:payload.raw,base}));
      state.draftIds.add(payload.id);
      return true;
    }
    if(type==='draft-clear') {
      if(typeof payload?.id==='string' && [...windows.values()].some(item=>item!==state && item.draftIds.has(payload.id)))throw new Error('这个草稿已在另一个窗口恢复，无法丢弃');
      if(typeof payload?.id==='string')state.draftIds.delete(payload.id);
      await serializeDraftOp(String(payload?.id),()=>clearDraft(directory,payload?.id));
      return true;
    }
    const claimed=new Set([...windows.values()].flatMap(item=>[...item.draftIds]));
    return (await listDrafts(directory)).filter(draft=>!claimed.has(draft.id));
  }
  // Sidebar metadata never holds up the document's save/open queue.
  if(type==='library-list')return libraryList();
  if(type==='library-update') {
    const record=await updateLibrary(app.getPath('userData'),payload);
    if(payload?.type==='item-remove')await removeRecent(app.getPath('userData'),payload.path,Date.now(),true);
    notifyLibrary();return record;
  }
  const task = state.queue.then(async () => {
    if(type==='onboarding-state') {
      const dismissed=await readOnboarding(app.getPath('userData'));
      if(!app.isPackaged)return {available:false,dismissed,md:false,markdown:false};
      try{return {available:true,dismissed,...await queryMarkdownDefaults(process.execPath)};}
      catch{return {available:true,dismissed,md:null,markdown:null};}
    }
    if(type==='onboarding-dismiss'){await dismissOnboarding(app.getPath('userData'));return true;}
    if(type==='default-app') {
      if(!app.isPackaged)throw new Error('请在已打包的程序中设置文件关联');
      if(!process.windowsStore)await registerMarkdown(process.execPath);
      return openDefaultSettings(url=>shell.openExternal(url),process.windowsStore?storeAUMID:'');
    }
    if(type === 'initial') {
      const file=state.initialFile;state.initialFile='';
      if(file){const startedAt=Date.now(),session=sessionFor(state,'primary');await session.load(file);await noteOpened(session.path,startedAt);return {path:session.path,raw:session.raw,bom:session.bom};}
      const session=state.sessions.get('primary');
      if(session && (session.path || session.raw))return {path:session.path,raw:session.raw,bom:session.bom};
      return state.fresh ? {path:'',raw:''} : null;
    }
    if(type==='session-get')return readSession(app.getPath('userData'));
    if(type==='recent-list')return listRecent(app.getPath('userData')).catch(()=>[]);
    if(type==='recent-remove') {
      // Metadata only: never touches the document, a draft or the open session.
      if(typeof payload?.path!=='string' || !payload.path)throw new Error('无效的请求');
      await removeRecent(app.getPath('userData'),payload.path);
      notifyLibrary();
      return listRecent(app.getPath('userData')).catch(()=>[]);
    }
    if(type==='open-recent') {
      const id=paneIdOf(payload);
      const path=typeof payload?.path==='string' ? payload.path : '';
      if(!path)return {path:'',raw:'',bom:false,missing:false};
      const startedAt=Date.now(),session=sessionFor(state,id);
      try {
        await session.load(path);
        if(payload?.deferRecent===true)session.openStartedAt=startedAt;
        else if(payload?.restore!==true)await noteOpened(session.path,startedAt);
        return {path:session.path,raw:session.raw,bom:session.bom,missing:false};
      }
      catch(error) {
        if(error.code!=='ENOENT' && error.code!=='ENOTDIR')throw error;
        return {path:'',raw:'',bom:false,missing:true};
      }
    }
    if(type==='open-link') {
      if(typeof payload?.url!=='string')throw new Error('链接无效');
      const url=new URL(payload.url);
      if(!['https:','http:','mailto:'].includes(url.protocol))throw new Error('暂不支持打开这种链接');
      await shell.openExternal(url.href);return true;
    }
    if(type === 'new') {state.sessions.set(paneIdOf(payload),new FileSession());return {path:'',raw:''};}
    if(type === 'open') {
      const result=await dialog.showOpenDialog(state.window,{properties:['openFile'],filters:[{name:'Markdown',extensions:['md','markdown','txt']}]});
      if(result.canceled) return null;
      const startedAt=Date.now(),session=sessionFor(state,paneIdOf(payload));
      await session.load(result.filePaths[0]);
      if(payload?.deferRecent===true)session.openStartedAt=startedAt;
      else await noteOpened(session.path,startedAt);
      return {path:session.path,raw:session.raw,bom:session.bom};
    }
    if(type === 'recover-open') {
      const startedAt=Date.now();
      const id=paneIdOf(payload);
      let claimed=null;
      if(typeof payload?.draftId==='string') {
        if([...windows.values()].some(item=>item!==state && item.draftIds.has(payload.draftId)))throw new Error('这个草稿已在另一个窗口恢复');
        claimed=await readDraft(app.getPath('userData'),payload.draftId);
        if(!claimed)throw new Error('这个草稿已不存在，可能已在其他窗口处理');
        state.draftIds.add(payload.draftId);
      }
      const collected=result=>claimed?{...result,draft:{path:claimed.path,raw:claimed.raw,updatedAt:claimed.updatedAt}}:result;
      const path=typeof payload?.path==='string' ? payload.path : '';
      if(!path)return collected({path:'',raw:'',bom:false,missing:false});
      const session=sessionFor(state,id);
      try {
        await session.load(path);
        // The snapshot records the bytes it was taken against. If the file on
        // disk no longer matches, the user's draft is based on a version they
        // saw, while the disk holds one they did not: keep the draft's base so
        // any in-place save keeps going through the external-change refusal.
        // Snapshots from older builds carry no base at all: compare the draft
        // body with the disk instead, so an existing original is never
        // overwritten silently. A legacy draft that already equals the disk
        // holds nothing the file could lose, so its save flow stays normal.
        if(claimed) {
          const mismatch=typeof claimed.base==='string' ? claimed.base!==session.baseHash : claimed.raw!==session.raw;
          if(mismatch) {
            session.externalChange=true;
            if(typeof claimed.base==='string')session.baseHash=claimed.base;
          }
        }
        await noteOpened(session.path,startedAt);
        return collected({path:session.path,raw:session.raw,bom:session.bom,missing:false});
      }
      catch(error) {
        if(error.code!=='ENOENT')throw error;
        state.sessions.set(id,new FileSession());
        return collected({path:'',raw:'',bom:false,missing:true});
      }
    }
    if(type === 'save' || type === 'save-as') {
      if(typeof payload?.raw !== 'string') throw new Error('无效正文');
      const startedAt=Date.now(),session=sessionFor(state,paneIdOf(payload));
      const named=typeof payload?.name==='string' && payload.name.trim() && payload.name.trim().length<=120 && !/[\\/:*?"<>|\u0000-\u001f]/.test(payload.name) ? payload.name.trim() : '';
      const suggested=named && !/\.[a-z0-9]{1,8}$/i.test(named) ? named+'.md' : named;
      let destination=session.path, overwrite=false;
      if(type === 'save-as' || !destination) {
        const result=await dialog.showSaveDialog(state.window,{defaultPath:destination || suggested || '未命名.md',filters:[{name:'Markdown',extensions:['md']}]});
        if(result.canceled) return null;
        destination=result.filePath;overwrite=true;
      }
      const previous=session.path;
      const saved=await session.save(payload.raw,destination,overwrite);
      if(previous!==saved.path)await noteOpened(saved.path,startedAt);
      return saved;
    }
    if(type === 'confirm') {
      const name=typeof payload?.name==='string' && payload.name.trim() ? payload.name.trim().replace(/\s+/g,' ').slice(0,60) : '';
      const result=await dialog.showMessageBox(state.window,{type:'question',message:name?`「${name}」尚未保存`:'当前文档尚未保存',detail:'保存后再继续，或放弃本次更改。',buttons:['保存','取消','放弃更改'],defaultId:0,cancelId:1});
      return ['save','cancel','discard'][result.response];
    }
    if(type==='pane-adopt') {
      const id=paneIdOf(payload),from=payload?.from;
      const selected=typeof from==='string' && from!==id ? state.sessions.get(from) : null;
      if(!selected)throw new Error('待打开的文件已失效，请重新选择。');
      // A leave guard may Save As to the very file that was just selected.
      // Open its accepted bytes, including any such save, before rebinding.
      await selected.load(selected.path);
      // Keep the selected file's exact bytes, BOM and conflict baseline. The
      // destination's session stays intact until its leave guard has passed.
      state.sessions.set(id,selected);state.sessions.delete(from);
      const startedAt=selected.openStartedAt;delete selected.openStartedAt;
      await noteOpened(selected.path,startedAt);
      return {path:selected.path,raw:selected.raw,bom:selected.bom};
    }
    if(type==='pane-focus') {
      const id=paneIdOf(payload);
      state.activePane=id;
      state.paneOrder=[id,...state.paneOrder.filter(item=>item!==id)].slice(0,16);
      return true;
    }
    if(type==='pane-closed') {
      const id=paneIdOf(payload);
      state.sessions.delete(id);
      state.paneOrder=state.paneOrder.filter(item=>item!==id);
      if(state.activePane===id)state.activePane='primary';
      return true;
    }
    if(type==='adopt') {
      const id=paneIdOf(payload);
      const path=typeof payload?.path==='string' ? payload.path : '';
      if(!path){state.sessions.set(id,new FileSession());return true;}
      try { await sessionFor(state,id).load(path); }
      catch { state.sessions.set(id,new FileSession()); }
      return true;
    }
    if(type === 'new-window') {openWindow('',true).ready.catch(showWindowFailure);return true;}
    if(type === 'open-window') {
      const result=await dialog.showOpenDialog(state.window,{properties:['openFile'],filters:[{name:'Markdown',extensions:['md','markdown','txt']}]});
      if(result.canceled) return false;
      const existing=windowFor(result.filePaths[0]);
      if(existing)focusWindow(existing);
      else openWindow(result.filePaths[0]).ready.catch(showWindowFailure);
      return true;
    }
    throw new Error('未知操作');
  });
  state.queue=task.catch(() => {}); return task;
});
const send=type=>()=>{
  const target=BrowserWindow.getFocusedWindow() ?? lastFocused?.window;
  if(target && !target.isDestroyed())target.webContents.send('command',type);
};
Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'文件',submenu:[{label:'新建',accelerator:'CmdOrCtrl+N',click:send('new')},{label:'新建窗口',accelerator:'CmdOrCtrl+Shift+N',click:send('new-window')},{label:'打开',accelerator:'CmdOrCtrl+O',click:send('open')},{label:'在新窗口打开…',click:send('open-window')},{label:'保存',accelerator:'CmdOrCtrl+S',click:send('save')},{label:'另存为',accelerator:'CmdOrCtrl+Shift+S',click:send('save-as')},{type:'separator'},{role:'quit',label:'退出'}]},{label:'编辑',submenu:[{label:'撤销',accelerator:'CmdOrCtrl+Z',click:send('undo')},{label:'重做',accelerator:'CmdOrCtrl+Shift+Z',click:send('redo')},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},{label:'视图',submenu:[{label:'文档侧栏',accelerator:'F9',click:send('toggle-sidebar')},{label:'切换阅读 / 源码',accelerator:'CmdOrCtrl+E',click:send('toggle')},{type:'separator'},{label:'向右分屏',accelerator:'CmdOrCtrl+\\',click:send('split-right')},{label:'向下分屏',accelerator:'CmdOrCtrl+Shift+\\',click:send('split-down')},{label:'在新分屏打开…',click:send('split-open')},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]}]));
await openWindow(fileArgument(process.argv)).ready;
if(app.isPackaged && !process.windowsStore)registerMarkdown(process.execPath).catch(error=>{for(const state of windows.values())state.window.webContents.send('association-error',String(error));});
app.on('window-all-closed',() => app.quit());
}).catch(error => {dialog.showErrorBox('M1racle Note 启动失败',String(error));app.quit();});
}
