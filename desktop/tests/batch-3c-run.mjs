import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// One stage at a time. Never launch Electron suites concurrently. Each stage has
// an immutable output directory and a bounded wall-clock ceiling, not a relaxed
// product assertion timeout. The SAVE assertion remains 5000ms.
const [rootArg,stage]=process.argv.slice(2);
if(!rootArg || !stage)throw new Error('usage: batch-3c-run.mjs <new evidence root> <stage>');
const root=resolve(rootArg), hidden=resolve('desktop/tests/hidden-main.cjs');
const plans={
  build:{file:'desktop/scripts/windows-build.mjs',timeout:120000},
  hidden:{file:'desktop/tests/hidden-window-check.mjs',timeout:90000},
  save:{file:'desktop/tests/floating-heading-menu-ui.mjs',timeout:180000,env:{NOTE_QA_CASE:'top-light,h3-continue-reopen'}},
  c0:{file:'desktop/tests/floating-heading-menu-ui.mjs',timeout:300000,env:{NOTE_QA_SKIP_CASE:'top-light,h3-continue-reopen'}},
  writing:{file:'desktop/tests/writing-experience-ui.mjs',timeout:900000},
  'writing-followup':{file:'desktop/tests/writing-experience-ui.mjs',timeout:360000,env:{NOTE_QA_WRITING_CASE:'C-large-,D-,E-'}},
  'long-followup':{file:'desktop/tests/writing-experience-ui.mjs',timeout:180000,env:{NOTE_QA_WRITING_CASE:'C-large-'}},
  'mode-regression':{file:'desktop/tests/floating-heading-menu-ui.mjs',timeout:90000,env:{NOTE_QA_CASE:'h3-continue-reopen'}},
  efficiency:{file:'desktop/tests/writing-efficiency-ui.mjs',timeout:300000},
  capture:{file:'desktop/tests/capture-controlled-ui.mjs',timeout:90000},
  context:{file:'desktop/tests/writing-context-ui.mjs',timeout:90000},
  composition:{file:'desktop/tests/input-composition-gate-ui.mjs',timeout:240000,wrapper:true},
  core:{args:['--test','--test-concurrency=1','desktop/tests/session.test.mjs','desktop/tests/formatting.test.mjs','desktop/tests/block-formatting.test.mjs','desktop/tests/draft-store-closure.test.mjs','desktop/tests/session-state.test.mjs'],timeout:180000},
};
const plan=plans[stage];
if(!plan)throw new Error('unknown stage '+stage);
if(process.platform==='win32') {
  const observed=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'electron.exe' -and $_.CommandLine -match 'note-(3a|3c0|hidden-check)-'} | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress"],
    {encoding:'utf8',windowsHide:true});
  if(observed.trim())throw new Error('TEST_ENVIRONMENT_ERROR: an existing isolated Electron test is still running: '+observed);
}
const output=join(root,stage);
await mkdir(output,{recursive:false});
const env={...process.env,...plan.env,NOTE_QA_OUTPUT:output,NOTE_QA_PHASE:'controlled',NOTE_QA_CAPTURE:'functional'};
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
delete env.NOTE_TEST_FOREGROUND;
const args=plan.args || ['--require',hidden,...(plan.wrapper?['--import',pathToFileURL(resolve('desktop/tests/hidden-launch.mjs')).href]:[]),resolve(plan.file)];
const files=['desktop/main.mjs','desktop/session.mjs','desktop/renderer/main.js','desktop/renderer/selection-menu.js',
  'desktop/tests/hidden-main.cjs','desktop/tests/hidden-launch.mjs','desktop/tests/evidence-capture.mjs',
  'desktop/dist/index.html',...(plan.file?[plan.file]:[])];
async function hashes(){return Object.fromEntries(await Promise.all(files.map(async file=>{
  try{return [file,createHash('sha256').update(await readFile(file)).digest('hex')];}
  catch{return [file,null];}
})));}
const record={stage,startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),
  args,output,concurrency:1,capture:'functional',hashesBefore:await hashes()};
await writeFile(join(output,'invocation.json'),JSON.stringify(record,null,2),{flag:'wx'});
const stdout=createWriteStream(join(output,'stdout.txt'),{flags:'wx'}),stderr=createWriteStream(join(output,'stderr.txt'),{flags:'wx'});
const child=spawn(process.execPath,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
record.runnerPid=child.pid;
child.stdout.pipe(stdout);child.stderr.pipe(stderr);
child.stdout.on('data',data=>process.stdout.write(data));
child.stderr.on('data',data=>process.stderr.write(data));
let timedOut=false;
const timer=setTimeout(()=>{
  timedOut=true;
  if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else child.kill('SIGTERM');
},plan.timeout);
const exit=await new Promise(done=>{child.once('error',error=>done({code:null,error:String(error)}));child.once('exit',(code,signal)=>done({code,signal}));});
clearTimeout(timer);
await Promise.all([new Promise(done=>stdout.end(done)),new Promise(done=>stderr.end(done))]);
Object.assign(record,{finishedAt:new Date().toISOString(),exit,timedOut,hashesAfter:await hashes()});
await writeFile(join(output,'result.json'),JSON.stringify(record,null,2),{flag:'wx'});
console.log(JSON.stringify({stage,exit,timedOut,output}));
process.exitCode=exit.code===0&&!timedOut?0:1;
