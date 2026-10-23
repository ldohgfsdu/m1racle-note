import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compareSignedPePayload} from '../scripts/windows-uninstaller-import.mjs';

// Structural fixtures only. These bytes are deliberately NOT a trusted signature.
const fakePkcs7=Buffer.from('NOT-A-TRUSTED-SIGNATURE');
const align8=n=>Math.ceil(n/8)*8;
function fixture({plus=false,overlayLength=3,directories=16}={}){
  const pe=0x80,optional=pe+24,size=plus?240:224,table=optional+size;
  const bytes=Buffer.alloc(1536+overlayLength);
  bytes.writeUInt16LE(0x5a4d,0);bytes.writeUInt32LE(pe,0x3c);bytes.writeUInt32LE(0x4550,pe);
  bytes.writeUInt16LE(plus?0x8664:0x14c,pe+4);bytes.writeUInt16LE(2,pe+6);bytes.writeUInt16LE(size,pe+20);
  bytes.writeUInt16LE(plus?0x20b:0x10b,optional);bytes.writeUInt32LE(512,optional+60);
  bytes.writeUInt32LE(0x11111111,optional+64);bytes.writeUInt32LE(directories,optional+(plus?108:92));
  for(let n=0;n<2;n++){
    const at=table+n*40;bytes.write('.test'+n,at,'ascii');bytes.writeUInt32LE(512,at+16);bytes.writeUInt32LE(512+n*512,at+20);
    bytes.fill(0x41+n,512+n*512,1024+n*512);
  }
  bytes.fill(0x4e,1536);
  return {bytes,optional,table,security:optional+(plus?144:128),checksum:optional+64,overlay:1536};
}
function frame(input){
  const offset=align8(input.bytes.length),length=8+fakePkcs7.length,certificate=Buffer.alloc(align8(length));
  certificate.writeUInt32LE(length,0);certificate.writeUInt16LE(0x200,4);certificate.writeUInt16LE(2,6);fakePkcs7.copy(certificate,8);
  const signed=Buffer.concat([input.bytes,Buffer.alloc(offset-input.bytes.length),certificate]);
  signed.writeUInt32LE(0x22222222,input.checksum);signed.writeUInt32LE(offset,input.security);signed.writeUInt32LE(certificate.length,input.security+4);
  return {signed,offset,certificate,length};
}
function assertNotTrusted(result){
  assert.equal(typeof result,'object');assert.notEqual(result.trusted,true);assert.notEqual(result.releaseAccepted,true);
  assert.notEqual(result.authenticodeValid,true);assert.notEqual(result.signatureStatus,'Valid');
}

for(const plus of [false,true])test((plus?'PE32+':'PE32')+' comparison permits only signing fields and 0..7 zero alignment bytes',()=>{
  for(let padding=0;padding<8;padding++){
    const input=fixture({plus,overlayLength:padding?8-padding:8}),{signed}=frame(input);
    const result=compareSignedPePayload(input.bytes,signed);assertNotTrusted(result);assert.equal(result.alignmentBytes,padding);
    assert.equal(result.unsignedSha256,createHash('sha256').update(input.bytes).digest('hex'));
    assert.equal(result.signedSha256,createHash('sha256').update(signed).digest('hex'));
    const normalized=Buffer.from(input.bytes);normalized.fill(0,input.checksum,input.checksum+4);normalized.fill(0,input.security,input.security+8);
    assert.equal(result.payloadSha256,createHash('sha256').update(normalized).digest('hex'));
  }
});
test('the minimum five complete data directories are supported for both PE variants',()=>{
  for(const plus of [false,true]){const input=fixture({plus,directories:5});assertNotTrusted(compareSignedPePayload(input.bytes,frame(input).signed));}
});
test('DOS stub, header, section table, both raw sections and NSIS overlay remain authoritative',()=>{
  const input=fixture(),{signed}=frame(input);
  for(const at of [0x40,input.optional+2,input.table,512+8,1024+24,input.overlay]){
    const changed=Buffer.from(signed);changed[at]^=1;
    assert.throws(()=>compareSignedPePayload(input.bytes,changed),/differs from this compile/);
  }
});
test('alignment, EOF position, directory values and single certificate framing fail closed',()=>{
  const input=fixture(),f=frame(input);
  const rejected=changed=>assert.throws(()=>compareSignedPePayload(input.bytes,changed));
  const padding=Buffer.from(f.signed);padding[input.bytes.length]=1;rejected(padding);
  rejected(Buffer.concat([f.signed,Buffer.from([0])]));
  const gap=Buffer.concat([f.signed.subarray(0,f.offset),Buffer.alloc(8),f.certificate]);gap.writeUInt32LE(f.offset+8,input.security);rejected(gap);
  for(const [at,value,width] of [[input.security,f.offset+1,4],[input.security+4,f.certificate.length-8,4],[f.offset,8,4],[f.offset,f.certificate.length+1,4],[f.offset+4,0x100,2],[f.offset+6,1,2]]){
    const changed=Buffer.from(f.signed);if(width===4)changed.writeUInt32LE(value,at);else changed.writeUInt16LE(value,at);rejected(changed);
  }
  const halfDirectory=Buffer.from(f.signed);halfDirectory.writeUInt32LE(0,input.security+4);rejected(halfDirectory);
  const certificatePadding=Buffer.from(f.signed);certificatePadding[f.offset+f.length]=1;rejected(certificatePadding);
  const two=Buffer.concat([f.signed,f.certificate]);two.writeUInt32LE(2*f.certificate.length,input.security+4);rejected(two);
  assert.throws(()=>compareSignedPePayload(f.signed,f.signed),/must be unsigned/);
  rejected(input.bytes);
});
test('malformed and overlapping PE ranges are rejected even when both byte prefixes match',()=>{
  const edits=[
    bytes=>bytes.writeUInt16LE(0,0),bytes=>bytes.writeUInt32LE(0xffffff00,0x3c),bytes=>bytes.writeUInt32LE(0,0x80),
    bytes=>bytes.writeUInt16LE(0,0x80+6),bytes=>bytes.writeUInt16LE(0x999,0x80+24),
    bytes=>bytes.writeUInt16LE(80,0x80+20),bytes=>bytes.writeUInt32LE(4,0x80+24+92),bytes=>bytes.writeUInt32LE(17,0x80+24+92),
    bytes=>bytes.writeUInt32LE(256,0x80+24+60),
    bytes=>bytes.writeUInt32LE(128,0x80+24+224+20),
    bytes=>bytes.writeUInt32LE(512,0x80+24+224+40+20),
    bytes=>bytes.writeUInt32LE(0xffff0000,0x80+24+224+16),
  ];
  for(const edit of edits){const input=fixture();edit(input.bytes);assert.throws(()=>compareSignedPePayload(input.bytes,frame(input).signed),/Invalid PE/);}
  assert.throws(()=>compareSignedPePayload(Buffer.alloc(32),Buffer.alloc(32)),/Invalid PE/);
});
