import {test} from 'node:test';
import assert from 'node:assert/strict';
import {motionDuration} from '../renderer/pane-motion.js';

test('motion tokens retain their millisecond durations after CSS minification',()=>{
  const documentBefore=Object.getOwnPropertyDescriptor(globalThis,'document');
  const styleBefore=Object.getOwnPropertyDescriptor(globalThis,'getComputedStyle');
  let value='';
  Object.defineProperty(globalThis,'document',{value:{documentElement:{}},configurable:true});
  Object.defineProperty(globalThis,'getComputedStyle',{value:()=>({getPropertyValue:()=>value}),configurable:true});
  try {
    for(const [token,expected] of [['240ms',240],['.24s',240],['0.16s',160],['120ms',120],['0ms',0],['0s',0],['invalid',0]]){
      value=token;assert.equal(motionDuration('--m1-motion-standard'),expected,token);
    }
  } finally {
    if(documentBefore)Object.defineProperty(globalThis,'document',documentBefore);else delete globalThis.document;
    if(styleBefore)Object.defineProperty(globalThis,'getComputedStyle',styleBefore);else delete globalThis.getComputedStyle;
  }
});
