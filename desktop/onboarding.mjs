import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export async function readOnboarding(directory) {
  try {return JSON.parse(await readFile(join(directory,'onboarding.json'),'utf8')).dismissed===true;}
  catch(error) {if(error.code==='ENOENT')return false;throw new Error('无法读取首次使用设置，请稍后重试。');}
}
export async function dismissOnboarding(directory) {
  await mkdir(directory,{recursive:true});
  const temp=join(directory,`onboarding-${randomUUID()}.tmp`);
  try {
    const file=await open(temp,'wx');
    try{await file.writeFile(JSON.stringify({version:1,dismissed:true}));await file.sync();}finally{await file.close();}
    await rename(temp,join(directory,'onboarding.json'));
  } finally {await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
