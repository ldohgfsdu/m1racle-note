import {readFile,writeFile,readdir,stat,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {extractFile,listPackage} from '@electron/asar';
import {NtExecutable,NtExecutableResource} from 'pe-library';
import {tmpdir} from 'node:os';
const version=process.argv[2];
assert.match(version || '',/^\d+\.\d+\.\d+$/,'Pass the portable version to verify');
const root=resolve('.'),dir=join(root,'desktop/releases/windows',version,'M1racle Note-win32-x64');
const exe=join(dir,'M1racle Note.exe'),asar=join(dir,'resources/app.asar');
const sha=data=>createHash('sha256').update(data).digest('hex');
const metadata=JSON.parse(extractFile(asar,'package.json'));
assert.equal(metadata.version,version);assert.equal(metadata.main,'main.mjs');
const sourceFiles=['main.mjs','icons.mjs','preload.cjs','session.mjs','drafts.mjs','session-state.mjs','recent-state.mjs','library-state.mjs','library-names.mjs','associations.mjs','onboarding.mjs','store-identity.mjs'];
for(const file of sourceFiles)assert.ok(extractFile(asar,file).equals(await readFile(join(root,'desktop',file))),file+' exact source');
const icons=[];
for(const name of (await readdir('desktop/assets')).filter(name=>/^icon.*\.(?:png|ico|svg)$/.test(name))){
  const data=await readFile(join('desktop/assets',name));assert.ok(extractFile(asar,'assets/'+name).equals(data),name+' exact packaged asset');icons.push({name,sha256:sha(data)});
  if(name.endsWith('.svg')){
    const theme=name.includes('-night.')?'night':'day';
    const original=await readFile(`branding/m1racle-note/v1/svg/icon-512-${theme}.svg`,'utf8');
    const paths=svg=>[...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match=>match[1]);
    const approved=paths(original);assert.equal(approved.length,5);assert.deepEqual(paths(data.toString()),approved,name+' preserves all approved mother mark and Note paths');
  }
}
const html=extractFile(asar,'dist/index.html').toString();assert.equal(html,await readFile('desktop/dist/index.html','utf8'));
const files=listPackage(asar).map(name=>name.replaceAll('\\','/')),references=[...html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map(match=>match[1]);
const manifest=JSON.parse(extractFile(asar,'dist/build-manifest.json'));
const currentResources=new Set(['index.html','build-manifest.json']);
for(const entry of Object.values(manifest))for(const name of [entry.file,...(entry.css||[]),...(entry.assets||[])])if(name)currentResources.add(name);
for(const name of currentResources)assert.ok(extractFile(asar,join('dist',...name.split('/'))).equals(await readFile(name==='build-manifest.json'?'desktop/dist/.vite/manifest.json':join('desktop/dist',...name.split('/')))),'exact current build resource '+name);
const packagedResources=files.filter(name=>name.startsWith('/dist/') && /\/[^/]+\.[^/]+$/.test(name)).map(name=>name.slice('/dist/'.length));
assert.deepEqual(packagedResources.sort(),[...currentResources].sort(),'no stale renderer files in package');
for(const name of references){
  assert.ok(files.includes('/dist/'+name),'entry asset '+name);
  assert.ok(extractFile(asar,join('dist',...name.split('/'))).equals(await readFile(join('desktop/dist',...name.split('/')))),'entry asset exact '+name);
}
const js=references.filter(name=>name.endsWith('.js')).map(name=>extractFile(asar,join('dist',...name.split('/'))).toString()).join('\n');
for(const marker of ['writing-commands','writing-outline','m1-heading-token','选中全部','全部替换','lastChars'])assert.ok(js.includes(marker),'new renderer '+marker);
const binary=await readFile(exe),entries=NtExecutableResource.from(NtExecutable.from(binary)).entries;
const ico=await readFile('desktop/assets/icon.ico'),expected=new Map();
for(let i=0;i<ico.readUInt16LE(4);i++){const p=6+i*16,size=ico[p]||256;expected.set(size,ico.subarray(ico.readUInt32LE(p+12),ico.readUInt32LE(p+12)+ico.readUInt32LE(p+8)));}
const groups=[];
for(const entry of entries.filter(entry=>entry.type===14)){
  const data=Buffer.from(entry.bin),frames=[];assert.equal(data.readUInt16LE(4),7);
  for(let i=0;i<data.readUInt16LE(4);i++){
    const p=6+i*14,size=data[p]||256,id=data.readUInt16LE(p+12);
    const image=entries.find(candidate=>candidate.type===3&&candidate.id===id&&candidate.lang===entry.lang);
    assert.ok(image,'PE icon resource '+id);assert.ok(Buffer.from(image.bin).equals(expected.get(size)),'PE full-master frame '+size);
    frames.push({size,resourceId:id,matchesFullMasterICO:true});
  }
  groups.push({id:entry.id,lang:entry.lang,frames});
}
assert.ok(groups.length>0);
const total=async path=>{let bytes=0;for(const name of await readdir(path)){const file=join(path,name),info=await stat(file);bytes+=info.isDirectory()?await total(file):info.size;}return bytes;};
const result={passed:true,version,packageRoot:dir,executable:exe,bytes:await total(dir),exeSha256:sha(binary),asarSha256:sha(await readFile(asar)),sourceFiles,icons,entryAssets:references,currentResources:[...currentResources],peIconGroups:groups,checks:['ASAR-version-entry','source-files-exact','all-icon-assets-exact','renderer-entry-assets-present','current-build-graph-exact-no-stale-assets','writing-features-bundled','all-PE-icon-frames-full-master'],boundary:'Static portable artifact and PE resources verified; OS taskbar pin/cache not modified and packaged app not launched.'};
const output=join(await mkdtemp(join(tmpdir(),'note-package-proof-')),'verification.json');
await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,version,bytes:result.bytes,groups:groups.length,icons:icons.length,checks:result.checks,output}));
