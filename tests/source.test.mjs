import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SourceDocument } from '../editor/src/source.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
for (const name of await readdir('editor-corpus')) {
 if (!name.endsWith('.md')) continue;
 test(`${name}: no edit hash, one edit minimal bytes, undo`, async () => {
  const bytes = await readFile(`editor-corpus/${name}`);
  const raw = bytes.toString('utf8'), doc = new SourceDocument(raw);
  assert.equal(hash(Buffer.from(doc.raw)), hash(bytes));
  const normalized = doc.normalized();
  const pos = Math.min(3, normalized.length);
  const offset = doc.offset(pos);
  doc.apply([{ from:pos, to:pos, insert:'测试🌱' }]);
  assert.equal(doc.raw, raw.slice(0,offset)+'测试🌱'+raw.slice(offset));
  doc.apply([{ from:pos, to:pos+4, insert:'' }]);
  assert.equal(doc.raw, raw);
 });
}
test('multiple edits map against the old mixed EOL document', () => {
 const doc = new SourceDocument('a\r\nb\nc\rd');
 doc.apply([{from:0,to:1,insert:'A'},{from:4,to:5,insert:'C'}]);
 assert.equal(doc.raw,'A\r\nb\nC\rd');
});

test('indexed positions agree with raw UTF-16 boundaries through mixed endings and edits', () => {
 let seed=71;
 const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
 const atoms=['中','a','🌱','\r\n','\r','\n','\t',' '];
 const offsets=raw=>{
  const result=[0];
  for(let at=0;at<raw.length;){at+=raw[at]==='\r' && raw[at+1]==='\n'?2:1;result.push(at);}
  return result;
 };
 for(let sample=0;sample<100;sample++) {
  let expected='\ufeff'+Array.from({length:60},()=>atoms[random(atoms.length)]).join('');
  const doc=new SourceDocument(expected),eol=doc.eol;
  for(let edit=0;edit<15;edit++) {
   const map=offsets(expected);
   assert.deepEqual(Array.from({length:map.length},(_,position)=>doc.offset(position)),map);
   const from=random(map.length),to=from+random(map.length-from);
   const insert=atoms[random(atoms.length)]+atoms[random(atoms.length)];
   const prefix=expected.slice(0,map[from]),suffix=expected.slice(map[to]),normalized=doc.normalized();
   const logical=normalized.slice(0,from)+insert.replace(/\r\n|\r|\n/g,'\n')+normalized.slice(to);
   doc.apply([{from,to,insert}]);
   assert.equal(doc.normalized(),logical);assert.ok(doc.raw.startsWith(prefix));assert.ok(doc.raw.endsWith(suffix));
   expected=doc.raw;
  }
 }
});

test('deleting between lone CR and LF keeps both logical newlines in the edited range',()=>{
 const doc=new SourceDocument('a\rb\nc');doc.apply([{from:2,to:3,insert:''}]);
 assert.equal(doc.normalized(),'a\n\nc');assert.equal(doc.raw,'a\r\r\nc');
});

test('replacing raw after undo invalidates the index without changing the insertion ending', () => {
 const doc=new SourceDocument('a\r\nb\r\nc');
 assert.equal(doc.offset(4),6);
 doc.raw='a\nb\nc';
 assert.equal(doc.offset(4),4);
 doc.raw='a\r\nb\nc';
 assert.equal(doc.offset(4),5);
 assert.equal(doc.apply([{from:4,to:4,insert:'\n'}]),'a\r\nb\n\r\nc');
 for(const position of [-1,100,1.5,NaN])assert.throws(()=>doc.offset(position),RangeError);
});

test('many changes near the end preserve every other mixed-EOL byte', () => {
 const raw=('甲\r\n乙\n丙\r🌱\n').repeat(5000),doc=new SourceDocument(raw),text=doc.normalized();
 const changes=Array.from({length:100},(_,i)=>({from:text.length-500+i*4,to:text.length-500+i*4,insert:'测'}));
 let expected=raw;
 const positions=changes.map(change=>doc.offset(change.from));
 for(const position of positions.reverse())expected=expected.slice(0,position)+'测'+expected.slice(position);
 assert.equal(doc.apply(changes),expected);
});
