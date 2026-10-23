import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// One unified, fail-closed gate. It consumes the reviewed evidence ledger;
// it never converts a functional result, nonempty PNG, or plan into acceptance.
const root=resolve(process.argv[2] || '');
const ledger=JSON.parse(await readFile(join(root,'evidence-ledger.json'),'utf8'));
assert.equal(ledger.schema,1);
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const blockers=[];
const requirePass=(id,status,owner)=>{if(status!=='PASS')blockers.push({id,status,owner});};
requirePass('actual-head',ledger.head===head?'PASS':'FAIL','source baseline');
for(const [file,expected] of Object.entries(ledger.productHashes)) {
  const current=createHash('sha256').update(await readFile(file)).digest('hex');
  requirePass('source-drift:'+file,current===expected?'PASS':'FAIL','source baseline');
}
requirePass('3C.0-functional',ledger.c0Functional.status,'product functionality / automated evidence');
assert.equal(ledger.c0Functional.rows.length,14);
for(const row of ledger.c0Functional.rows)requirePass('C0:'+row.name,row.status,'product functionality / automated evidence');
for(const [phase,status] of Object.entries(ledger.functionalPhases))requirePass(phase,status,'product functionality / automated evidence');
requirePass('regression',ledger.regression.status,'regression');
requirePass('visual',ledger.visual.status,'test infrastructure / visual evidence');
requirePass('foreground-performance',ledger.foregroundPerformance,'foreground measurement');
requirePass('physical-input-and-human-usability',ledger.humanAcceptance,'manual acceptance');
for(const file of ledger.formalScripts) {
  try{execFileSync('git',['ls-files','--error-unmatch','--',file],{stdio:'ignore',windowsHide:true});}
  catch{blockers.push({id:'untracked-script:'+file,status:'BLOCKED',owner:'engineering closeout'});}
}
const report={schema:1,evaluatedAt:new Date().toISOString(),head,
  status:blockers.length?'BLOCKED':'READY_FOR_REVIEW',blockers,
  saveHistory:ledger.saveHistory,finalCommit:null,
  reason:'READY_FOR_REVIEW requires every mandatory evidence class. A functional PASS is not visual, physical-input, or foreground-performance acceptance.',
  scope:'Batch 3C only. Batch 4 is not started.'};
await writeFile(join(root,'final-gate.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report));
if(blockers.length)process.exitCode=1;
