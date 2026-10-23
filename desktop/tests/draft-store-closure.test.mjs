import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as store from '../drafts.mjs';

// Batch 2A review closure: store-level guarantees. Expired or unreadable
// snapshots are quarantined instead of deleted, a blocked recovery path never
// fails the listing, and per-id operations stay in FIFO order.
const fresh=async()=>mkdtemp(join(tmpdir(),'note-drafts-closure-'));
const now=1700000000000;
const draft=(over={})=>({id:'11111111-2222-3333-4444-555555555555',path:'',raw:'未保存的内容',updatedAt:now,...over});
const requireExport=name=>{assert.equal(typeof store[name],'function',`drafts.mjs must export ${name}`);return store[name];};

test('expired drafts move to quarantine instead of being deleted',async()=>{
 const dir=await fresh();
 await store.writeDraft(dir,draft({updatedAt:now-store.DRAFT_TTL_MS-1}));
 assert.deepEqual(await store.listDrafts(dir,{now}),[]);
 const quarantined=await readdir(join(dir,'recovery','quarantine'));
 assert.equal(quarantined.length,1);
 assert.match(quarantined[0],/11111111-2222-3333-4444-555555555555\.json$/);
 const preserved=JSON.parse(await readFile(join(dir,'recovery','quarantine',quarantined[0]),'utf8'));
 assert.equal(preserved.raw,'未保存的内容');
});

test('unreadable drafts move to quarantine with their bytes intact',async()=>{
 const dir=await fresh();
 await mkdir(join(dir,'recovery'),{recursive:true});
 await writeFile(join(dir,'recovery','broken.json'),'{not json');
 assert.deepEqual(await store.listDrafts(dir,{now}),[]);
 const quarantined=await readdir(join(dir,'recovery','quarantine'));
 assert.equal(quarantined.length,1);
 assert.equal(await readFile(join(dir,'recovery','quarantine',quarantined[0]),'utf8'),'{not json');
});

test('listing tolerates the recovery path being a plain file',async()=>{
 const dir=await fresh();
 await writeFile(join(dir,'recovery'),'occupied');
 assert.deepEqual(await store.listDrafts(dir,{now}),[]);
});

test('readDraft returns the stored draft and null for missing or corrupt files',async()=>{
 const readDraft=requireExport('readDraft');
 const dir=await fresh();
 await store.writeDraft(dir,draft({raw:'读我'}));
 const value=await readDraft(dir,'11111111-2222-3333-4444-555555555555');
 assert.equal(value.raw,'读我');
 assert.equal(value.updatedAt,now);
 assert.equal(await readDraft(dir,'99999999-2222-3333-4444-555555555555'),null);
 await writeFile(join(dir,'recovery','88888888-2222-3333-4444-555555555555.json'),'{broken');
 assert.equal(await readDraft(dir,'88888888-2222-3333-4444-555555555555'),null);
});

test('serializeDraftOp keeps per-id order, isolates ids, and survives failures',async()=>{
 const serializeDraftOp=requireExport('serializeDraftOp');
 const order=[];
 const first=serializeDraftOp('aaaaaaaa-0000-0000-0000-000000000000',async()=>{await new Promise(resolve=>setTimeout(resolve,60));order.push('first');return 'first';});
 const second=serializeDraftOp('aaaaaaaa-0000-0000-0000-000000000000',async()=>{order.push('second');return 'second';});
 const other=serializeDraftOp('bbbbbbbb-0000-0000-0000-000000000000',async()=>{order.push('other');return 'other';});
 assert.deepEqual(await Promise.all([first,second,other]),['first','second','other']);
 assert.ok(order.indexOf('first')<order.indexOf('second'));
 await assert.rejects(serializeDraftOp('aaaaaaaa-0000-0000-0000-000000000000',async()=>{throw new Error('boom');}),/boom/);
 assert.equal(await serializeDraftOp('aaaaaaaa-0000-0000-0000-000000000000',async()=>'recovered'),'recovered');
});

test('interrupted snapshot writes are swept only after they are stale',async()=>{
 const dir=await fresh();
 await mkdir(join(dir,'recovery'),{recursive:true});
 const temp=join(dir,'recovery','11111111-2222-3333-4444-555555555555-0000-0000.tmp');
 await writeFile(temp,'半截');
 await store.listDrafts(dir,{now});
 assert.ok((await readdir(join(dir,'recovery'))).includes('11111111-2222-3333-4444-555555555555-0000-0000.tmp'));
 const old=new Date(now-2*60*60*1000);
 await utimes(temp,old,old);
 await store.listDrafts(dir,{now});
 assert.ok(!(await readdir(join(dir,'recovery'))).includes('11111111-2222-3333-4444-555555555555-0000-0000.tmp'));
});

test('snapshots persist an optional base hash of the bytes they were taken against',async()=>{
 const dir=await fresh();
 const base='a'.repeat(64);
 await store.writeDraft(dir,draft({base}));
 const readBack=await store.readDraft(dir,'11111111-2222-3333-4444-555555555555');
 assert.equal(readBack.base,base);
 const listed=await store.listDrafts(dir,{now});
 assert.equal(listed[0].base,base);
 await store.writeDraft(dir,draft({id:'22222222-3333-4444-5555-666666666666'}));
 const withoutBase=await store.readDraft(dir,'22222222-3333-4444-5555-666666666666');
 assert.equal(withoutBase.base,undefined);
});

test('malformed base hashes are rejected on write and quarantined on read',async()=>{
 const dir=await fresh();
 await assert.rejects(store.writeDraft(dir,draft({base:'not-a-hash'})),/基线/);
 await mkdir(join(dir,'recovery'),{recursive:true});
 await writeFile(join(dir,'recovery','33333333-4444-5555-6666-777777777777.json'),JSON.stringify(draft({id:'33333333-4444-5555-6666-777777777777',base:'bad'})));
 assert.deepEqual(await store.listDrafts(dir,{now}),[]);
 const quarantined=await readdir(join(dir,'recovery','quarantine'));
 assert.equal(quarantined.length,1);
 assert.match(quarantined[0],/33333333-4444-5555-6666-777777777777\.json$/);
});
