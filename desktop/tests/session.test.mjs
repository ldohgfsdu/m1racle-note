import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,readdir,rm,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileSession} from '../session.mjs';
const sha256=value=>createHash('sha256').update(value).digest('hex');
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'m1racle-windows-'));
  try {await run(dir,join(dir,'笔记.md'));}finally{await rm(dir,{recursive:true,force:true});}
}
test('no edit save preserves BOM, mixed EOL bytes and file timestamp',()=>fixture(async(dir,path)=>{
  const bytes=Buffer.from('\ufeff# 标题\r\nline\n尾部\r');await writeFile(path,bytes);
  const session=new FileSession();const doc=await session.load(path);const before=await stat(path);
  assert.equal(doc.raw,'# 标题\r\nline\n尾部\r');await session.save(doc.raw);
  assert.deepEqual(await readFile(path),bytes);assert.equal((await stat(path)).mtimeMs,before.mtimeMs);
  await session.save(doc.raw.replace('line','edited'));
  assert.deepEqual(await readFile(path),Buffer.from('\ufeff# 标题\r\nedited\n尾部\r'));
  assert.deepEqual(await readdir(dir),['笔记.md']);
}));
test('external changes block replacement and remain intact',()=>fixture(async(dir,path)=>{
  await writeFile(path,'original');const session=new FileSession();await session.load(path);
  await writeFile(path,'external');await assert.rejects(session.save('mine'),/其他程序修改/);
  assert.equal(await readFile(path,'utf8'),'external');
  await session.save('mine',join(dir,'copy.md'));assert.equal(await readFile(join(dir,'copy.md'),'utf8'),'mine');
}));
test('invalid UTF-8 is rejected without replacing current session',()=>fixture(async(dir,path)=>{
  await writeFile(path,'valid');const session=new FileSession();await session.load(path);
  const invalid=join(dir,'invalid.md');await writeFile(invalid,Buffer.from([255,254,65,0]));
  await assert.rejects(session.load(invalid));assert.equal(session.path,path);assert.equal(session.raw,'valid');
}));
test('failed destination surfaces error and retains source state',()=>fixture(async(dir,path)=>{
  await writeFile(path,'source');const session=new FileSession();await session.load(path);
  await assert.rejects(session.save('edit',join(dir,'missing','copy.md')));
  assert.equal(session.raw,'source');assert.equal(await readFile(path,'utf8'),'source');
}));

async function afterTemporaryFlush(t,path,change) {
  const probe=await open(path,'r'),prototype=Object.getPrototypeOf(probe),sync=prototype.sync;
  await probe.close();
  t.mock.method(prototype,'sync',async function(...args){await sync.apply(this,args);await change();});
}

test('save-as still permits an approved unchanged destination and retains BOM',()=>fixture(async(dir,path)=>{
  await writeFile(path,'\ufeffsource\r\n');const copy=join(dir,'copy.md');await writeFile(copy,'replace this');
  const session=new FileSession();await session.load(path);
  await session.save('mine\r\n',copy,true);
  assert.equal(await readFile(copy,'utf8'),'\ufeffmine\r\n');
  assert.equal(await readFile(path,'utf8'),'\ufeffsource\r\n');
  assert.equal(session.path,copy);assert.equal(session.raw,'mine\r\n');
}));

test('save-as refuses a target changed while the temporary file was flushed',t=>fixture(async(dir,path)=>{
  await writeFile(path,'source');const copy=join(dir,'copy.md');await writeFile(copy,'approved copy');
  const session=new FileSession();await session.load(path);
  await afterTemporaryFlush(t,path,()=>writeFile(copy,'external edit'));
  await assert.rejects(session.save('mine',copy,true),/外部|其他程序/);
  assert.equal(await readFile(copy,'utf8'),'external edit');
  assert.equal(session.path,path);assert.equal(session.raw,'source');
  assert.deepEqual((await readdir(dir)).sort(),['copy.md','笔记.md'].sort());
}));

for(const overwrite of [false,true])test(`save-as preserves a new external file created during flush (overwrite=${overwrite})`,t=>fixture(async(dir,path)=>{
  await writeFile(path,'source');const copy=join(dir,'copy.md');
  const session=new FileSession();await session.load(path);
  await afterTemporaryFlush(t,path,()=>writeFile(copy,'external new file'));
  await assert.rejects(session.save('mine',copy,overwrite),/外部|已存在|其他程序/);
  assert.equal(await readFile(copy,'utf8'),'external new file');
  assert.equal(session.path,path);assert.equal(session.raw,'source');
  assert.deepEqual((await readdir(dir)).sort(),['copy.md','笔记.md'].sort());
}));

test('normal save also preserves changes made during temporary-file flush',t=>fixture(async(dir,path)=>{
  await writeFile(path,'source');const session=new FileSession();await session.load(path);
  await afterTemporaryFlush(t,path,()=>writeFile(path,'external edit'));
  await assert.rejects(session.save('mine'),/外部|其他程序/);
  assert.equal(await readFile(path,'utf8'),'external edit');assert.equal(session.raw,'source');
  assert.deepEqual(await readdir(dir),['笔记.md']);
}));

test('load and successful save track the baseline hash of seen bytes',()=>fixture(async(dir,path)=>{
  const bytes=Buffer.from('base A');await writeFile(path,bytes);
  const session=new FileSession();
  assert.equal(session.baseHash,null);assert.equal(session.externalChange,false);
  await session.load(path);
  assert.equal(session.baseHash,sha256(bytes));assert.equal(session.externalChange,false);
  await session.save('edited B');
  assert.equal(session.baseHash,sha256(Buffer.from('edited B')));assert.equal(session.externalChange,false);
  await writeFile(path,'external C');
  await assert.rejects(session.save('mine'),/其他程序修改/);
  assert.equal(session.baseHash,sha256(Buffer.from('edited B')));
}));

test('recovered baseline mismatch refuses in-place save and clears via save-as',()=>fixture(async(dir,path)=>{
  const base=Buffer.from('base A');await writeFile(path,base);
  const session=new FileSession();await session.load(path);
  const baseline=session.baseHash;
  await writeFile(path,'external C');
  await session.load(path);
  // recover-open semantics: the disk state differs from the snapshot's base.
  session.externalChange=true;session.baseHash=baseline;
  await assert.rejects(session.save('draft B'),/其他程序修改/);
  assert.equal(await readFile(path,'utf8'),'external C');
  assert.equal(session.externalChange,true);
  await session.save('draft B',join(dir,'rescued.md'));
  assert.equal(await readFile(join(dir,'rescued.md'),'utf8'),'draft B');
  assert.equal(await readFile(path,'utf8'),'external C');
  assert.equal(session.externalChange,false);
  assert.equal(session.baseHash,sha256(Buffer.from('draft B')));
}));
