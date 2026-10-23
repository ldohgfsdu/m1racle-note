import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {waitFor} from './device-driver.mjs';

export const probePackage='com.m1racle.note.qa.probe';
export class ProbeDriver {
 constructor(device,ui,output){this.device=device;this.ui=ui;this.output=output;this.sequence=0;}
 read(name){assert.ok(['result.json','shared.bin','clipboard.txt'].includes(name));return this.device.adb('exec-out','run-as',probePackage,'cat','files/'+name);}
 result(){try{return JSON.parse(this.read('result.json').toString());}catch{return null;}}
 async waitResult(match,label){let result;await waitFor(()=>{result=this.result();return Boolean(result && match(result));},label);assert.equal(result.success,true,result.error);await writeFile(join(this.output,'probe-'+(++this.sequence)+'.json'),JSON.stringify(result,null,2));return result;}
 async command(command,text){
  const request='qa-'+Date.now().toString(36)+'-'+(++this.sequence),args=['shell','am','start','-n',probePackage+'/.ProbeActivity','--es','command',command,'--es','request',request];
  if(text!==undefined)args.push('--es','textBase64',Buffer.from(text).toString('base64'));
  this.device.adb(...args);await this.ui.waitFor(n=>n.package===probePackage,'foreground QA probe');
  return this.waitResult(r=>r.request===request,'probe command: '+command);
 }
}
