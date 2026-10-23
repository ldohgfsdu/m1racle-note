import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRecent,writeRecent,mergeRecent,recentKey,recordRecent,recentStatus,listRecent,RECENT_LIMIT} from '../recent-state.mjs';

// Batch 2C recent documents: metadata only (path, display name, folder hint,
// access time). Never document bytes. This store must survive corrupt files,
// dedupe case-insensitively across windows, keep a stable recency order and
// cap unbounded growth without losing the most recent entries.
const item=overrides=>({path:'C:\\notes\\alpha.md',name:'alpha.md',dir:'C:\\notes',accessedAt:1_700_000_000_000,...overrides});
const record=overrides=>({version:1,updatedAt:Date.now(),items:[item()],...overrides});
const fresh=async()=>mkdtemp(join(tmpdir(),'note-recent-state-'));

test('recent records round-trip through an atomic write',async()=>{
 const dir=await fresh();
 const value=record({items:[item(),item({path:'C:\\notes\\beta.md',name:'beta.md',accessedAt:1_700_000_000_001})]});
 await writeRecent(dir,value);
 assert.deepEqual(await readRecent(dir),value);
 const names=await readdir(dir);
 assert.deepEqual(names,['recent.json']);
});

test('a missing recent file reads as no history',async()=>{
 const dir=await fresh();
 assert.equal(await readRecent(dir),null);
});

test('corrupt recent files degrade to no history',async()=>{
 const dir=await fresh();
 for(const garbage of ['{not-json','{"version":1,"items":[','null','[]','{"version":"1","items":[]}']) {
  await writeFile(join(dir,'recent.json'),garbage);
  assert.equal(await readRecent(dir),null,garbage);
 }
});

test('malformed records are rejected on read and on write',async()=>{
 const dir=await fresh();
 const invalid=[
  record({version:2}),
  record({updatedAt:'now'}),
  record({items:'none'}),
  record({items:[item({path:''})]}),
  record({items:[item({path:'x'.repeat(4097)})]}),
  record({items:[item({name:5})]}),
  record({items:[item({name:'x'.repeat(301)})]}),
  record({items:[item({dir:null})]}),
  record({items:[item({accessedAt:'yesterday'})]}),
 ];
 for(const value of invalid) {
  await writeFile(join(dir,'recent.json'),JSON.stringify(value));
  assert.equal(await readRecent(dir),null,JSON.stringify(value).slice(0,80));
  await assert.rejects(writeRecent(dir,value),/无效的最近记录/);
 }
 // Oversized lists are not malformed: reads trim them (covered in recent-closure.test.mjs); writes still reject them.
 await assert.rejects(writeRecent(dir,record({items:Array.from({length:RECENT_LIMIT+1},(_,index)=>item({path:`C:\\notes\\n${index}.md`}))})),/无效的最近记录/);
 const good=record();
 await writeRecent(dir,good);
 assert.deepEqual(await readRecent(dir),good);
});

test('a valid record replaces corrupt bytes safely',async()=>{
 const dir=await fresh();
 await writeFile(join(dir,'recent.json'),'{"version":1,"items":[');
 assert.equal(await readRecent(dir),null);
 const empty=record({items:[]});
 await writeRecent(dir,empty);
 assert.deepEqual(await readRecent(dir),empty);
});

test('mergeRecent moves known documents to the front and dedupes case-insensitively',async()=>{
 const alpha=item({accessedAt:1}),beta=item({path:'C:\\notes\\beta.md',name:'beta.md',accessedAt:2});
 let items=mergeRecent([],beta);
 items=mergeRecent(items,alpha);
 assert.deepEqual(items.map(entry=>entry.name),['alpha.md','beta.md']);
 items=mergeRecent(items,item({path:'c:\\NOTES\\ALPHA.MD',accessedAt:3}));
 assert.equal(items.length,2);
 assert.equal(items[0].name,'alpha.md');
 assert.equal(items[0].accessedAt,3);
 assert.equal(recentKey('C:\\notes\\alpha.md'),recentKey('c:\\notes\\ALPHA.MD'));
});

test('mergeRecent keeps order stable, caps growth and never mutates its input',async()=>{
 const original=[item({path:'C:\\notes\\one.md',name:'one.md'}),item({path:'C:\\notes\\two.md',name:'two.md'})];
 const grown=mergeRecent(original,item({path:'C:\\notes\\three.md',name:'three.md'}));
 assert.deepEqual(grown.map(entry=>entry.name),['three.md','one.md','two.md']);
 assert.deepEqual(original.map(entry=>entry.name),['one.md','two.md']);
 let items=[];
 for(let index=0;index<RECENT_LIMIT+5;index++)items=mergeRecent(items,item({path:`C:\\notes\\doc-${index}.md`,name:`doc-${index}.md`,accessedAt:index}));
 assert.equal(items.length,RECENT_LIMIT);
 assert.equal(items[0].name,`doc-${RECENT_LIMIT+4}.md`);
 assert.equal(items.some(entry=>entry.name==='doc-0.md'),false);
 const again=mergeRecent(items,items[1]);
 assert.equal(again.length,RECENT_LIMIT);
 assert.equal(again[0].name,items[1].name);
 assert.equal(again[1].name,items[0].name);
});

const doc=async(dir,name,body='正文\n')=>{const file=join(dir,name);await writeFile(file,body);return file;};

test('recordRecent writes metadata only, never document bytes',async()=>{
 const dir=await fresh(),file=await doc(dir,'meta.md','秘密正文 SECRET-BODY\n');
 await recordRecent(dir,file,1000);
 const raw=await readFile(join(dir,'recent.json'),'utf8');
 assert.equal(raw.includes('SECRET-BODY'),false);
 const stored=await readRecent(dir);
 assert.deepEqual(Object.keys(stored.items[0]).sort(),['accessedAt','dir','name','path']);
 assert.equal(stored.items[0].name,'meta.md');
 assert.equal(stored.items[0].dir,dir);
 assert.deepEqual(await readdir(dir).then(names=>names.filter(name=>name.startsWith('.recent-'))),[]);
});

test('recordRecent dedupes one document, orders by recency and keeps ties in write order',async()=>{
 const dir=await fresh(),a=await doc(dir,'a.md'),b=await doc(dir,'b.md');
 await recordRecent(dir,a,10);
 await recordRecent(dir,b,10);
 assert.deepEqual((await readRecent(dir)).items.map(entry=>entry.name),['b.md','a.md']);
 await recordRecent(dir,a.toUpperCase(),10);
 const items=(await readRecent(dir)).items;
 assert.equal(items.length,2);
 assert.equal(items[0].path,a.toUpperCase());
});

test('recordRecent never moves time backwards when the clock is behind a stored record',async()=>{
 const dir=await fresh(),a=await doc(dir,'a.md'),b=await doc(dir,'b.md');
 await recordRecent(dir,a,5000);
 await recordRecent(dir,b,1000);
 const items=(await readRecent(dir)).items;
 assert.deepEqual(items.map(entry=>entry.name),['b.md','a.md']);
 assert.ok(items[0].accessedAt>=items[1].accessedAt);
});

test('concurrent opens from many windows merge by document and lose nothing',async()=>{
 const dir=await fresh();
 const files=[];
 for(let index=0;index<15;index++)files.push(await doc(dir,`w${index}.md`));
 await Promise.all([...files,files[3],files[7],files[3]].map((file,index)=>recordRecent(dir,file,100+index)));
 const stored=await readRecent(dir);
 assert.ok(stored,'record must stay valid JSON');
 assert.equal(stored.items.length,15);
 assert.deepEqual(new Set(stored.items.map(entry=>entry.name)).size,15);
 assert.equal(stored.items[0].name,'w3.md');
});

test('recordRecent recovers from a corrupt record and a failed write does not break the chain',async()=>{
 const dir=await fresh(),file=await doc(dir,'ok.md');
 await writeFile(join(dir,'recent.json'),'{broken');
 await recordRecent(dir,file,1);
 assert.equal((await readRecent(dir)).items.length,1);
 await assert.rejects(recordRecent(dir,join(dir,'x'.repeat(400)+'.md'),2));
 await recordRecent(dir,file,3);
 assert.equal((await readRecent(dir)).items.length,1);
});

test('status reports missing and inaccessible paths without creating anything',async()=>{
 const dir=await fresh(),file=await doc(dir,'live.md'),gone=join(dir,'gone.md'),blocked=join(dir,'blocked.md');
 await mkdir(blocked);
 assert.equal(await recentStatus(file),'ok');
 assert.equal(await recentStatus(gone),'missing');
 assert.equal(await recentStatus(join(file,'child.md')),'missing');
 assert.equal(await recentStatus(blocked),'denied');
 const before=await readdir(dir);
 await recordRecent(dir,file,1);
 const after=await readdir(dir);
 await recordRecent(dir,gone.replace('gone','gone2'),2).catch(()=>{});
 const list=await listRecent(dir);
 assert.deepEqual(list.map(entry=>entry.status),['missing','ok']);
 assert.equal(await recentStatus(gone.replace('gone','gone2')),'missing');
 assert.deepEqual((await readdir(dir)).sort(),[...after].sort());
 assert.deepEqual(after.sort(),[...before,'recent.json'].sort());
});

test('listing never modifies documents and an invalid record lists as empty',async()=>{
 const dir=await fresh(),file=await doc(dir,'same.md','不变\n');
 await recordRecent(dir,file,1);
 const before=await readFile(file);
 await listRecent(dir);
 assert.ok((await readFile(file)).equals(before));
 await writeFile(join(dir,'recent.json'),'garbage');
 assert.deepEqual(await listRecent(dir),[]);
 await rm(join(dir,'recent.json'));
 assert.deepEqual(await listRecent(dir),[]);
});
