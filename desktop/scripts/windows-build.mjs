import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readdir,cp,copyFile,rename,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
// Never empty the directory a running or starting application is reading.
const staging=await mkdtemp(resolve('desktop/.dist-build-'));
const toolTemp=await mkdtemp(resolve('desktop/.dist-build-'));
try {
  const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','desktop/renderer','--outDir',staging,'--emptyOutDir','--manifest'],{stdio:'inherit',windowsHide:true,env:{...process.env,TEMP:toolTemp,TMP:toolTemp}});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`Windows interface build failed (${result.status})`);
  const destination=resolve('desktop/dist');await mkdir(destination,{recursive:true});
  for(const entry of await readdir(staging))if(entry!=='index.html')await cp(join(staging,entry),join(destination,entry),{recursive:true,force:false,errorOnExist:false});
  await copyFile(join(staging,'.vite/manifest.json'),join(destination,'.vite/manifest.json'));
  const pending=join(destination,`.index-${process.pid}.tmp`);
  await copyFile(join(staging,'index.html'),pending);
  await rename(pending,join(destination,'index.html'));
  // Keep prior hashed assets so already-open windows can still load them.
}finally{await Promise.all([staging,toolTemp].map(path=>rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100})));}
