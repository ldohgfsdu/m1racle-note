import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Native accessibility may omit a Compose-hosted WebView on a handset. Its own
// Android View Hierarchy still supplies the measured parent offsets. DOM target
// boxes come from the live UI tree, never screenshots or invented coordinates.
export async function nativeElementTarget(device,selector,label,{trailing=false,text=false}={}){
 const trace=[];let last;
 for(let attempt=0;attempt<8;attempt++){
  const xml=await device.waitNativeScreen(),webview=xml.match(/<node[^>]*class="android.webkit.WebView"[^>]*>/)?.[0];
  let bounds,hierarchy;
  if(webview){const [x,y,r,b]=webview.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/).slice(1).map(Number);bounds={x,y,width:r-x,height:b-y};}
  else{
   const dump=device.adb('shell','dumpsys','activity','com.m1racle.note').toString();
   assert.match(dump,/ACTIVITY com\.m1racle\.note\/\.MainActivity .*displayId=0/);
   hierarchy=dump.split('View Hierarchy:')[1]?.split(/\n\s+Looper \(/)[0];assert.ok(hierarchy,'Own activity must expose its native view tree');
   const stack=[],found=[];
   for(const line of hierarchy.split(/\r?\n/)){
    const m=line.match(/^(\s+)([\w.$]+)\{.*? (-?\d+),(-?\d+)-(-?\d+),(-?\d+)(?: |\})/);if(!m)continue;
    const depth=m[1].length;while(stack.length&&stack.at(-1).depth>=depth)stack.pop();
    const [l,t,r,b]=m.slice(3).map(Number),parent=stack.at(-1),node={depth,name:m[2],x:(parent?.x??0)+l,y:(parent?.y??0)+t,width:r-l,height:b-t};stack.push(node);if(node.name==='android.webkit.WebView')found.push(node);
   }
   assert.equal(found.length,1,'Expected one Note WebView in its own native hierarchy');bounds=found[0];
  }
  let target=selector;
  if(typeof selector==='string'){const {root}=await device.call('DOM.getDocument'),{nodeId}=await device.call('DOM.querySelector',{nodeId:root.nodeId,selector});assert.ok(nodeId,'Missing live UI target: '+selector);target={nodeId};}
  let {model}=await device.call('DOM.getBoxModel',target);
  if(text){
   assert.equal(typeof selector,'string','Text geometry needs an observed DOM selector');
   // A line's block box includes empty space. Measure its actual live text,
   // without adding this Range to the browser or CodeMirror selection.
   const rect=await device.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};})()`);
   assert.ok(rect.right>rect.left&&rect.bottom>rect.top);model={...model,border:[rect.left,rect.top,rect.right,rect.top,rect.right,rect.bottom,rect.left,rect.bottom]};
  }
  const viewport=await device.evaluate('({width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,x:visualViewport.offsetLeft,y:visualViewport.offsetTop,dpr:devicePixelRatio})');
  last={label,selector,bounds,viewport,box:model.border,textGeometry:text?'live UI text Range, never installed as a selection':undefined};trace.push(last);
  if(Math.abs(viewport.width*viewport.dpr-bounds.width)>2 || Math.abs(viewport.height*viewport.dpr-bounds.height)>2){await new Promise(resolve=>setTimeout(resolve,150));continue;}
  assert.equal(viewport.scale,1,'Do not guess coordinates in a zoomed viewport');
  const xs=model.border.filter((_,i)=>i%2===0),ys=model.border.filter((_,i)=>i%2===1);
  const point={x:Math.round(bounds.x+((trailing?Math.max(...xs)-4:(Math.min(...xs)+Math.max(...xs))/2)-viewport.x)*viewport.dpr),y:Math.round(bounds.y+((Math.min(...ys)+Math.max(...ys))/2-viewport.y)*viewport.dpr)};
  if(hierarchy)await writeFile(join(device.output,label+'-native-view.txt'),hierarchy);
  const result={...last,point,coordinateSource:webview?'native accessibility and live DOM UI tree':'own native View Hierarchy and live DOM UI tree',attempts:trace};await writeFile(join(device.output,label+'-target.json'),JSON.stringify(result,null,2));
  assert.ok(point.x>=bounds.x&&point.x<bounds.x+bounds.width&&point.y>=bounds.y&&point.y<bounds.y+bounds.height,'The observed UI target is off screen');return result;
 }
 await writeFile(join(device.output,label+'-unsettled.json'),JSON.stringify({last,trace},null,2));throw new Error('Native and WebView geometry did not settle for '+label);
}
