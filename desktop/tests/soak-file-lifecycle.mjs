import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

// Repeatedly runs the file-lifecycle suite with a fresh evidence dir per run.
// Records exit code, wall-clock duration and raw stdout/stderr so a flake can
// be compared across runs instead of being retried away.
const runs=Number(process.argv[2]||8);
const output=resolve(process.argv[3]||'docs/reviews/batch-1/raw/file-lifecycle-soak');
await mkdir(output,{recursive:true});
const suitePath=resolve('desktop/tests/file-lifecycle-ui.mjs');
const results=[];
for(let run=1;run<=runs;run++) {
 const runDir=join(output,'run-'+run);await mkdir(runDir,{recursive:true});
 const startedAt=new Date().toISOString(),start=Date.now();
 const child=spawn(process.execPath,[suitePath],{cwd:process.cwd(),env:{...process.env,NOTE_QA_OUTPUT:runDir},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exitCode=await new Promise(resolveCode=>child.on('close',resolveCode));
 const durationMs=Date.now()-start;
 await writeFile(join(runDir,'stdout.txt'),stdout);await writeFile(join(runDir,'stderr.txt'),stderr);
 const entry={run,exitCode,durationMs,startedAt};results.push(entry);
 console.log(JSON.stringify(entry));
}
const summary={runs:results,failures:results.filter(entry=>entry.exitCode!==0).map(entry=>entry.run),durationsMs:results.map(entry=>entry.durationMs),finishedAt:new Date().toISOString()};
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2));
process.exitCode=summary.failures.length?1:0;
