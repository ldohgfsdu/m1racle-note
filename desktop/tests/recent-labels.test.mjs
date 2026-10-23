import {test} from 'node:test';
import assert from 'node:assert/strict';
import {labelRecent,middleTruncate,titleOf,relativeTime,TITLE_MAX} from '../recent-labels.mjs';

const entry=path=>{const parts=path.split('\\');const name=parts.pop();return {path,name,dir:parts.join('\\'),accessedAt:1};};

test('primary line drops the extension and keeps dotted names intact',()=>{
 assert.equal(titleOf('随笔.md'),'随笔');
 assert.equal(titleOf('v1.2.notes.markdown'),'v1.2.notes');
 assert.equal(titleOf('.hidden'),'.hidden');
 assert.equal(titleOf('noext'),'noext');
});

test('secondary line is parent / grandparent by default',()=>{
 const [label]=labelRecent([entry('C:\\文档\\随笔\\日记\\今天.md')]);
 assert.equal(label.title,'今天');
 assert.equal(label.hint,'日记 / 随笔');
 assert.equal(label.full,'C:\\文档\\随笔\\日记\\今天.md');
});

test('shallow paths show the levels that exist',()=>{
 assert.equal(labelRecent([entry('C:\\a.md')])[0].hint,'C:');
 assert.equal(labelRecent([entry('C:\\笔记\\a.md')])[0].hint,'笔记 / C:');
});

test('same title is told apart by the two default levels without climbing',()=>{
 const labels=labelRecent([entry('C:\\x\\项目一\\计划\\todo.md'),entry('C:\\x\\项目二\\计划\\todo.md')]);
 assert.deepEqual(labels.map(label=>label.hint),['计划 / 项目一','计划 / 项目二']);
});

test('only still-indistinguishable items climb, one level at a time',()=>{
 const labels=labelRecent([
  entry('C:\\a\\工作\\计划\\todo.md'),
  entry('C:\\b\\工作\\计划\\todo.md'),
  entry('C:\\a\\其他\\notes.md'),
 ]);
 assert.equal(labels[0].hint,'计划 / 工作 / a');
 assert.equal(labels[1].hint,'计划 / 工作 / b');
 assert.equal(labels[2].hint,'其他 / a');
});

test('climbing continues until distinguishable and compares case-insensitively',()=>{
 const labels=labelRecent([
  entry('C:\\p\\q\\r\\s\\deep.md'),
  entry('C:\\P\\Q\\R\\S\\DEEP.md'),
  entry('D:\\p\\q\\r\\s\\deep.md'),
 ]);
 assert.deepEqual(labels.map(label=>label.hint),['s / r / q / p / C:','S / R / Q / P / C:','s / r / q / p / D:']);
});

test('items that cannot be told apart stop climbing at the path root and never loop',()=>{
 const labels=labelRecent([entry('C:\\n\\same.md'),entry('C:\\n\\same.txt')]);
 assert.equal(labels[0].hint,'n / C:');
 assert.equal(labels[1].hint,'n / C:');
});

test('labelRecent does not mutate its input',()=>{
 const input=[entry('C:\\a\\b\\c.md')];
 const copy=JSON.stringify(input);
 labelRecent(input);
 assert.equal(JSON.stringify(input),copy);
});

test('compact sidebar labels show the parent without exposing the profile name',()=>{
 const [label]=labelRecent([entry('C:\\Users\\ExampleUser\\Downloads\\随笔.md')],{levels:1,rootFirst:true});
 assert.equal(label.hint,'Downloads');
 assert.equal(label.title,'随笔');
});

test('compact sidebar labels expand duplicate parents in directory order',()=>{
 const labels=labelRecent([entry('C:\\写作\\项目甲\\草稿\\计划.md'),entry('C:\\写作\\项目乙\\草稿\\计划.md')],{levels:1,rootFirst:true});
 assert.deepEqual(labels.map(label=>label.hint),['项目甲 / 草稿','项目乙 / 草稿']);
 assert.ok(labels.every(label=>label.full.endsWith('计划.md')));
});

test('long titles truncate from the middle and short ones stay whole',()=>{
 assert.equal(middleTruncate('短标题'),'短标题');
 const long='开头'.repeat(20)+'结尾'.repeat(20);
 const cut=middleTruncate(long);
 assert.equal([...cut].length,TITLE_MAX);
 assert.ok(cut.startsWith('开头开头'));
 assert.ok(cut.endsWith('结尾结尾'));
 assert.ok(cut.includes('…'));
 const label=labelRecent([entry('C:\\a\\'+long+'.md')])[0];
 assert.equal(label.title,long);
 assert.equal(label.shortTitle,cut);
});

test('relative time is coarse and deterministic',()=>{
 const now=Date.UTC(2026,9,18,12,0,0);
 assert.equal(relativeTime(now-5_000,now),'刚刚');
 assert.equal(relativeTime(now-5*60_000,now),'5 分钟前');
 assert.equal(relativeTime(now-3*3_600_000,now),'3 小时前');
 assert.equal(relativeTime(now-30*3_600_000,now),'昨天');
 assert.equal(relativeTime(now-5*86_400_000,now),'5 天前');
 assert.match(relativeTime(now-90*86_400_000,now),/^(\d{4}年)?\d{1,2}月\d{1,2}日$/);
 assert.equal(relativeTime(now+9999,now),'刚刚');
});
