import test from 'node:test';
import assert from 'node:assert/strict';
import {insertion,validateLinkTarget} from '../renderer/formatting.js';

const link=target=>insertion('link',{label:'文字',target});
const NO_HOST='链接地址缺少主机名。';
const BAD_HOST='链接地址的主机名无效，不能包含空格。';

test('valid links still insert', () => {
  assert.equal(link('https://example.com').suffix,'](https://example.com)');
  assert.equal(link('http://example.com/path?q=1#frag').suffix,'](http://example.com/path?q=1#frag)');
  assert.equal(link('HTTPS://Example.COM').suffix,'](HTTPS://Example.COM)');
  assert.equal(link('https://user:pw@example.com:8080/x').suffix,'](https://user:pw@example.com:8080/x)');
  assert.doesNotThrow(()=>link('https://[::1]:8080/x'));// accepted; existing encodeLinkTarget escaping of [] is unchanged and out of scope
  assert.equal(link('https://例子.测试/路径').prefix,'[');
  assert.equal(link('  https://example.com  ').suffix,'](https://example.com)', 'surrounding whitespace is trimmed, as before');
  assert.equal(link('mailto:a@example.com').suffix,'](mailto:a@example.com)');
  assert.equal(link('#第二节').suffix,'](#第二节)');
});

test('legitimate percent-encoding and spaces in path/query/fragment are not rejected', () => {
  assert.equal(link('https://example.com/a%20b').suffix,'](https://example.com/a%20b)');
  assert.equal(link('https://example.com/a%09b%0Ac').suffix,'](https://example.com/a%09b%0Ac)');
  assert.equal(link('https://example.com/?q=a%20b#x%20y').suffix,'](https://example.com/?q=a%20b#x%20y)');
  assert.equal(link('https://example.com/a (b)').suffix,'](https://example.com/a%20%28b%29)');
  assert.equal(link('https://example.com/ path').suffix,'](https://example.com/%20path)');
});

const BAD_HOSTS={
  'https:// x':BAD_HOST,
  'http:// x':BAD_HOST,
  'https://%20x':BAD_HOST,
  'https://%20':BAD_HOST,
  'https://%09x':BAD_HOST,
  'https://%0ax':BAD_HOST,
  'https://%0Dx':BAD_HOST,
  'https://x%20.com':BAD_HOST,
  'https://exa mple.com':BAD_HOST,
  'https://exa%20mple.com/path':BAD_HOST,
  'https://exa\tmple.com':BAD_HOST,
  'https://\texample.com':BAD_HOST,
  'https://exa\nmple.com':BAD_HOST,
  'https://\nexample.com':BAD_HOST,
  'https://exa\rmple.com':BAD_HOST,
  'https://exa\u00a0mple.com':BAD_HOST,
  'https://exa\u3000mple.com':BAD_HOST,
  'https://user@ x.com':BAD_HOST,
  'https://a b@example.com':BAD_HOST,
  'https://example.com :80/':BAD_HOST,
  'https://%00x.com':BAD_HOST,
  'https://%7fx.com':BAD_HOST,
  'https://%E3%80%80x.com':BAD_HOST,
  'https:// /path':BAD_HOST,
};
for(const [input,message] of Object.entries(BAD_HOSTS)){
  test(`rejects invalid host ${JSON.stringify(input)}`, () => {
    assert.throws(()=>link(input),{message});
    assert.throws(()=>validateLinkTarget(input.trim()),{message});
  });
}

const NO_HOSTS=['https://','http://','https://   ','https:///path','https://?q=1','https://#frag','https://:80','https://:80/x','https://user@','https://user:pw@/x','https://\\x'];
for(const input of NO_HOSTS){
  test(`rejects missing host ${JSON.stringify(input)}`, () => {
    assert.throws(()=>link(input),{message:NO_HOST});
  });
}

test('malformed percent-encoding in host is rejected, not inserted', () => {
  assert.throws(()=>link('https://%zz.com'),/主机名无效/);
  assert.throws(()=>link('https://%.com'),/主机名无效/);
});

test('dangerous or unsupported schemes stay rejected', () => {
  for(const input of ['javascript:alert(1)','JavaScript:alert(1)','data:text/html,x','vbscript:msgbox(1)','file:///c:/x','ftp://example.com','//example.com','example.com','https:example.com',' javascript:alert(1)','java\nscript:alert(1)','\tjavascript:1'])
    assert.throws(()=>link(input),{message:'支持 https://、http://、mailto: 或 #标题 链接。'},input);
  assert.throws(()=>link(''),{message:'请输入链接地址。'});
  assert.throws(()=>link('   '),{message:'请输入链接地址。'});
});

test('invalid input never yields markdown (insertion throws before any text is produced)', () => {
  for(const input of [...Object.keys(BAD_HOSTS),...NO_HOSTS]){
    let result;try{result=link(input);}catch{result=null;}
    assert.equal(result,null,input);
  }
});

test('image insertion is unchanged by link validation', () => {
  assert.equal(insertion('image',{label:'图',target:'images/a b.png'}).suffix,'](images/a%20b.png)');
  assert.throws(()=>insertion('image',{target:'https://example.com/a.png'}));
  assert.throws(()=>insertion('image',{target:'../x.png'}));
});
