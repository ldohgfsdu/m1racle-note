import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {SourceDocument} from '../editor/src/source.mjs';
import {explicitLinkAt,linkEditPlan,webDestination} from '../editor/src/link-editing.mjs';
const fixture=raw=>{const source=new SourceDocument(raw),doc=source.normalized(),at=doc.indexOf('项目')+1,state=EditorState.create({doc,selection:{anchor:at},extensions:[markdown()]});return {source,state,link:explicitLinkAt(state)};};

test('URL-only changes preserve label formatting, title, angle brackets, BOM and mixed EOL bytes',()=>{
 const raw='\ufeff前文\r\n\r\n[**项目**](<https://example.com/old>  \'原说明\')\r后文\n',f=fixture(raw);
 assert.equal(f.link.kind,'inline');assert.equal(f.link.editableLabel,false);const plan=linkEditPlan(f.state,f.link,{label:f.link.label,target:'https://example.com/new(a)'});
 assert.equal(plan.changes.length,1);assert.equal(f.source.apply(plan.changes),raw.replace('/old','/new%28a%29'));
});
test('plain and escaped labels can change without rebuilding any surrounding link syntax',()=>{
 const raw='[项目 \\[A\\]](https://example.com  "标题")',f=fixture(raw);assert.equal(f.link.label,'项目 [A]');assert.equal(f.link.editableLabel,true);
 const p=linkEditPlan(f.state,f.link,{label:'新项目 [B]🌱',target:f.link.target});assert.equal(f.source.apply(p.changes),'[新项目 \\[B\\]🌱](https://example.com  "标题")');
});
test('unchanged values create no edits and unsupported references retain source',()=>{
 const f=fixture('[项目](https://example.com "说明")');assert.deepEqual(linkEditPlan(f.state,f.link,{label:f.link.label,target:f.link.target}).changes,[]);
 assert.equal(fixture('[项目][ref]\n\n[ref]: https://example.com').link.kind,'source');
 const mixed=EditorState.create({doc:'前文 [项目](https://example.com) 后文',selection:{anchor:0,head:30},extensions:[markdown()]});assert.equal(explicitLinkAt(mixed).kind,'source');
});
test('invalid destinations, multiline captions, formatted caption replacements and stale documents fail without edits',()=>{
 for(const value of ['javascript:alert(1)','https://example.com/\nnext','https://example.com/\u0085next'])assert.throws(()=>webDestination(value));
 const f=fixture('[项目](https://example.com)');assert.throws(()=>linkEditPlan(f.state,f.link,{label:'一\n二',target:f.link.target}));
 assert.throws(()=>linkEditPlan(f.state.update({changes:{from:0,insert:'变更'}}).state,f.link,{label:'项目',target:'https://example.com'}));
 const styled=fixture('[**项目**](https://example.com)');assert.throws(()=>linkEditPlan(styled.state,styled.link,{label:'新项目',target:styled.link.target}));
});
