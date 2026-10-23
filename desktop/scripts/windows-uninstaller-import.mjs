import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {lstat,readFile,writeFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const align8=value=>Math.ceil(value/8)*8;
function peInfo(bytes){
  const fail=()=>{throw new Error('Invalid PE layout for signed-uninstaller comparison');};
  if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.readUInt16LE(0)!==0x5a4d)fail();
  const pe=bytes.readUInt32LE(0x3c);
  if(pe<64||pe+24>bytes.length||bytes.readUInt32LE(pe)!==0x4550)fail();
  const count=bytes.readUInt16LE(pe+6),optionalSize=bytes.readUInt16LE(pe+20),optional=pe+24;
  if(count<1||count>96||optional+optionalSize+count*40>bytes.length||optionalSize<96)fail();
  const magic=bytes.readUInt16LE(optional);
  const directory=magic===0x10b?optional+96:magic===0x20b?optional+112:0;
  if(!directory||directory+40>optional+optionalSize)fail();
  const directoryCount=bytes.readUInt32LE(directory-4);
  if(directoryCount<5||directory+directoryCount*8>optional+optionalSize)fail();
  const headers=bytes.readUInt32LE(optional+60),sectionTable=optional+optionalSize;
  if(headers<sectionTable+count*40||headers>bytes.length)fail();
  const sections=[];let dataEnd=headers;
  for(let n=0;n<count;n++){
    const at=sectionTable+n*40,size=bytes.readUInt32LE(at+16),start=bytes.readUInt32LE(at+20);
    if(!size)continue;
    const end=start+size;
    if(start<headers||end>bytes.length||sections.some(s=>start<s.end&&end>s.start))fail();
    sections.push({start,end});dataEnd=Math.max(dataEnd,end);
  }
  const security=directory+32,certificateOffset=bytes.readUInt32LE(security),certificateSize=bytes.readUInt32LE(security+4);
  if((certificateOffset===0)!==(certificateSize===0))fail();
  return {checksum:optional+64,security,certificateOffset,certificateSize,dataEnd,magic};
}

// This is strict byte equivalence, not a substitute for Windows trust validation.
// It includes all NSIS overlay bytes; only Authenticode bookkeeping may differ.
export function compareSignedPePayload(unsignedBytes,signedBytes){
  const original=Buffer.from(unsignedBytes),signed=Buffer.from(signedBytes);
  const a=peInfo(original),b=peInfo(signed);
  if(a.certificateOffset||a.certificateSize)throw new Error('Compiler-generated uninstaller must be unsigned');
  if(a.magic!==b.magic||a.checksum!==b.checksum||a.security!==b.security)throw new Error('PE headers changed');
  if(!b.certificateOffset||b.certificateOffset%8||b.certificateOffset!==align8(original.length)||b.certificateOffset<b.dataEnd||b.certificateOffset+b.certificateSize!==signed.length||b.certificateSize<8||b.certificateSize%8)throw new Error('Unexpected certificate range or trailing payload');
  const at=b.certificateOffset,length=signed.readUInt32LE(at);
  if(length<9||align8(length)!==b.certificateSize||signed.readUInt16LE(at+4)!==0x200||signed.readUInt16LE(at+6)!==2)throw new Error('Expected one WIN_CERTIFICATE PKCS#7 record');
  if(signed.subarray(original.length,at).some(byte=>byte!==0)||signed.subarray(at+length).some(byte=>byte!==0))throw new Error('Nonzero Authenticode alignment padding');
  const normalized=Buffer.from(original),prefix=Buffer.from(signed.subarray(0,original.length));
  for(const bytes of [normalized,prefix]){bytes.fill(0,a.checksum,a.checksum+4);bytes.fill(0,a.security,a.security+8);}
  if(!normalized.equals(prefix))throw new Error('Signed uninstaller differs from this compile, including executable code or NSIS overlay');
  return {unsignedSha256:sha256(original),signedSha256:sha256(signed),payloadSha256:sha256(normalized),alignmentBytes:at-original.length};
}

export async function verifyOwnedSignature(path,{version,expectedSubject}){
  if(process.platform!=='win32')throw new Error('Windows signature validation requires Windows');
  if(!/^\d+\.\d+\.\d+$/.test(version||'')||typeof expectedSubject!=='string'||!expectedSubject.trim())throw new Error('Version and independently verified expected publisher are required');
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())throw new Error('Signature input must be a regular file');
  const before=sha256(await readFile(path));
  const script=`$ErrorActionPreference='Stop';$p=$env:NOTE_SIGNING_INSPECT_PATH;$s=Get-AuthenticodeSignature -LiteralPath $p;$v=(Get-Item -LiteralPath $p).VersionInfo;[pscustomobject]@{status=[string]$s.Status;signatureType=[string]$s.SignatureType;subject=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint;timestampSubject=$s.TimeStamperCertificate.Subject;productName=$v.ProductName;productVersion=$v.ProductVersion;sha256=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}|ConvertTo-Json -Compress`;
  const inspected=spawnSync(process.env.NOTE_POWERSHELL_EXE||'pwsh.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:{...process.env,NOTE_SIGNING_INSPECT_PATH:resolve(path)}});
  if(inspected.error||inspected.status!==0)throw new Error('Signature inspector failed: '+(inspected.error?.message||inspected.stderr?.trim()));
  const result=JSON.parse(inspected.stdout.replace(/^\uFEFF/,''));
  if(result.sha256!==before||sha256(await readFile(path))!==before)throw new Error('Signature input changed during verification');
  if(result.status!=='Valid')throw new Error('Trusted signature required; observed '+result.status);
  if(result.signatureType!=='Authenticode')throw new Error('Embedded Authenticode signature required; observed '+result.signatureType);
  if(result.subject!==expectedSubject.trim()||!result.timestampSubject)throw new Error('Expected publisher and trusted timestamp are required');
  if(result.productName!=='M1racle Note'||result.productVersion!==version)throw new Error('Signed product identity or version mismatch');
  return result;
}

export async function importSignedUninstaller({unsignedPath,signedPath,version,expectedSubject,tempRoot,proofPath,buildId}){
  if(!/^[0-9a-f-]{36}$/i.test(buildId||''))throw new Error('Missing signing build nonce');
  const root=await realpath(tempRoot),target=await realpath(unsignedPath);
  if(!target.toLowerCase().startsWith(root.toLowerCase()+sep)||!(await lstat(unsignedPath)).isFile()||(await lstat(unsignedPath)).isSymbolicLink())throw new Error('NSIS target must be its current compiler temporary file');
  const scratch=await mkdtemp(join(root,'signed-uninstaller-'));
  try{
    const bytes=await readFile(signedPath),snapshot=join(scratch,'Uninstall.exe');
    await writeFile(snapshot,bytes,{flag:'wx'});
    const signature=await verifyOwnedSignature(snapshot,{version,expectedSubject});
    const original=await readFile(unsignedPath),comparison=compareSignedPePayload(original,bytes);
    // Do not read the source a second time: embed exactly the verified snapshot.
    await writeFile(unsignedPath,bytes);
    if(sha256(await readFile(unsignedPath))!==comparison.signedSha256)throw new Error('NSIS replacement bytes mismatch');
    const proof={schema:1,buildId,version,...comparison,signature,embedding:'verified bytes supplied to this NSIS compile; installer completion still required',releaseAccepted:false};
    await writeFile(proofPath,JSON.stringify(proof,null,2)+'\n');
    console.log('SIGNED_UNINSTALLER_REPLACEMENT_VERIFIED: '+comparison.signedSha256);
    return proof;
  }finally{
    const cleanup=await realpath(scratch);
    if(!cleanup.toLowerCase().startsWith(root.toLowerCase()+sep))throw new Error('Refusing cleanup outside compiler temporary directory');
    await rm(cleanup,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked){
  if(process.argv.length!==3)throw new Error('Expected the NSIS-generated temporary uninstaller path');
  await importSignedUninstaller({unsignedPath:process.argv[2],signedPath:process.env.NOTE_SIGNING_UNINSTALLER,version:process.env.NOTE_SIGNING_VERSION,expectedSubject:process.env.NOTE_EXPECTED_SIGNER_SUBJECT,tempRoot:process.env.NOTE_SIGNING_TEMP_ROOT,proofPath:process.env.NOTE_SIGNING_PROOF_PATH,buildId:process.env.NOTE_SIGNING_BUILD_ID});
}
