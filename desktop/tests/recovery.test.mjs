import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listDrafts,writeDraft,clearDraft,DRAFT_TTL_MS} from '../drafts.mjs';

const fresh=async()=>mkdtemp(join(tmpdir(),'note-drafts-'));
const draft=(over={})=>({id:'11111111-2222-3333-4444-555555555555',path:'',raw:'未保存的内容',updatedAt:1700000000000,...over});

test('write then list round-trips draft fields and leaves no temp files',async()=>{
 const dir=await fresh();
 await writeDraft(dir,draft({path:'C:\\docs\\a.md',raw:'内容\n二行'}));
 const drafts=await listDrafts(dir,{now:1700000000000});
 assert.equal(drafts.length,1);
 assert.deepEqual(drafts[0],{id:'11111111-2222-3333-4444-555555555555',path:'C:\\docs\\a.md',raw:'内容\n二行',updatedAt:1700000000000});
 assert.deepEqual((await readdir(join(dir,'recovery'))).filter(name=>name.endsWith('.tmp')),[]);
});

test('writing the same draft id again replaces content atomically',async()=>{
 const dir=await fresh();
 await writeDraft(dir,draft());
 await writeDraft(dir,draft({raw:'更新后的内容'}));
 const drafts=await listDrafts(dir,{now:1700000000000});
 assert.equal(drafts.length,1);
 assert.equal(drafts[0].raw,'更新后的内容');
 assert.deepEqual((await readdir(join(dir,'recovery'))).filter(name=>name.endsWith('.tmp')),[]);
});

test('clearDraft removes the file and stays idempotent',async()=>{
 const dir=await fresh();
 await writeDraft(dir,draft());
 await clearDraft(dir,'11111111-2222-3333-4444-555555555555');
 assert.deepEqual(await listDrafts(dir,{now:1700000000000}),[]);
 await clearDraft(dir,'11111111-2222-3333-4444-555555555555');
});

test('corrupt draft files are removed and do not fail the listing',async()=>{
 const dir=await fresh();
 await writeDraft(dir,draft());
 await mkdir(join(dir,'recovery'),{recursive:true});
 await writeFile(join(dir,'recovery','broken.json'),'{not json');
 await writeFile(join(dir,'recovery','wrong-shape.json'),JSON.stringify({version:2,id:'x',path:'',raw:'',updatedAt:1}));
 const drafts=await listDrafts(dir,{now:1700000000000});
 assert.equal(drafts.length,1);
 assert.equal(drafts[0].raw,'未保存的内容');
 const names=await readdir(join(dir,'recovery'));
 assert.ok(!names.includes('broken.json'));
 assert.ok(!names.includes('wrong-shape.json'));
});

test('expired drafts are removed, fresh ones survive the TTL boundary',async()=>{
 const dir=await fresh();
 const now=1700000000000;
 await writeDraft(dir,draft({id:'aaaaaaaa-2222-3333-4444-555555555555',updatedAt:now-DRAFT_TTL_MS-1}));
 await writeDraft(dir,draft({id:'bbbbbbbb-2222-3333-4444-555555555555',updatedAt:now-DRAFT_TTL_MS+60000}));
 const drafts=await listDrafts(dir,{now});
 assert.deepEqual(drafts.map(value=>value.id),['bbbbbbbb-2222-3333-4444-555555555555']);
});

test('draft ids outside the safe pattern are rejected',async()=>{
 const dir=await fresh();
 for(const id of ['../evil','a','x'.repeat(80),'has space','sub/dir'])await assert.rejects(writeDraft(dir,draft({id})),/草稿/);
 await assert.rejects(clearDraft(dir,'../evil'),/草稿/);
 await assert.rejects(clearDraft(dir,'has space'),/草稿/);
});

test('listing a missing recovery directory returns an empty list',async()=>{
 const dir=await fresh();
 assert.deepEqual(await listDrafts(dir,{now:Date.now()}),[]);
});
