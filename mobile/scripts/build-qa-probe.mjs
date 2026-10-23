import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,access,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// A separate test-only local receiver; it is never bundled into Note.
const sdk=process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const jdk=process.env.JAVA_HOME;assert.ok(sdk && jdk,'Set ANDROID_HOME and JAVA_HOME.');
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-probe-build-'));await mkdir(output,{recursive:true});
const work=await mkdtemp(join(output,'build-')),classes=join(work,'classes'),dex=join(work,'dex');await mkdir(classes);await mkdir(dex);
const buildTools=join(sdk,'build-tools','36.0.0'),androidJar=join(sdk,'platforms','android-37','android.jar'),exe=name=>join(jdk,'bin',name+(process.platform==='win32'?'.exe':''));
const run=(file,args)=>execFileSync(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
const ui=process.argv.includes('--ui'),directory=ui?'mobile/qa-ui-probe':'mobile/qa-probe',packageName=ui?'com.m1racle.note.qa.ui':'com.m1racle.note.qa.probe';
const source=resolve(directory+'/'+(ui?'WindowProbe.java':'ProbeActivity.java')),manifest=resolve(directory+'/AndroidManifest.xml');
run(exe('javac'),['-J-Duser.language=en','-J-Duser.country=US','-encoding','UTF-8','-source','8','-target','8','-bootclasspath',androidJar,'-d',classes,source]);
const compiled=await readdir(classes,{recursive:true});
const classFiles=compiled.filter(name=>name.endsWith('.class')).map(name=>join(classes,name));assert.ok(classFiles.length);
run(exe('java'),['-cp',join(buildTools,'lib','d8.jar'),'com.android.tools.r8.D8','--min-api','28','--lib',androidJar,'--output',dex,...classFiles]);
const unsigned=join(work,'unsigned.apk'),aligned=join(work,'aligned.apk'),apk=join(output,ui?'note-qa-ui.apk':'note-qa-probe.apk');
run(join(buildTools,'aapt2'+(process.platform==='win32'?'.exe':'')),['link','--manifest',manifest,'-I',androidJar,'--min-sdk-version','28','--target-sdk-version','35','--version-code','1','--version-name','0.0.1','-o',unsigned]);
run(exe('jar'),['uf',unsigned,'-C',dex,'classes.dex']);
run(join(buildTools,'zipalign'+(process.platform==='win32'?'.exe':'')),['-f','4',unsigned,aligned]);
const keystore=join(output,'qa-probe.keystore');
try {await access(keystore);}catch{run(exe('keytool'),['-genkeypair','-keystore',keystore,'-storepass','android','-keypass','android','-alias','qa-probe','-dname','CN=Note QA Probe','-keyalg','RSA','-keysize','2048','-validity','3650']);}
run(exe('java'),['-jar',join(buildTools,'lib','apksigner.jar'),'sign','--ks',keystore,'--ks-key-alias','qa-probe','--ks-pass','pass:android','--key-pass','pass:android','--out',apk,aligned]);
run(exe('java'),['-jar',join(buildTools,'lib','apksigner.jar'),'verify',apk]);
await writeFile(join(output,ui?'ui-build-result.json':'build-result.json'),JSON.stringify({apk,testOnly:true,package:packageName,networkPermissions:false},null,2));console.log(JSON.stringify({apk,testOnly:true,compiledClasses:classFiles.length}));
