import {spawn} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import assert from 'node:assert/strict';
const entry='desktop/dist/index.html',before=await readFile(entry,'utf8');
const priorAssets=[...before.matchAll(/(?:src|href)="\.\/([^\"]+)"/g)].map(match=>'desktop/dist/'+match[1]);
const child=spawn(process.execPath,['desktop/scripts/windows-build.mjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='',finished=false,reads=0;const failures=[];
child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{finished=true;resolve(code);});});
while(!finished){
  try{assert.ok((await readFile(entry,'utf8')).includes('</html>'));await Promise.all(priorAssets.map(path=>access(path)));reads++;}catch(error){failures.push(error.message);}
  await new Promise(resolve=>setTimeout(resolve,10));
}
const code=await done;assert.equal(code,0,output.slice(-1500));assert.deepEqual(failures,[]);assert.ok(reads>10);
console.log(JSON.stringify({passed:true,checks:['entry-always-present-and-complete-during-build','running-window-assets-preserved'],reads}));
