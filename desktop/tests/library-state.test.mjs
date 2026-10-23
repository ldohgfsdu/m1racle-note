import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {emptyLibrary, LIBRARY_GROUP_LIMIT, LIBRARY_ITEM_LIMIT, readLibrary, updateLibrary,pathKey} from '../library-state.mjs';

const fresh = () => mkdtemp(join(tmpdir(), 'note-library-state-'));
const libraryFile = directory => join(directory, 'library.json');
const paths = record => record.items.map(item => item.path.toLowerCase());
const validRecord = overrides => ({version: 1, collapsed: false, groups: [], items: [], ...overrides});

async function lockMetadata(path,milliseconds){
 const script="$libraryHandle=[System.IO.File]::Open($env:NOTE_LIBRARY_LOCK_PATH,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite); try {[Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [System.Threading.Thread]::Sleep([int]$env:NOTE_LIBRARY_LOCK_MS)} finally {$libraryHandle.Dispose()}";
 const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,NOTE_LIBRARY_LOCK_PATH:path,NOTE_LIBRARY_LOCK_MS:String(milliseconds)},stdio:['ignore','pipe','pipe']});
 const ended=once(child,'close');let output='',errors='';child.stderr.on('data',chunk=>{errors+=chunk;});
 await new Promise((done,reject)=>{
  const ready=chunk=>{output+=chunk;if(output.includes('LOCKED')){child.stdout.off('data',ready);done();}};
  child.stdout.on('data',ready);child.once('error',reject);child.once('close',code=>{if(!output.includes('LOCKED'))reject(new Error(`Metadata lock failed (${code}): ${errors}`));});
 });
 return {ended};
}

test('missing library reads as an empty record and remembers paths in place', async () => {
 const directory = await fresh();
 const empty = await readLibrary(directory);
 assert.deepEqual(empty, emptyLibrary());
 const alpha = join(directory, 'alpha.md');
 const beta = join(directory, 'beta.md');
 assert.deepEqual(await updateLibrary(directory, {type: 'remember', path: alpha}), {
  version: 1,
  collapsed: false,
  groups: [],
  items: [{path: alpha, groupId: null, pinned: false, fixed: false}],
 });
 await updateLibrary(directory, {type: 'remember', path: beta});
 const before = await readFile(libraryFile(directory), 'utf8');
 await updateLibrary(directory, {type: 'remember', path: alpha.toUpperCase()});
 assert.equal(await readFile(libraryFile(directory), 'utf8'), before);
 assert.deepEqual(paths(await readLibrary(directory)), [alpha.toLowerCase(), beta.toLowerCase()]);
 assert.deepEqual((await readdir(directory)).filter(name => name.startsWith('.library-')), []);
});

test('groups support CRUD, collapse, reassignment and item removal', async () => {
 const directory = await fresh();
 const alpha = join(directory, 'alpha.md');
 const beta = join(directory, 'beta.md');
 let record = await updateLibrary(directory, {type: 'remember', path: alpha});
 record = await updateLibrary(directory, {type: 'group-add', name: '  写作  '});
 const groupId = record.groups[0].id;
 assert.match(groupId, /^[0-9a-f-]{36}$/i);
 assert.equal(record.groups[0].name, '写作');
 record = await updateLibrary(directory, {type: 'group-rename', id: groupId, name: '  项目  '});
 assert.equal(record.groups[0].name, '项目');
 record = await updateLibrary(directory, {type: 'group-collapse', id: groupId, collapsed: true});
 assert.equal(record.groups[0].collapsed, true);
 assert.equal((await readLibrary(directory)).groups[0].collapsed, true);
 record = await updateLibrary(directory, {type: 'item-update', path: alpha, groupId, pinned: true, fixed: true});
 assert.deepEqual(record.items[0], {path: alpha, groupId, pinned: true, fixed: true});
 record = await updateLibrary(directory, {type: 'item-update', path: beta.toUpperCase(), groupId, pinned: false, fixed: true});
 assert.deepEqual(record.items[1], {path: resolve(beta.toUpperCase()), groupId, pinned: false, fixed: true});
 record = await updateLibrary(directory, {type: 'group-remove', id: groupId});
 assert.equal(record.groups.length, 0);
 assert.ok(record.items.every(item => item.groupId === null));
 record = await updateLibrary(directory, {type: 'collapse', collapsed: true});
 assert.equal(record.collapsed, true);
 assert.equal((await readLibrary(directory)).collapsed, true);
 record = await updateLibrary(directory, {type: 'item-remove', path: alpha});
 assert.deepEqual(paths(record), [beta.toLowerCase()]);
});

test('case-insensitive concurrent updates merge and a rejected task does not break the queue', async () => {
 const directory = await fresh();
 const files = Array.from({length: 12}, (_, index) => join(directory, `Doc-${index}.md`));
 await Promise.all(files.flatMap((path, index) => [
  updateLibrary(directory, {type: 'remember', path}),
  updateLibrary(directory, {type: 'item-update', path: path.toUpperCase(), pinned: index % 2 === 0, fixed: false}),
 ]));
 await assert.rejects(updateLibrary(directory, {type: 'group-remove', id: 'missing'}), /分组不存在/);
 await updateLibrary(directory, {type: 'collapse', collapsed: true});
 const record = await readLibrary(directory);
 assert.equal(record.items.length, files.length);
 assert.equal(record.items.filter(item => item.pinned).length, files.length / 2);
 assert.equal(new Set(paths(record)).size, files.length);
 assert.equal(record.collapsed, true);
 assert.deepEqual((await readdir(directory)).filter(name => name.startsWith('.library-')), []);
});

test('group creation and rename reject equivalent names while concurrent creation keeps one group', async () => {
 const directory = await fresh();
 const requests = await Promise.allSettled(Array.from({length: 4}, () => updateLibrary(directory, {type: 'group-add', name: '  写作  '})));
 assert.equal(requests.filter(result => result.status === 'fulfilled').length, 1);
 assert.ok(requests.filter(result => result.status === 'rejected').every(result => /同名分组/.test(result.reason.message)));
 const first = (await readLibrary(directory)).groups[0];
 let record = await updateLibrary(directory, {type: 'group-add', name: 'Project A'});
 const project = record.groups[1];
 for (const name of ['project a', '  Project A  ', 'Ｐｒｏｊｅｃｔ Ａ']) {
  const before = await readFile(libraryFile(directory));
  await assert.rejects(updateLibrary(directory, {type: 'group-add', name}), /同名分组/);
  await assert.rejects(updateLibrary(directory, {type: 'group-rename', id: first.id, name}), /同名分组/);
  assert.deepEqual(await readFile(libraryFile(directory)), before);
 }
 record = await updateLibrary(directory, {type: 'group-rename', id: project.id, name: 'project a'});
 assert.equal(record.groups[1].name, 'project a', 'A group can change the case of its own name');
 assert.equal(record.groups.length, 2);
});

test('legacy duplicate names remain readable and can be resolved without dropping entries', async () => {
 const directory = await fresh(), path = join(directory, 'kept.md');
 const original = validRecord({groups: [{id:'a',name:'写作',collapsed:false},{id:'b',name:'写作',collapsed:true}],items:[{path,groupId:'b',pinned:true,fixed:false}]});
 await writeFile(libraryFile(directory), JSON.stringify(original));
 assert.deepEqual(await readLibrary(directory), original);
 assert.deepEqual(await updateLibrary(directory,{type:'group-rename',id:'a',name:' 写作 '}), original);
 await assert.rejects(updateLibrary(directory,{type:'group-add',name:'写作'}), /同名分组/);
 const record = await updateLibrary(directory,{type:'group-rename',id:'b',name:'阅读'});
 assert.deepEqual(record.items, original.items);
 assert.equal(record.groups.length, 2);
 assert.equal(record.groups[1].name, '阅读');
});

test('invalid actions and records are rejected without silently dropping flags', async () => {
 const directory = await fresh();
 for (const action of [
  null,
  {type: 'unknown'},
  {type: 'remember', path: ''},
  {type: 'collapse', collapsed: 'yes'},
  {type: 'group-add', name: '   '},
  {type: 'group-add', name: 'x'.repeat(61)},
  {type: 'item-update', path: join(directory, 'a.md')},
  {type: 'item-update', path: join(directory, 'a.md'), content: 'not allowed'},
  {type: 'item-update', path: join(directory, 'a.md'), groupId: 'missing'},
  {type: 'item-update', path: join(directory, 'a.md'), pinned: 'yes'},
 ]) await assert.rejects(updateLibrary(directory, action));
 assert.deepEqual(await readLibrary(directory), emptyLibrary());
 await updateLibrary(directory, {type: 'remember', path: join(directory, 'a.md')});
 await updateLibrary(directory, {type: 'item-update', path: join(directory, 'a.md'), pinned: true, fixed: true});
 const record = await readLibrary(directory);
 assert.equal(record.items[0].pinned, true);
 assert.equal(record.items[0].fixed, true);
 const groupActions = Array.from({length: LIBRARY_GROUP_LIMIT}, (_, index) => updateLibrary(directory, {type: 'group-add', name: `g${index}`}));
 await Promise.all(groupActions);
 await assert.rejects(updateLibrary(directory, {type: 'group-add', name: 'overflow'}), /100/);
 assert.equal((await readLibrary(directory)).groups.length, LIBRARY_GROUP_LIMIT);
});

test('corrupt JSON and IO failures surface and preserve the original file', async () => {
 const directory = await fresh();
 const corrupt = '{"version":1,"collapsed":false,"groups":[],"items":[';
 await writeFile(libraryFile(directory), corrupt);
 await assert.rejects(readLibrary(directory), /有效 JSON/);
 await assert.rejects(updateLibrary(directory, {type: 'collapse', collapsed: true}), /有效 JSON/);
 assert.equal(await readFile(libraryFile(directory), 'utf8'), corrupt);
 await writeFile(libraryFile(directory), '{}\r\n');
 await assert.rejects(updateLibrary(directory, {type: 'remember', path: join(directory, 'a.md')}), /记录无效/);
 assert.equal(await readFile(libraryFile(directory), 'utf8'), '{}\r\n');
 await writeFile(libraryFile(directory), JSON.stringify(validRecord({
  items: [{path: 'relative.md', groupId: null, pinned: true, fixed: true}],
 })));
 await assert.rejects(readLibrary(directory), /记录无效/);
 assert.equal(JSON.parse(await readFile(libraryFile(directory), 'utf8')).items[0].pinned, true);
 const withBody = JSON.stringify(validRecord({
  items: [{path: join(directory, 'private.md'), groupId: null, pinned: false, fixed: false, content: 'SECRET-BODY'}],
 }));
 await writeFile(libraryFile(directory), withBody);
 await assert.rejects(readLibrary(directory), /记录无效/);
 assert.equal(await readFile(libraryFile(directory), 'utf8'), withBody);
 const missingDirectory = join(directory, 'missing');
 await assert.rejects(updateLibrary(missingDirectory, {type: 'collapse', collapsed: true}), /无法(?:读取|写入)库元数据/);
});

test('the item cap rejects new paths without truncating pinned or fixed entries', async () => {
 const directory = await fresh();
 const items = Array.from({length: LIBRARY_ITEM_LIMIT}, (_, index) => ({
  path: join(directory, `doc-${index}.md`),
  groupId: null,
  pinned: index < 3,
  fixed: index >= 3 && index < 6,
 }));
 await writeFile(libraryFile(directory), JSON.stringify(validRecord({items})));
 await assert.rejects(updateLibrary(directory, {type: 'remember', path: join(directory, 'overflow.md')}), /500/);
 await assert.rejects(updateLibrary(directory, {type: 'item-update', path: join(directory, 'overflow.md'), pinned: true}), /500/);
 const record = await readLibrary(directory);
 assert.equal(record.items.length, LIBRARY_ITEM_LIMIT);
 assert.equal(record.items.slice(0, 3).every(item => item.pinned), true);
 assert.equal(record.items.slice(3, 6).every(item => item.fixed), true);
});

test('metadata writes never change Markdown content bytes', async () => {
 const directory = await fresh();
 const markdown = join(directory, 'preserve.md');
 const body = Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0xe6, 0xad, 0xa3, 0x0d, 0x0a, 0x0a, 0x62, 0x0a]);
 await writeFile(markdown, body);
 await updateLibrary(directory, {type: 'remember', path: markdown});
 await updateLibrary(directory, {type: 'item-update', path: markdown, pinned: true, fixed: true});
 await updateLibrary(directory, {type: 'remember', path: markdown});
 const grouped = await updateLibrary(directory, {type: 'group-add', name: '临时分组'});
 const groupId = grouped.groups[0].id;
 await updateLibrary(directory, {type: 'item-update', path: markdown, groupId});
 await updateLibrary(directory, {type: 'group-remove', id: groupId});
 await updateLibrary(directory, {type: 'item-remove', path: markdown});
 assert.deepEqual(await readFile(markdown), body);
});

test('Windows transient read locks retry the flushed atomic metadata replacement', {skip:process.platform!=='win32',timeout:15000}, async()=>{
 const directory=await fresh();
 await updateLibrary(directory,{type:'group-add',name:'原分组'});
 const {ended:unlocked}=await lockMetadata(libraryFile(directory),140);
 try {
  const record=await updateLibrary(directory,{type:'group-add',name:'新的分组'});
  assert.deepEqual(record.groups.map(group=>group.name),['原分组','新的分组']);
 }finally{assert.deepEqual(await unlocked,[0,null]);}
 assert.deepEqual((await readdir(directory)).filter(name=>name.startsWith('.library-')),[]);
});

test('Windows persistent metadata locks surface failure and leave the original record intact', {skip:process.platform!=='win32',timeout:15000}, async()=>{
 const directory=await fresh();
 await updateLibrary(directory,{type:'group-add',name:'保留原分组'});
 const original=await readFile(libraryFile(directory));
 const {ended:unlocked}=await lockMetadata(libraryFile(directory),800);
 try {
  await assert.rejects(updateLibrary(directory,{type:'group-add',name:'不能写入'}),/无法写入库元数据/);
  assert.deepEqual(await readFile(libraryFile(directory)),original);
  assert.deepEqual((await readdir(directory)).filter(name=>name.startsWith('.library-')),[]);
 }finally{assert.deepEqual(await unlocked,[0,null]);}
 assert.equal((await updateLibrary(directory,{type:'group-add',name:'解锁后可继续'})).groups.length,2);
});

test('removal wins over an older queued remember; a later explicit open restores the entry', async () => {
 const directory=await fresh(),path=join(directory,'Alpha.md');
 await updateLibrary(directory,{type:'remember',path},100);
 await updateLibrary(directory,{type:'item-remove',path:path.toUpperCase()},200);
 let record=await updateLibrary(directory,{type:'remember',path},150);
 assert.equal(record.items.length,0,'An older remember must not undo a removal');
 assert.deepEqual(record.removed,[{key:pathKey(path),removedAt:200}]);
 await assert.rejects(updateLibrary(directory,{type:'item-update',path,pinned:true}),/已移出/);
 record=await updateLibrary(directory,{type:'remember',path,openedAt:201},300);
 assert.equal(record.items.length,1);
 assert.equal(record.removed,undefined);
});

test('removing a legacy recent-only path also records removal without opening its file', async () => {
 const directory=await fresh(),path=join(directory,'recent-only.md');
 const record=await updateLibrary(directory,{type:'item-remove',path},200);
 assert.deepEqual(record.removed,[{key:pathKey(path),removedAt:200}]);
 assert.equal((await updateLibrary(directory,{type:'remember',path,openedAt:100},300)).items.length,0);
 assert.deepEqual(await readdir(directory),['library.json']);
});

test('optional removal metadata is validated without dropping corrupt records', async () => {
 const directory=await fresh(),path=join(directory,'Alpha.md');
 const legacy=JSON.stringify(validRecord());
 await writeFile(libraryFile(directory),legacy);
 assert.deepEqual(await readLibrary(directory),validRecord());
 for(const removed of [[{key:pathKey(path),removedAt:-1}],[{key:pathKey(path),removedAt:200,content:'body'}],[{key:pathKey(path),removedAt:200},{key:pathKey(path),removedAt:201}]]){
  const bytes=JSON.stringify(validRecord({removed}));
  await writeFile(libraryFile(directory),bytes);
  await assert.rejects(readLibrary(directory),/记录无效/);
  assert.equal(await readFile(libraryFile(directory),'utf8'),bytes);
 }
});
