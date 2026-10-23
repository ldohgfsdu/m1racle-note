import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestedSaveName} from '../renderer/save-name.js';

test('new note uses its Markdown title with BOM and mixed line endings',()=>{
  const raw='\ufeff# 我的第一篇笔记\r\n\r\n正文。\n尾部\r';
  assert.equal(suggestedSaveName(raw),'我的第一篇笔记.md');
});

test('headings win over introductory text; code, quote and list headings are not titles',()=>{
  assert.equal(suggestedSaveName('引言\n\n```md\n# 代码\n```\n\n> # 引用\n\n- # 列表\n\n## 正文标题\n'),'正文标题.md');
  assert.equal(suggestedSaveName('```md\n# 代码\n```\n'),'未命名.md');
});

test('title text removes Markdown decorations and link destinations',()=>{
  assert.equal(suggestedSaveName('# **我的** [笔记](https://example.com "地址") `代码` ~~旧~~ ###'),'我的 笔记 代码 旧.md');
  assert.equal(suggestedSaveName('# [名称][id]\n\n[id]: https://example.com'),'名称.md');
});

test('Setext and lower-level headings are accepted; plain text uses only its first line',()=>{
  assert.equal(suggestedSaveName('标题\r\n===\r\n\r\n正文'),'标题.md');
  assert.equal(suggestedSaveName('###### 六级标题'),'六级标题.md');
  assert.equal(suggestedSaveName('\n第一行\n第二行'),'第一行.md');
  assert.equal(suggestedSaveName(' \r\n\t'),'未命名.md');
});

test('Windows-invalid characters, device names and extension are safe suggestions',()=>{
  assert.equal(suggestedSaveName('# 标题：A/B:C?D|E<>"F'),'标题：A B C D E F.md');
  assert.equal(suggestedSaveName('# CON'),'_CON.md');
  for(const [name,expected] of [['CON .md','_CON.md'],['NUL .md','_NUL.md'],['LPT1 .md','_LPT1.md'],['CON..md','_CON.md']]) {
    assert.equal(suggestedSaveName('# '+name),expected);
  }
  assert.equal(suggestedSaveName('# LPT1.txt'),'_LPT1.txt.md');
  assert.equal(suggestedSaveName('# 文档.md'),'文档.md');
  assert.equal(suggestedSaveName('# ...'),'未命名.md');
});

test('long Unicode titles fit the existing validation without splitting a surrogate pair',()=>{
  const name=suggestedSaveName('# '+('字'.repeat(115))+'😄尾部');
  assert.ok(name.length<=120);
  assert.equal(name,'字'.repeat(115)+'.md');
  assert.ok(suggestedSaveName('# '+('😄'.repeat(100))).isWellFormed());
});
