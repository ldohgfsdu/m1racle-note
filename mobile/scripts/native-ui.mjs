import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {waitFor} from './device-driver.mjs';

const decode=value=>value.replace(/&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp);/gi,(_,entity)=>entity[0]==='#'?String.fromCodePoint(entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1))):({quot:'"',apos:"'",lt:'<',gt:'>',amp:'&'}[entity.toLowerCase()]));
export const nativeNodes=xml=>[...xml.matchAll(/<node\b[^>]*>/g)].map(match=>Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute=>[attribute[1],decode(attribute[2])])));

// Native targets always come from the fresh Android accessibility tree.
// Screenshots are evidence only; they are never used to guess coordinates.
export class NativeUi {
 constructor(device,output,{allWindows=false}={}){this.device=device;this.output=output;this.allWindows=allWindows;this.sequence=0;this.touches=[];}
 async snapshot(label){
  const index=++this.sequence;let nodes,windows;
  if(this.allWindows){
   const request='windows-'+Date.now().toString(36)+'-'+index;
   const command=this.device.adb('shell','am','instrument','-w','-r','-e','request',request,'com.m1racle.note.qa.ui/.WindowProbe');
   await writeFile(join(this.output,'system-ui-'+index+'.txt'),command);
   const bytes=this.device.adb('exec-out','run-as','com.m1racle.note.qa.ui','cat','files/windows.json');
   const result=JSON.parse(bytes.toString());await writeFile(join(this.output,'system-ui-'+index+'.json'),bytes);assert.equal(result.request,request);assert.equal(result.success,true,result.error);nodes=result.nodes;windows=result.windows;
  }else{
   const xml=this.device.adb('exec-out','uiautomator','dump','/dev/tty').toString();nodes=nativeNodes(xml);
   await writeFile(join(this.output,'system-ui-'+index+'.xml'),xml);
  }
  assert.ok(!nodes.some(node=>node['resource-id']?.startsWith('android:id/aerr_')),'An Android ANR dialog blocks '+label);
  return {label,index,nodes,windows,capturedAt:Date.now()};
 }
 async waitFor(match,label,timeout=30000){let screen;await waitFor(async()=>{screen=await this.snapshot(label);return screen.nodes.some(match);},label,timeout);return screen;}
 async tap(match,label,{snapshot}={}){
  const screen=snapshot ?? await this.snapshot(label);
  assert.equal(screen.index,this.sequence,'Only the most recent native snapshot may supply tap coordinates');
  assert.ok(Date.now()-screen.capturedAt<5000,'Native tap coordinates expired');
  const nodes=screen.nodes.filter(match).filter(node=>node.enabled==='true');
  assert.equal(nodes.length,1,'Expected one native target: '+label);
  const bounds=nodes[0].bounds?.match(/\d+/g)?.map(Number);assert.equal(bounds?.length,4,label+' needs native bounds');assert.ok(bounds[2]>bounds[0] && bounds[3]>bounds[1]);
  const point={x:Math.round((bounds[0]+bounds[2])/2),y:Math.round((bounds[1]+bounds[3])/2)};
  this.device.adb('shell','input','tap',String(point.x),String(point.y));
  const touch={label,snapshot:screen.index,id:nodes[0]['resource-id'],package:nodes[0].package,bounds,point};this.touches.push(touch);return touch;
 }
 async swipe(match,label){
  const screen=await this.snapshot(label),nodes=screen.nodes.filter(match);
  assert.equal(nodes.length,1,'Expected one native swipe surface: '+label);
  const bounds=nodes[0].bounds?.match(/\d+/g)?.map(Number);assert.equal(bounds?.length,4);assert.ok(bounds[3]-bounds[1]>100);
  const x=Math.round((bounds[0]+bounds[2])/2),height=bounds[3]-bounds[1],from={x,y:Math.round(bounds[1]+height*.8)},to={x,y:Math.round(bounds[1]+height*.2)};
  this.device.adb('shell','input','swipe',String(from.x),String(from.y),String(to.x),String(to.y),'500');
  this.touches.push({label,snapshot:screen.index,id:nodes[0]['resource-id'],package:nodes[0].package,bounds,from,to});
 }
 async longPress(match,label){
  const screen=await this.snapshot(label),nodes=screen.nodes.filter(match).filter(node=>node.enabled==='true');
  assert.equal(nodes.length,1,'Expected one native long-press surface: '+label);
  const bounds=nodes[0].bounds?.match(/\d+/g)?.map(Number);assert.equal(bounds?.length,4);assert.ok(bounds[2]>bounds[0] && bounds[3]>bounds[1]);
  const point={x:Math.round((bounds[0]+bounds[2])/2),y:Math.round((bounds[1]+bounds[3])/2)};
  this.device.adb('shell','input','touchscreen','swipe',String(point.x),String(point.y),String(point.x),String(point.y),'700');
  this.touches.push({label,gesture:'long-press',snapshot:screen.index,id:nodes[0]['resource-id'],package:nodes[0].package,bounds,point});
 }
}
