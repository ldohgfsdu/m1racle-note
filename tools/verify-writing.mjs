import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';

// Repeatable functional coverage. Logs/screenshots stay outside the checkout;
// each desktop test uses a separate profile. Physical gates stay explicitly open.
const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-writing-verification-'));
await mkdir(output,{recursive:true});
const desktop=!process.argv.includes('--mobile-only'),mobile=!process.argv.includes('--desktop-only');
const targeted=process.argv.includes('--targeted');
if(targeted && !process.argv.includes('--only'))throw new Error('TARGETED requires --only with explicit job ids; see docs/engineering/WORKFLOW.md');
const hiddenMain=fileURLToPath(new URL('../desktop/tests/hidden-main.cjs',import.meta.url));
const hiddenLaunch=new URL('../desktop/tests/hidden-launch.mjs',import.meta.url).href;
// Native Windows suites each compile/start helper processes. Bound file-level
// parallelism so host contention does not starve their real checkpoint timers.
const jobs=[{id:'source-and-desktop-units',args:['--test','--test-reporter=tap','--test-concurrency=4','tests/*.test.mjs','desktop/tests/*.test.mjs']},
 {id:'preview-equivalence',args:['tests/preview-equivalence.mjs']}];
if(desktop) {
 jobs.push({id:'desktop-build',args:['desktop/scripts/windows-build.mjs']});
 for(const [id,file] of [
  ['desktop-foundation','foundation-ui.mjs'],['desktop-rendered-preview','rendered-policy-ui.mjs'],
  ['desktop-navigation','rendered-navigation.mjs'],['desktop-editing','rendered-editing.mjs'],
  ['desktop-selection','selection-menu-ui.mjs'],['desktop-block-preview','block-preview-ui.mjs'],
  ['desktop-writing-tools','writing-tools-ui.mjs'],['desktop-insertion','insertion-ui.mjs'],
  ['desktop-layout','compact-ui.mjs'],['desktop-onboarding','onboarding-ui.mjs'],['desktop-search','search-ui.mjs'],['desktop-files','file-lifecycle-ui.mjs'],
  ['desktop-save-name','save-name-ui.mjs'],
  ['desktop-save-undo','save-undo-ui.mjs'],
  ['desktop-composition','input-composition-gate-ui.mjs'],
  ['desktop-history','history-clipboard-ui.mjs'],
  ['desktop-library','library-ui.mjs'],
  ['desktop-library-usage','library-usage-ui.mjs'],
  ['desktop-split','split-view-ui.mjs'],
  ['desktop-split-layout','split-layout-ui.mjs'],
  ['desktop-smoke','smoke-ui.mjs'],['desktop-roundtrip','roundtrip-ui.mjs'],['desktop-input-paths','input-paths.mjs'],['desktop-recovery','recovery-ui.mjs'],
  ['desktop-recovery-closure','recovery-closure.mjs'],
  ['desktop-session-restore','session-restore-ui.mjs'],
 ])jobs.push({id,args:['desktop/tests/'+file]});
}
if(mobile)jobs.push({id:'mobile-build',args:['mobile/scripts/build.mjs']},
 {id:'mobile-browser',args:['node_modules/@playwright/test/cli.js','test','--config','mobile/playwright.config.ts','--output',join(output,'mobile-browser','artifacts')]});
if(process.argv.includes('--android-build'))jobs.push({id:'android-build-and-jvm',command:process.platform==='win32'?'cmd.exe':'sh',
 args:process.platform==='win32'?['/d','/c','gradlew.bat',':app:assembleDebug',':app:testDebugUnitTest','--no-daemon','--console=plain']:['./gradlew',':app:assembleDebug',':app:testDebugUnitTest','--no-daemon','--console=plain'],cwd:join(root,'mobile')});
const onlyIndex=process.argv.indexOf('--only'),only=onlyIndex<0?null:new Set((process.argv[onlyIndex+1] || '').split(','));
if(only)for(const id of only)if(!jobs.some(job=>job.id===id))throw new Error('Unknown verification job: '+id);
const selected=only?jobs.filter(job=>only.has(job.id)):jobs;
if(!selected.length)throw new Error('No verification jobs selected');
const result={date:new Date().toISOString(),scope:only?'selected-jobs':'all-automated-writing-jobs',browser:'Browser plugin not available; existing Playwright/Electron workflow',jobs:[],
 gates:{physicalChineseIme:'pending-device-evidence',physicalSelectionHandles:'pending-device-evidence',sustainedDevicePerformance:'pending-device-evidence',knowledgeManagement:'deferred-until-editor-foundation-accepted'}};
for(const job of selected) {
 const started=Date.now(),folder=join(output,job.id);await mkdir(folder,{recursive:true});let log='';
 const code=await new Promise((resolve,reject)=>{
  // Reuse the existing fail-closed harness for every desktop UI job. Importing
  // the launch wrapper in each runner also verifies native hidden-window state.
  const hidden=job.args[0]?.startsWith('desktop/tests/');
  const args=hidden?['--require',hiddenMain,'--import',hiddenLaunch,...job.args]:job.args;
  const child=spawn(job.command || process.execPath,args,{cwd:job.cwd || root,windowsHide:true,env:{...process.env,NOTE_QA_OUTPUT:folder}});
  child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
  child.on('error',reject);child.on('exit',resolve);
 });
 await writeFile(join(folder,'run.log'),log);
 const counts=job.id==='source-and-desktop-units'?Object.fromEntries(
  [...log.matchAll(/^# (tests|pass|fail|skipped) (\d+)\s*$/gm)].map(([,key,value])=>[key,Number(value)])):null;
 const summary={id:job.id,status:code!==0?'failed':counts?.skipped>0?'passed-with-skips':'passed',milliseconds:Date.now()-started,exitCode:code,...(counts?{counts}:{})};
 result.jobs.push(summary);console.log(JSON.stringify(summary));
 await writeFile(join(output,'verification.json'),JSON.stringify(result,null,2));
 if(code!==0){console.error(log.slice(-5000));process.exitCode=1;break;}
}
console.log(JSON.stringify({output,scope:result.scope,executionPass:result.jobs.length===selected.length && result.jobs.every(job=>job.exitCode===0),automatedPass:result.jobs.length===selected.length && result.jobs.every(job=>job.status==='passed'),physicalGatesRemainOpen:true}));
