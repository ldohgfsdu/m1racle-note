import {mkdir,mkdtemp,copyFile,cp,writeFile,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import { packager } from '@electron/packager';
if(process.argv.includes('--use-existing-icons')) {
  // Reuse the approved assets on build hosts where Electron cannot initialize.
  // The artifact verifier still checks every asset and embedded EXE icon frame.
  const ico=await readFile('desktop/assets/icon.ico');
  if(ico.readUInt16LE(0)!==0 || ico.readUInt16LE(2)!==1 || ico.readUInt16LE(4)!==7)throw new Error('Invalid existing icon.ico');
  console.log('Using existing icon assets; generation not run.');
} else {
  const icons=spawnSync(process.execPath,['desktop/scripts/windows-icons.cjs'],{stdio:'inherit',windowsHide:true});
  if(icons.error)throw icons.error;
  if(icons.status!==0)process.exit(icons.status??1);
}
const built=spawnSync(process.execPath,['desktop/scripts/windows-build.mjs'],{stdio:'inherit'});
if(built.status!==0)process.exit(built.status??1);
export const version='0.1.18';
await mkdir('desktop/releases/windows-staging',{recursive:true});
const staging=await mkdtemp(`desktop/releases/windows-staging/${version}-`);
for(const file of ['main.mjs','icons.mjs','preload.cjs','session.mjs','drafts.mjs','session-state.mjs','recent-state.mjs','library-state.mjs','library-names.mjs','associations.mjs','onboarding.mjs','store-identity.mjs'])await copyFile(`desktop/${file}`,`${staging}/${file}`);
const manifest=JSON.parse(await readFile('desktop/dist/.vite/manifest.json','utf8'));
const resources=new Set(['index.html','build-manifest.json']);
for(const entry of Object.values(manifest))for(const path of [entry.file,...(entry.css||[]),...(entry.assets||[])])if(path)resources.add(path);
for(const path of resources){
  if(path.startsWith('/')||path.includes('..')||path.includes('\\'))throw new Error(`Invalid build resource: ${path}`);
  await mkdir(dirname(`${staging}/dist/${path}`),{recursive:true});
  await copyFile(path==='build-manifest.json'?'desktop/dist/.vite/manifest.json':`desktop/dist/${path}`,`${staging}/dist/${path}`);
}
await cp('desktop/assets',`${staging}/assets`,{recursive:true});
await mkdir(`${staging}/licenses`,{recursive:true});
const lock=JSON.parse(await (await import('node:fs/promises')).readFile('package-lock.json','utf8'));
for(const [path,metadata] of Object.entries(lock.packages)) {
  if(!path || metadata.dev)continue;
  const name=(await (await import('node:fs/promises')).readdir(path)).find(file=>/^license(?:[-.]|$)/i.test(file));
  if(!name)throw new Error(`License missing: ${path}`);
  await copyFile(`${path}/${name}`,`${staging}/licenses/${path.replaceAll('/','-')}.txt`);
}
await copyFile('THIRD_PARTY_NOTICES.md',`${staging}/licenses/NOTICES.md`);
await copyFile('LICENSE',`${staging}/licenses/M1racle-Note-MIT.txt`);
await writeFile(`${staging}/package.json`,JSON.stringify({name:'m1racle-note',productName:'M1racle Note',author:'M1racle',version,main:'main.mjs',type:'module'}));
const outputs=await packager({dir:staging,name:'M1racle Note',icon:'desktop/assets/icon.ico',platform:'win32',arch:'x64',out:`desktop/releases/windows/${version}`,overwrite:true,asar:true,appVersion:version,electronVersion:JSON.parse(await (await import('node:fs/promises')).readFile('node_modules/electron/package.json')).version});
console.log(outputs.join('\n'));
