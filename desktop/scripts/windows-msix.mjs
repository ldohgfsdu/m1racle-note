import {cp,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import electron from 'electron';
import {storeIdentity} from '../store-identity.mjs';
import {version} from './windows-package.mjs';

// The Store requires a nonzero major and reserves the fourth component for itself.
const packageVersion='1.0.5.0';
const output=resolve('desktop/releases/windows-store',packageVersion);
const staging=resolve('desktop/releases/windows-store-staging',packageVersion);
const source=resolve('desktop/releases/windows',version,'M1racle Note-win32-x64');
const makeappx=resolve(process.env.NOTE_MAKEAPPX_PATH || 'tools/windows-signing/sdk-buildtools/bin/10.0.28000.0/x64/makeappx.exe');
await stat(makeappx);
await mkdir(output,{recursive:true});await mkdir(staging,{recursive:true});
await cp(source,join(staging,'app'),{recursive:true});
function run(command,args) {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(command,args,{stdio:'inherit',windowsHide:true,env});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed: ${result.status}`);
}
run(electron,['desktop/scripts/windows-msix-assets.cjs',resolve('desktop/assets/icon-day.png'),join(staging,'Assets')]);
const xml=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const manifest=`<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap uap3 rescap">
 <Identity Name="${xml(storeIdentity.name)}" Publisher="${xml(storeIdentity.publisher)}" Version="${packageVersion}" ProcessorArchitecture="x64"/>
 <Properties><DisplayName>M1racle Note</DisplayName><PublisherDisplayName>${xml(storeIdentity.publisherDisplayName)}</PublisherDisplayName><Description>本地 Markdown 阅读与编辑器</Description><Logo>Assets\\Logo50.png</Logo></Properties>
 <Resources><Resource Language="zh-CN"/></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
 <Applications>
  <Application Id="${xml(storeIdentity.applicationId)}" Executable="app\\M1racle Note.exe" EntryPoint="Windows.FullTrustApplication">
   <uap:VisualElements DisplayName="M1racle Note" Description="本地 Markdown 阅读与编辑器" BackgroundColor="#FFFFFF" Square150x150Logo="Assets\\Logo150.png" Square44x44Logo="Assets\\Logo44.png"/>
   <Extensions>
    <uap:Extension Category="windows.fileTypeAssociation">
     <uap3:FileTypeAssociation Name="markdown" MultiSelectModel="Document">
      <uap:DisplayName>Markdown 文档</uap:DisplayName><uap:Logo>Assets\\Logo44.png</uap:Logo>
      <uap:SupportedFileTypes><uap:FileType>.md</uap:FileType><uap:FileType>.markdown</uap:FileType></uap:SupportedFileTypes>
     </uap3:FileTypeAssociation>
    </uap:Extension>
   </Extensions>
  </Application>
 </Applications>
 <Capabilities><rescap:Capability Name="runFullTrust"/></Capabilities>
</Package>
`;
await writeFile(join(staging,'AppxManifest.xml'),manifest,'utf8');
const artifact=join(output,`M1racleNote_${packageVersion}_x64.msix`);
run(makeappx,['pack','/d',staging,'/p',artifact,'/o','/h','SHA256']);
await cp(join(staging,'AppxManifest.xml'),join(output,'AppxManifest.xml'));
console.log(`Store submission package (unsigned): ${artifact}`);
