import {mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {DeviceDriver} from './device-driver.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/upgrade-check.mjs --serial SERIAL --apk FILE [--sha256 HASH]\nStart at home. Back up files/ and shared_prefs/, verify the archive, install -r, and compare every previous file byte before relaunch. Never clears or uninstalls Note.');process.exit(0);}
assert.ok(option('--serial')&&option('--apk'),'Explicit serial and APK required');
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-upgrade-'));await mkdir(output,{recursive:true});
try{await access(join(output,'preinstall-manifest.json'));throw new Error('Use a new evidence directory');}catch(e){if(e.code!=='ENOENT')throw e;}
const d=new DeviceDriver({serial:option('--serial'),output}),pkg='com.m1racle.note',hash=b=>createHash('sha256').update(b).digest('hex'),apk=resolve(option('--apk'));
const result={date:new Date().toISOString(),serial:d.serial,apk,scope:['files/','shared_prefs/']};
const list=()=>d.adb('shell','run-as',pkg,'find','files','shared_prefs','-type','f','-print0').toString().split('\0').filter(Boolean).sort();
const get=p=>{assert.match(p,/^(files|shared_prefs)\/[A-Za-z0-9._/-]+$/);assert.ok(!p.split('/').includes('..'));return d.adb('exec-out','run-as',pkg,'cat',p);};
const version=()=>d.adb('shell','dumpsys','package',pkg).toString().match(/versionName=([^\s]+)/)?.[1];
try{
 await d.connect();await d.waitNativeScreen();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Save the current draft and return home first');
 result.beforeVersion=version();result.apkSha256=hash(await readFile(apk));if(option('--sha256'))assert.equal(result.apkSha256,option('--sha256'));
 assert.equal(d.adb('shell','run-as',pkg,'find','files','shared_prefs','-type','l','-print').toString().trim(),'');const names=list(),entries=[];
 for(const p of names){const bytes=get(p),local=join(output,'preinstall-files',p);await mkdir(dirname(local),{recursive:true});await writeFile(local,bytes);entries.push({path:p,bytes:bytes.length,sha256:hash(bytes)});}
 await writeFile(join(output,'preinstall-manifest.json'),JSON.stringify(entries,null,2));
 const tar=d.adb('exec-out','run-as',pkg,'tar','-cf','-','files','shared_prefs');await writeFile(join(output,'preinstall-backup.tar'),tar);result.backupSha256=hash(tar);
 const extracted=join(output,'tar-verification');await mkdir(extracted);execFileSync('tar',['-xf',join(output,'preinstall-backup.tar'),'-C',extracted],{windowsHide:true});
 for(const e of entries){assert.equal(hash(await readFile(join(extracted,e.path))),e.sha256);assert.equal(hash(get(e.path)),e.sha256,'Data changed during backup');}
 await d.disconnect();assert.match(d.adb('install','-r',apk).toString(),/Success/);
 const installed=d.adb('shell','pm','path',pkg).toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);
 assert.deepEqual(list(),names,'The private file list changed during install');for(const e of entries)assert.equal(hash(get(e.path)),e.sha256,'Upgrade changed '+e.path);
 result.afterVersion=version();result.files=entries.length;result.notes=entries.filter(e=>e.path.startsWith('files/Notes/')).length;result.allBytesPreserved=true;result.entries=entries;
 d.adb('shell','am','start','-n',pkg+'/.MainActivity');
}catch(e){result.failure=String(e.stack||e);process.exitCode=1;}
finally{await d.disconnect();await writeFile(join(output,'upgrade-preservation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({version:result.afterVersion,notes:result.notes,files:result.files,allBytesPreserved:result.allBytesPreserved,output}));}
