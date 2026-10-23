import {open,readFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Session context only: which document was last active and where the user was
// in it (mode, cursor, scroll). Never stores document bytes; the Markdown file
// stays the authoritative source and the Batch 2A drafts stay the only copy of
// unsaved content. Corrupt or malformed records read as "no session" so the
// app always degrades to the initial interface instead of failing to start.
const FILE='session.json';
const MODES=new Set(['read','code']);
const MAX_INT=0x7fffffff;
const validCursor=value=>Boolean(value) && Number.isInteger(value.anchor) && Number.isInteger(value.head)
 && value.anchor>=0 && value.head>=0 && value.anchor<=MAX_INT && value.head<=MAX_INT;
const validRecord=value=>Boolean(value) && value.version===1 && Number.isFinite(value.updatedAt)
 && typeof value.path==='string' && value.path.length<=4096 && MODES.has(value.mode)
 && validCursor(value.cursor) && Number.isFinite(value.scrollTop) && value.scrollTop>=0 && value.scrollTop<=MAX_INT;

export async function readSession(directory) {
 try {
  const value=JSON.parse(await readFile(join(directory,FILE),'utf8'));
  return validRecord(value)?value:null;
 } catch { return null; }
}

export async function writeSession(directory,record) {
 if(!validRecord(record))throw new Error('无效的会话状态');
 const temp=join(directory,`.session-${randomUUID()}.tmp`);
 try {
  const handle=await open(temp,'wx');
  try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp,join(directory,FILE));
 } finally { await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
}
