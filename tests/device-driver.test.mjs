import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeviceDriver} from '../mobile/scripts/device-driver.mjs';

test('physical disconnect accepts only an already removed owned forward',async()=>{
 const d=Object.create(DeviceDriver.prototype),calls=[];Object.assign(d,{port:54321,pending:new Map(),socket:{close(){calls.push('close');}},adb(...args){calls.push(args);throw new Error('device not found');},run(...args){calls.push(args);return Buffer.from('other-device tcp:54322 localabstract:other\n');}});
 await d.disconnect();assert.equal(d.port,null);assert.equal(d.socket,null);assert.deepEqual(calls,['close',['forward','--remove','tcp:54321'],['forward','--list']]);
});
test('a failed removal of a still-live owned forward is surfaced without touching any other forward',async()=>{
 const failure=new Error('removal failed'),d=Object.create(DeviceDriver.prototype),calls=[];Object.assign(d,{port:54321,pending:new Map(),socket:null,adb(...args){calls.push(args);throw failure;},run(...args){calls.push(args);return Buffer.from('own-device tcp:54321 localabstract:owned\nother-device tcp:54322 localabstract:other\n');}});
 await assert.rejects(d.disconnect(),error=>error===failure);assert.equal(d.port,null);assert.deepEqual(calls,[['forward','--remove','tcp:54321'],['forward','--list']]);
});
