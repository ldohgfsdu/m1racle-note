import { cp, mkdir, readdir, readFile, rm, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// This directory contains generated bundles only. Never accumulate obsolete hashed assets in an APK.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const generatedEditor = resolve(repositoryRoot, 'mobile/app/src/main/assets/editor');
if (generatedEditor !== resolve('mobile/app/src/main/assets/editor')) throw new Error('Run bundling from the repository root');
await readFile('mobile/editor/dist/index.html');
const existing = await lstat(generatedEditor).catch(error => {
 if (error.code !== 'ENOENT') throw error;
});
if (existing?.isSymbolicLink()) throw new Error('Generated editor directory must not be a symbolic link');
await rm(generatedEditor, { recursive: true, force: true });
await mkdir(generatedEditor, { recursive: true });
await cp('mobile/editor/dist', 'mobile/app/src/main/assets/editor', { recursive: true });
await mkdir('mobile/app/src/main/assets/editor/licenses', { recursive:true });
const lock = JSON.parse(await readFile('package-lock.json','utf8'));
const packages = Object.entries(lock.packages).filter(([path, metadata]) => path && !metadata.dev).map(([path])=>path.replace(/^node_modules\//,''));
for (const name of packages) {
 const dir = `node_modules/${name}`;
 const license = (await readdir(dir)).find(file => /^license(?:[-.]|$)/i.test(file));
 if(!license) throw new Error(`License missing: ${name}`);
 await cp(`${dir}/${license}`,`mobile/app/src/main/assets/editor/licenses/${name.replaceAll('/','-')}.txt`);
}
await cp('THIRD_PARTY_NOTICES.md','mobile/app/src/main/assets/editor/licenses/NOTICES.md');
await cp('LICENSE','mobile/app/src/main/assets/editor/licenses/M1racle-Note-MIT.txt');
await cp('licenses','mobile/app/src/main/assets/editor/licenses/project-dependencies',{recursive:true});
console.log('Bundled offline editor → Android assets');
