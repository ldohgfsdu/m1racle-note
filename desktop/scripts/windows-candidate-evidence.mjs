import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

if(process.platform!=='win32')throw new Error('Windows signature evidence requires Windows.');
const source=await readFile('desktop/scripts/windows-package.mjs','utf8');
const version=source.match(/export const version\s*=\s*['"](\d+\.\d+\.\d+)['"]/)?.[1];
if(!version)throw new Error('Package version missing');
const out=resolve('desktop/releases/candidate-evidence');await mkdir(out,{recursive:true});
const targets=[
 ['application',resolve(`desktop/releases/windows/${version}/M1racle Note-win32-x64/M1racle Note.exe`)],
 ['installer',resolve(`desktop/releases/windows-installer/${version}/M1racle-Note-Setup-${version}.exe`)],
 ['uninstaller',resolve('desktop/releases/signing/Uninstall.exe')],
];
const ps=`$ErrorActionPreference='Stop';$s=Get-AuthenticodeSignature -LiteralPath $env:NOTE_SIGNATURE_EVIDENCE_FILE;$v=(Get-Item -LiteralPath $env:NOTE_SIGNATURE_EVIDENCE_FILE).VersionInfo;[pscustomobject]@{status=[string]$s.Status;subject=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint;timestampSubject=$s.TimeStamperCertificate.Subject;productName=$v.ProductName;productVersion=$v.ProductVersion}|ConvertTo-Json -Compress`;
const files=[];
const powershell=process.env.NOTE_POWERSHELL_EXE||'pwsh.exe';
for(const [role,path] of targets){
 const info=await stat(path);
 const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,encoding:'utf8',env:{...process.env,NOTE_SIGNATURE_EVIDENCE_FILE:path}});
 if(result.error)throw new Error(`Cannot start PowerShell 7 signature inspector: ${result.error.message}`);
 if(result.status!==0)throw new Error(`Cannot inspect ${role}: ${result.stderr?.trim()}`);
 const signature=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
 files.push({role,path:path.replaceAll('\\','/').split('/desktop/releases/')[1],bytes:info.size,sha256:createHash('sha256').update(await readFile(path)).digest('hex'),signature});
}
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
if(git.status!==0)throw new Error('Source revision cannot be established');
const status=spawnSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8',windowsHide:true});
if(status.status!==0)throw new Error('Source cleanliness cannot be established');
const sourceClean=status.stdout.trim().length===0;
const trusted=files.every(f=>f.signature.status==='Valid');
const report={schema:1,version,sourceRevision:git.stdout.trim(),sourceClean,githubRun:process.env.GITHUB_RUN_ID||null,observedAt:new Date().toISOString(),files,allAuthenticodeValid:trusted,releaseAccepted:false,remaining:'Trusted publisher identity, signed-uninstaller embedding provenance, installation/upgrade/uninstallation and onboarding acceptance are separate required gates.'};
await writeFile(join(out,'signatures.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(join(out,'STATUS.txt'),`DEVELOPMENT BUILD EVIDENCE\nVersion: ${version}\nSource: ${report.sourceRevision}\nSource worktree clean: ${sourceClean}\nAll Authenticode valid: ${trusted}\nRELEASE ACCEPTANCE: NOT PASSED\nDo not describe source tests, successful compilation or this artifact upload as a signed release.\n`);
console.log(JSON.stringify({version,sourceRevision:report.sourceRevision,allAuthenticodeValid:trusted,releaseAccepted:false,report:join(out,'signatures.json')}));
if(process.argv.includes('--require-trusted')&&!trusted){console.error('SIGNATURE GATE BLOCKED: application, installer and uninstaller must all have valid trusted signatures.');process.exitCode=1;}
if(process.argv.includes('--require-trusted')&&!sourceClean){console.error('SOURCE GATE BLOCKED: the worktree differs from the recorded source revision.');process.exitCode=1;}
