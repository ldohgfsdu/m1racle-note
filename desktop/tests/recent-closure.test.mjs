import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRecent,writeRecent,recordRecent,removeRecent,listRecent,recentKey,recentStatus,RECENT_LIMIT} from '../recent-state.mjs';
import {labelRecent,relativeTime} from '../recent-labels.mjs';

// Batch 2C.1: removal tombstones, tolerant capacity, same-name disambiguation
// and calendar-aware relative time (injected clock, local time zone).
const fresh=async()=>mkdtemp(join(tmpdir(),'note-recent-closure-'));
const doc=async(dir,name,body='正文\n')=>{const file=join(dir,name);await writeFile(file,body);return file;};
const names=async dir=>(await readRecent(dir)).items.map(entry=>entry.name);

test('removing a record only edits recent metadata and never touches the document',async()=>{
 const dir=await fresh(),a=await doc(dir,'a.md','甲\n'),b=await doc(dir,'b.md','乙\n');
 await recordRecent(dir,a,10);await recordRecent(dir,b,20);
 const before=await readFile(a);
 const result=await removeRecent(dir,a,30);
 assert.equal(result.removed,true);
 assert.deepEqual(await names(dir),['b.md']);
 assert.ok((await readFile(a)).equals(before));
 assert.equal((await readFile(b,'utf8')),'乙\n');
 assert.equal((await removeRecent(dir,join(dir,'never.md'),31)).removed,false);
 assert.deepEqual(await names(dir),['b.md']);
});

test('removal matches the same document case-insensitively and persists on disk',async()=>{
 const dir=await fresh(),a=await doc(dir,'a.md');
 await recordRecent(dir,a,10);
 await removeRecent(dir,a.toUpperCase(),20);
 assert.deepEqual((await readRecent(dir)).items,[]);
 assert.deepEqual((await listRecent(dir)),[]);
});

test('reopening a removed document successfully adds it back at the front',async()=>{
 const dir=await fresh(),a=await doc(dir,'a.md'),b=await doc(dir,'b.md');
 await recordRecent(dir,a,10);await recordRecent(dir,b,20);
 await removeRecent(dir,a,30);
 await recordRecent(dir,a,40,40);
 assert.deepEqual(await names(dir),['a.md','b.md']);
 assert.equal((await readRecent(dir)).removed?.some(entry=>entry.key===recentKey(a))??false,false);
});

test('an open that started before the removal cannot resurrect the record, a later open can',async()=>{
 const dir=await fresh(),a=await doc(dir,'a.md');
 await recordRecent(dir,a,10);
 await removeRecent(dir,a,100);
 await recordRecent(dir,a,150,50);
 assert.deepEqual(await names(dir),[]);
 await recordRecent(dir,a,160,120);
 assert.deepEqual(await names(dir),['a.md']);
});

test('concurrent opens and removals from many windows keep one consistent record',async()=>{
 const dir=await fresh(),files=[];
 for(let index=0;index<8;index++)files.push(await doc(dir,`m${index}.md`));
 for(const [index,file] of files.entries())await recordRecent(dir,file,10+index);
 await Promise.all([
  removeRecent(dir,files[2],200),removeRecent(dir,files[5],200),
  recordRecent(dir,files[2],210,150),recordRecent(dir,files[5],210,250),recordRecent(dir,files[6],220,220),
 ]);
 const stored=await readRecent(dir);
 assert.ok(stored);
 const list=stored.items.map(entry=>entry.name);
 assert.equal(new Set(list).size,list.length);
 assert.equal(list.includes('m2.md'),false);
 assert.equal(list.includes('m5.md'),true);
 assert.equal(list[0],'m6.md');
 assert.equal(list.length,7);
});

test('version 1 records without tombstones stay valid and tombstones stay bounded',async()=>{
 const dir=await fresh();
 const base={version:1,updatedAt:1,items:[{path:'C:\\n\\a.md',name:'a.md',dir:'C:\\n',accessedAt:1}]};
 await writeFile(join(dir,'recent.json'),JSON.stringify(base));
 assert.deepEqual((await readRecent(dir)).items.length,1);
 for(let index=0;index<150;index++)await removeRecent(dir,`C:\\n\\gone-${index}.md`,1000+index,true);
 const stored=await readRecent(dir);
 assert.ok(stored.removed.length<=100);
 assert.ok(stored.removed.some(entry=>entry.key===recentKey('C:\\n\\gone-149.md')));
 await writeFile(join(dir,'recent.json'),JSON.stringify({...base,removed:'bad'}));
 assert.equal(await readRecent(dir),null);
});

test('an oversized record on disk is trimmed to the cap instead of being discarded',async()=>{
 const dir=await fresh();
 const items=Array.from({length:50},(_,index)=>({path:`C:\\n\\d${index}.md`,name:`d${index}.md`,dir:'C:\\n',accessedAt:1000-index}));
 await writeFile(join(dir,'recent.json'),JSON.stringify({version:1,updatedAt:1,items}));
 const stored=await readRecent(dir);
 assert.equal(stored.items.length,RECENT_LIMIT);
 assert.equal(stored.items[0].name,'d0.md');
 await assert.rejects(writeRecent(dir,{version:1,updatedAt:1,items}),/无效的最近记录/);
});

const entry=path=>{const parts=path.split('\\');const name=parts.pop();return {path,name,dir:parts.join('\\'),accessedAt:1};};
test('same name different extension in one folder shows the extension',()=>{
 const labels=labelRecent([entry('C:\\x\\笔记\\a.md'),entry('C:\\x\\笔记\\a.txt'),entry('C:\\x\\笔记\\b.md')]);
 assert.equal(labels[0].title,'a.md');
 assert.equal(labels[1].title,'a.txt');
 assert.equal(labels[2].title,'b');
 assert.equal(labels[0].hint,'笔记 / x');
});
test('extension suffix survives middle truncation',()=>{
 const long='很长的名字'.repeat(15);
 const labels=labelRecent([entry(`C:\\x\\${long}.md`),entry(`C:\\x\\${long}.txt`)]);
 assert.ok(labels[0].shortTitle.endsWith('.md'));
 assert.ok(labels[1].shortTitle.endsWith('.txt'));
 assert.ok([...labels[0].shortTitle].length<=36+4);
});
test('same name in different folders still uses the parent chain only',()=>{
 const labels=labelRecent([entry('C:\\x\\项目一\\计划\\todo.md'),entry('C:\\x\\项目二\\计划\\todo.md')]);
 assert.deepEqual(labels.map(label=>label.title),['todo','todo']);
});

const at=(y,m,d,h=12,mi=0)=>new Date(y,m-1,d,h,mi,0).getTime();
test('relative time follows calendar days, months and years',()=>{
 const now=at(2026,10,18,15,0);
 assert.equal(relativeTime(now-30_000,now),'刚刚');
 assert.equal(relativeTime(now-5*60_000,now),'5 分钟前');
 assert.equal(relativeTime(at(2026,10,18,9,0),now),'6 小时前');
 assert.equal(relativeTime(at(2026,10,17,23,30),now),'昨天');
 assert.equal(relativeTime(at(2026,10,17,1,0),now),'昨天');
 assert.equal(relativeTime(at(2026,10,15,8,0),now),'3 天前');
 assert.equal(relativeTime(at(2026,10,12,8,0),now),'6 天前');
 assert.equal(relativeTime(at(2026,10,10,8,0),now),'10月10日');
 assert.equal(relativeTime(at(2026,2,3,8,0),now),'2月3日');
 assert.equal(relativeTime(at(2025,12,31,8,0),now),'2025年12月31日');
 assert.equal(relativeTime(now+9999,now),'刚刚');
});
test('relative time crosses midnight, month and year boundaries',()=>{
 assert.equal(relativeTime(at(2026,9,30,22,0),at(2026,10,1,8,0)),'昨天');
 assert.equal(relativeTime(at(2025,12,31,23,50),at(2026,1,1,0,10)),'20 分钟前');
 assert.equal(relativeTime(at(2025,12,30,10,0),at(2026,1,1,10,0)),'2 天前');
 assert.equal(relativeTime(at(2025,12,20,10,0),at(2026,1,1,10,0)),'2025年12月20日');
 const stamp=at(2026,10,18,9,0);
 assert.notEqual(relativeTime(stamp,stamp+10_000),relativeTime(stamp,stamp+3*3_600_000));
});
test('a path whose file system never answers reports as inaccessible instead of waiting forever',async()=>{
 const started=Date.now();
 const status=await recentStatus('\\\\unreachable-server\\share\\a.md',50,()=>new Promise(()=>{}));
 assert.equal(status,'denied');
 assert.ok(Date.now()-started<2000);
 assert.equal(await recentStatus('\\\\x\\y.md',1000,()=>Promise.resolve({isFile:()=>true})),'ok');
});