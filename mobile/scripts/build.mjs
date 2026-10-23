import { spawnSync } from 'node:child_process';
for (const args of [['node_modules/typescript/bin/tsc','--noEmit','--project','mobile/tsconfig.json'],['node_modules/vite/bin/vite.js','build','mobile/editor'],['mobile/scripts/bundle.mjs']]) {
 const result = spawnSync(process.execPath, args, { stdio:'inherit' });
 if(result.status !== 0) process.exit(result.status ?? 1);
}
