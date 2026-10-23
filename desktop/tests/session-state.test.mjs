import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSession,writeSession} from '../session-state.mjs';

// Batch 2B session state: context only (which document, mode, cursor, scroll),
// never document bytes. Corrupt or malformed records must degrade to "no
// session" instead of blocking startup or restoring something unintended.
const record=overrides=>({
 version:1,
 updatedAt:Date.now(),
 path:'C:\\notes\\doc.md',
 mode:'read',
 cursor:{anchor:12,head:18},
 scrollTop:240,
 ...overrides,
});
const fresh=async()=>mkdtemp(join(tmpdir(),'note-session-state-'));

test('session records round-trip through an atomic write',async()=>{
 const dir=await fresh();
 const value=record();
 await writeSession(dir,value);
 assert.deepEqual(await readSession(dir),value);
 const second=record({path:'C:\\notes\\other.md',mode:'code',cursor:{anchor:0,head:0},scrollTop:0});
 await writeSession(dir,second);
 assert.deepEqual(await readSession(dir),second);
 const names=await readdir(dir);
 assert.deepEqual(names,['session.json']);
});

test('a missing session file reads as no session',async()=>{
 const dir=await fresh();
 assert.equal(await readSession(dir),null);
});

test('corrupt session files degrade to no session',async()=>{
 const dir=await fresh();
 await writeFile(join(dir,'session.json'),'{not-json');
 assert.equal(await readSession(dir),null);
 await writeFile(join(dir,'session.json'),'{"version":1,"path":"C:\\\\a.md"');
 assert.equal(await readSession(dir),null);
 await writeFile(join(dir,'session.json'),'null');
 assert.equal(await readSession(dir),null);
});

test('malformed records are rejected on read and on write',async()=>{
 const dir=await fresh();
 const invalid=[
  record({version:2}),
  record({path:5}),
  record({path:'x'.repeat(4097)}),
  record({mode:'preview'}),
  record({cursor:{anchor:-1,head:0}}),
  record({cursor:{anchor:1.5,head:0}}),
  record({scrollTop:-5}),
  record({scrollTop:'240'}),
  record({updatedAt:'now'}),
 ];
 for(const value of invalid) {
  await writeFile(join(dir,'session.json'),JSON.stringify(value));
  assert.equal(await readSession(dir),null,JSON.stringify(value));
  await assert.rejects(writeSession(dir,value),/无效的会话状态/);
 }
 const good=record();
 await writeSession(dir,good);
 assert.deepEqual(await readSession(dir),good);
});

test('a valid record replaces corrupt bytes safely',async()=>{
 const dir=await fresh();
 await writeFile(join(dir,'session.json'),'{"version":1,"broken"');
 assert.equal(await readSession(dir),null);
 const value=record({path:'',mode:'read',cursor:{anchor:0,head:0},scrollTop:0});
 await writeSession(dir,value);
 assert.deepEqual(await readSession(dir),value);
});
