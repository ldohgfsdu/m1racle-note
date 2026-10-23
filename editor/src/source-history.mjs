import {StateEffect,StateField,MapMode} from '@codemirror/state';
import {invertedEffects} from '@codemirror/commands';
import {SourceDocument} from './source.mjs';

// CM6 already stores inverse text changes. Only affected newline byte forms
// need extra undo metadata; never retain the entire source per keystroke.
export function createSourceHistory(getSource) {
 const restoreEndings=StateEffect.define({map(items,mapping){
  const mapped=[];
  for(const item of items) {
   const position=mapping.mapPos(item.position,1,MapMode.TrackAfter);
   if(position!==null)mapped.push({...item,position});
  }
  return mapped.length?mapped:undefined;
 }});
 const rawField=StateField.define({
  create:()=>getSource().raw,
  update(raw,transaction) {
   const effects=transaction.effects.filter(effect=>effect.is(restoreEndings));
   if(!transaction.docChanged && !effects.length)return raw;
   const mirror=new SourceDocument(raw);mirror.eol=getSource().eol;
   if(transaction.docChanged) {
    const changes=[];
    transaction.changes.iterChanges((from,to,_fromB,_toB,insert)=>changes.push({from,to,insert:insert.toString()}));
    mirror.apply(changes);
   }
   if(!effects.length)return mirror.raw;
   const endings=new Map();
   // CM6 puts the oldest inverse effects last in a merged history group.
   for(const effect of effects)for(const item of effect.value) {
    if(item.position>=0 && item.position<transaction.newDoc.length && transaction.newDoc.sliceString(item.position,item.position+1)==='\n')endings.set(item.position,item.ending);
   }
   const patches=[];
   for(const [position,ending] of [...endings].sort((a,b)=>a[0]-b[0])) {
    const previous=patches.at(-1);
    if(previous?.to===position){previous.to=position+1;previous.insert+=(previous.insert.endsWith('\r') && ending.startsWith('\n')?'\r':'')+ending;}
    else patches.push({from:position,to:position+1,insert:ending});
   }
   return mirror.apply(patches,{preserveEndings:true});
  },
 });
 const inversion=invertedEffects.of(transaction=>{
  if(!transaction.docChanged)return [];
  const raw=transaction.startState.field(rawField),endings=[];let mirror;
  transaction.changes.iterChanges((from,to)=>{
   const oldDoc=transaction.startState.doc;
   // Boundary padding may temporarily change an adjacent newline's byte form.
   // Retain those two local forms as well, including the default ending.
   for(const position of new Set([from-1,to]))if(position>=0 && position<oldDoc.length && oldDoc.sliceString(position,position+1)==='\n') {
    mirror ??= new SourceDocument(raw);
    endings.push({position,ending:raw.slice(mirror.offset(position),mirror.offset(position+1))});
   }
   if(from===to || !oldDoc.sliceString(from,to).includes('\n'))return;
   mirror ??= new SourceDocument(raw);
   const removed=raw.slice(mirror.offset(from),mirror.offset(to));let crlf=0;
   for(const match of removed.matchAll(/\r\n|\r|\n/g)) {
    const position=from+match.index-crlf,ending=match[0];
    if(ending==='\r\n')crlf++;
    if(ending!==getSource().eol)endings.push({position,ending});
   }
  });
  return endings.length?[restoreEndings.of(endings)]:[];
 });
 return {rawField,extensions:[rawField,inversion]};
}
