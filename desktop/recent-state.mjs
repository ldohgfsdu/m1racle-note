import {open,readFile,rename,unlink,stat} from 'node:fs/promises';
import {join,resolve,basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// Recent documents: identity and place only (path, display name, folder hint,
// last access time). Never document bytes; the Markdown file stays the single
// source of document content. Corrupt or malformed records read as "no
// history" so the app degrades to an empty list instead of failing to start.
const FILE='recent.json';
export const RECENT_LIMIT=20;
const MAX_PATH=4096;
const MAX_NAME=300;
const validItem=value=>Boolean(value) && typeof value.path==='string' && value.path.length>0 && value.path.length<=MAX_PATH
 && typeof value.name==='string' && value.name.length>0 && value.name.length<=MAX_NAME
 && typeof value.dir==='string' && value.dir.length<=MAX_PATH
 && Number.isFinite(value.accessedAt) && value.accessedAt>=0;
// Removal tombstones ({key,removedAt}) are optional so version 1 records written
// by Batch 2C stay valid. A tombstone beats any open that STARTED before the
// removal; an open that starts later clears it. Bounded so it never grows.
export const TOMBSTONE_LIMIT=100;
const validTombstone=value=>Boolean(value) && typeof value.key==='string' && value.key.length>0 && value.key.length<=MAX_PATH
 && Number.isFinite(value.removedAt) && value.removedAt>=0;
const validShape=value=>Boolean(value) && value.version===1 && Number.isFinite(value.updatedAt)
 && Array.isArray(value.items) && value.items.every(validItem)
 && (value.removed===undefined || (Array.isArray(value.removed) && value.removed.length<=TOMBSTONE_LIMIT && value.removed.every(validTombstone)));
const validRecord=value=>validShape(value) && value.items.length<=RECENT_LIMIT;

export function recentKey(path) {
 try { return resolve(path).toLowerCase(); } catch { return ''; }
}

export function mergeRecent(items,entry,limit=RECENT_LIMIT) {
 const key=recentKey(entry.path);
 return [entry,...items.filter(item=>recentKey(item.path)!==key)].slice(0,limit);
}

export async function readRecent(directory) {
 try {
  const value=JSON.parse(await readFile(join(directory,FILE),'utf8'));
  if(!validShape(value))return null;
  // A longer list (older or hand-edited file) is trimmed to the cap, newest first,
  // instead of discarding the whole history.
  return value.items.length>RECENT_LIMIT?{...value,items:value.items.slice(0,RECENT_LIMIT)}:value;
 } catch { return null; }
}

export async function writeRecent(directory,record) {
 if(!validRecord(record))throw new Error('无效的最近记录');
 const temp=join(directory,`.recent-${randomUUID()}.tmp`);
 try {
  const handle=await open(temp,'wx');
  try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp,join(directory,FILE));
 } finally { await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
}

// Serialized read-merge-write keyed by document: concurrent opens from several
// windows are merged into the record on disk, never replace the whole table.
// The access time is the successful open; ties keep the later write in front.
// openedAt is when the open STARTED; it is compared with a removal tombstone.
let chain=Promise.resolve();
const serial=job=>{const task=chain.then(job);chain=task.catch(()=>{});return task;};
const tombstones=(current,key)=>(current?.removed||[]).filter(entry=>entry.key!==key);
const save=(directory,items,removed)=>writeRecent(directory,{version:1,updatedAt:Date.now(),items,...(removed.length?{removed:removed.slice(0,TOMBSTONE_LIMIT)}:{})});
export function recordRecent(directory,path,now=Date.now(),openedAt=now) {
 return serial(async()=>{
  const current=await readRecent(directory);
  const items=current?current.items:[];
  const key=recentKey(path);
  const stone=(current?.removed||[]).find(entry=>entry.key===key);
  if(stone && stone.removedAt>openedAt)return items;
  const newest=items.reduce((max,entry)=>Math.max(max,entry.accessedAt),0);
  const entry={path,name:basename(path),dir:dirname(path),accessedAt:Math.max(now,newest)};
  const next=mergeRecent(items,entry);
  await save(directory,next,tombstones(current,key));
  return next;
 });
}

// "Remove from recent documents": edits only recent.json. The document, any
// draft and the open session are never touched. The tombstone (newest first)
// keeps an open that raced with the removal from bringing the record back.
export function removeRecent(directory,path,now=Date.now(),force=false) {
 return serial(async()=>{
  const current=await readRecent(directory);
  const key=recentKey(path);
  const items=current?current.items:[];
  const found=items.some(entry=>recentKey(entry.path)===key);
  if(!found && !force)return {removed:false,items};
  const next=items.filter(entry=>recentKey(entry.path)!==key);
  await save(directory,next,[{key,removedAt:now},...tombstones(current,key)]);
  return {removed:found,items:next};
 });
}
// Reading the list only stats each remembered path (at most RECENT_LIMIT); it
// never opens, reads or creates a document.
// A stat that never answers (dead network share) must not hold the list hostage:
// after timeoutMs the row reads as inaccessible. probe is injectable for tests.
export async function recentStatus(path,timeoutMs=3000,probe=stat) {
 let timer;
 const timeout=new Promise(done=>{timer=setTimeout(()=>done('denied'),timeoutMs);});
 const check=probe(path).then(info=>info.isFile()?'ok':'denied',error=>error.code==='ENOENT' || error.code==='ENOTDIR'?'missing':'denied');
 try { return await Promise.race([check,timeout]); } finally { clearTimeout(timer); }
}export async function listRecent(directory) {
 const record=await readRecent(directory);
 if(!record)return [];
 return Promise.all(record.items.map(async entry=>({...entry,status:await recentStatus(entry.path)})));
}
