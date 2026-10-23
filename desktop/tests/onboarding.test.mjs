import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readOnboarding,dismissOnboarding} from '../onboarding.mjs';
import {settingsURL,defaultAppsURL,openDefaultSettings} from '../associations.mjs';
import {storeAUMID} from '../store-identity.mjs';
test('MSIX defaults use the package AUMID instead of the portable registry name',()=>{
  assert.equal(settingsURL(26100,0,storeAUMID),`ms-settings:defaultapps?registeredAUMID=${encodeURIComponent(storeAUMID)}`);
  assert.equal(settingsURL(19045,0,storeAUMID),'ms-settings:defaultapps');
});
test('Windows versions before targeted settings support use the generic page',()=>{
  assert.equal(settingsURL(19045,6000),'ms-settings:defaultapps');
  assert.equal(settingsURL(22621,1554),'ms-settings:defaultapps');
  assert.equal(settingsURL(22621,1555),defaultAppsURL);
  assert.equal(settingsURL(22000,1816),'ms-settings:defaultapps');
  assert.equal(settingsURL(22000,1817),defaultAppsURL);
  assert.equal(settingsURL(26100),defaultAppsURL);
});
test('settings opening falls back when targeted launch fails',async()=>{
  const urls=[];
  const result=await openDefaultSettings(async url=>{urls.push(url);if(url!== 'ms-settings:defaultapps')throw new Error('unsupported');});
  assert.equal(urls.at(-1),'ms-settings:defaultapps');assert.equal(result.targeted,false);
});
test('onboarding dismissal survives reload; corrupt state surfaces an error',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'note-onboarding-'));
  try {
    assert.equal(await readOnboarding(dir),false);await dismissOnboarding(dir);assert.equal(await readOnboarding(dir),true);
    await writeFile(join(dir,'onboarding.json'),'{bad');await assert.rejects(readOnboarding(dir),/无法读取/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
