import {mkdir,open,readFile,readdir,rename,rm,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// App-private, disposable draft snapshots. Never the source of truth: the
// Markdown file stays authoritative; drafts only survive abnormal termination.
export const DRAFT_TTL_MS=7*24*60*60*1000;
const TEMP_TTL_MS=60*60*1000;
const ID_PATTERN=/^[a-z0-9-]{8,64}$/i;
const BASE_PATTERN=/^[0-9a-f]{64}$/;
const recoveryDir=directory=>join(directory,'recovery');
const quarantineDir=directory=>join(recoveryDir(directory),'quarantine');
const requireId=id=>{
 if(typeof id!=='string' || !ID_PATTERN.test(id))throw new Error('无效的草稿标识');
 return id;
};
const validDraft=(name,value)=>Boolean(value) && value.version===1 && typeof value.id==='string' && ID_PATTERN.test(value.id) && value.id+'.json'===name && typeof value.raw==='string' && typeof value.path==='string' && typeof value.updatedAt==='number' && (value.base===undefined || (typeof value.base==='string' && BASE_PATTERN.test(value.base)));
// Expired or unreadable snapshots move aside for a human instead of being
// deleted: drafts are disposable, but silent removal is still data loss.
const quarantine=async(directory,name)=>{
 try {await mkdir(quarantineDir(directory),{recursive:true});await rename(join(recoveryDir(directory),name),join(quarantineDir(directory),`${Date.now()}-${name}`));}
 catch {}
};
export async function listDrafts(directory,{now=Date.now()}={}) {
 const dir=recoveryDir(directory);let names;
 try {names=await readdir(dir);}
 catch(error) {if(error.code==='ENOENT' || error.code==='ENOTDIR')return [];throw error;}
 const drafts=[];
 for(const name of names) {
  if(name.startsWith('.'))continue;
  if(!name.endsWith('.json')) {
   // A snapshot interrupted by a crash can leave its temp file behind.
   if(name.endsWith('.tmp')) {
    const file=join(dir,name);
    try {if(now-(await stat(file)).mtimeMs>TEMP_TTL_MS)await unlink(file);} catch {}
   }
   continue;
  }
  const file=join(dir,name);
  try {
   const value=JSON.parse(await readFile(file,'utf8'));
   if(!validDraft(name,value))throw new Error('draft-shape');
   if(now-value.updatedAt>DRAFT_TTL_MS){await quarantine(directory,name);continue;}
   drafts.push({id:value.id,path:value.path,raw:value.raw,updatedAt:value.updatedAt,...(value.base?{base:value.base}:{})});
  } catch {await quarantine(directory,name);}
 }
 return drafts.sort((left,right)=>right.updatedAt-left.updatedAt);
}
export async function readDraft(directory,id) {
 const name=requireId(id)+'.json';
 try {
  const value=JSON.parse(await readFile(join(recoveryDir(directory),name),'utf8'));
  if(!validDraft(name,value))return null;
  return {id:value.id,path:value.path,raw:value.raw,updatedAt:value.updatedAt,...(value.base?{base:value.base}:{})};
 } catch {return null;}
}
export async function writeDraft(directory,draft) {
 const id=requireId(draft?.id);
 if(typeof draft.raw!=='string')throw new Error('无效的草稿内容');
 if(typeof draft.path!=='string' || draft.path.length>4096)throw new Error('无效的草稿目标');
 if(draft.base!==undefined && (typeof draft.base!=='string' || !BASE_PATTERN.test(draft.base)))throw new Error('无效的草稿基线');
 const updatedAt=typeof draft.updatedAt==='number'?draft.updatedAt:Date.now();
 const dir=recoveryDir(directory);await mkdir(dir,{recursive:true});
 const temp=join(dir,`${id}-${randomUUID()}.tmp`);
 try {
  const file=await open(temp,'wx');
  try {await file.writeFile(JSON.stringify({version:1,id,path:draft.path,raw:draft.raw,updatedAt,...(typeof draft.base==='string'?{base:draft.base}:{})}));await file.sync();} finally {await file.close();}
  await rename(temp,join(dir,id+'.json'));
 } finally {await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function clearDraft(directory,id) {
 requireId(id);
 await rm(join(recoveryDir(directory),id+'.json'),{force:true});
}
const draftQueues=new Map();
// Per-id FIFO so a discard can never be overtaken by an in-flight snapshot,
// and successive snapshots of one document apply in request order.
export function serializeDraftOp(id,operation) {
 const run=(draftQueues.get(id) || Promise.resolve()).catch(()=>{}).then(operation);
 draftQueues.set(id,run);
 run.catch(()=>{}).finally(()=>{if(draftQueues.get(id)===run)draftQueues.delete(id);});
 return run;
}
