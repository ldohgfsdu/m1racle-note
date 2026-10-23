import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const generated=new URL('../installer/m1racle-note.nsi',import.meta.url);
const before=await readFile(generated).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const {installerPlan,renderNsis,assertInstallerInvariants,listPayload,readVersionText,uninstallerExportDirective,resolveExportUninstaller}=await import('../scripts/windows-installer.mjs');
const after=await readFile(generated).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const fixture={files:['M1racle Note.exe','resources\\app.asar'],dirs:['resources']};
const plan=installerPlan({version:'0.1.18'});
const script=renderNsis(plan,fixture);
test('import is read-only and version parsing never loads the packager',()=>{
  assert.deepEqual(before,after);
  assert.equal(readVersionText("export const version='0.1.18';"),'0.1.18');
  assert.throws(()=>readVersionText("not a version"));
});
test('full Chinese wizard has welcome, user scope, directory, install, finish and both options',()=>{
  const sequence=['MUI_PAGE_WELCOME','Page custom ModePage ModeLeave','MUI_PAGE_DIRECTORY','MUI_PAGE_INSTFILES','MUI_PAGE_FINISH'];
  let previous=-1;
  for(const page of sequence){const position=script.indexOf(page);assert.ok(position>previous,page);previous=position;}
  assert.ok(script.includes('MUI_LANGUAGE "SimpChinese"'));
  assert.ok(script.includes('MUI_FINISHPAGE_RUN_TEXT "运行 M1racle Note"'));
  assert.ok(script.includes('MUI_FINISHPAGE_SHOWREADME_TEXT "创建桌面快捷方式"'));
});
test('starts unelevated and requests elevation only from explicit all-users selection',()=>{
  assert.deepEqual(plan.modes,['CurrentUser','AllUsers']);
  assert.equal(plan.directorySelection,true);
  assert.ok(script.includes('RequestExecutionLevel user'));
  assert.doesNotMatch(script,/RequestExecutionLevel\s+(admin|highest)/);
  assert.ok(script.includes('StrCpy $InstallMode "CurrentUser"'));
  assert.ok(script.includes('ExecShell "runas" "$EXEPATH" "/ALLUSERS"'));
  assert.ok(script.includes('SetShellVarContext current'));
  assert.ok(script.includes('SetShellVarContext all'));
  assert.ok(script.includes('SetRegView 64'));
  assert.ok(script.includes('WriteRegStr SHCTX "Software\\Classes\\M1racleNote.Markdown'));
});
test('chosen installation directory requires an empty folder or this application marker',()=>{
  assert.ok(script.indexOf('SetOutPath "$INSTDIR"') < script.indexOf('File "'+plan.payloadDir));
  assert.doesNotMatch(script,/^\s*GetFullPathName\s/m);
  assert.ok(script.includes('GetFullPathNameW(w "$INSTDIR"'));
  assert.ok(script.includes('GetFullPathNameW(w "$R3\\.."'));
  assert.ok(script.includes('IntCmp $0 ${NSIS_MAX_STRLEN} unsafe 0 unsafe'));
  assert.ok(script.includes('ReadINIStr $0 "$INSTDIR\\m1racle-install.ini" "Install" "AppId"'));
  assert.ok(script.includes('FindFirst $0 $1 "$INSTDIR\\*.*"'));
  assert.ok(script.includes('Call ValidateDirectory'));
  assert.ok(script.includes('StrCmp $INSTDIR "$DOCUMENTS" unsafe'));
  assert.ok(script.includes('ReadRegStr $0 SHCTX "Software\\M1racle Note" "InstallDir"'));
  assert.ok(script.includes('StrCmp $0 $INSTDIR 0 invalid'));
});
test('machine install and uninstall both restrict the executable to a Program Files child',()=>{
  const guard='StrCmp $1 "$PROGRAMFILES64\\"';
  assert.equal(script.split(guard).length-1,2);
  assert.ok(script.includes('StrCmp $InstallMode "AllUsers" 0 scope_ok'));
  assert.ok(script.indexOf(guard)<script.indexOf('Section "M1racle Note"'));
});
test('manifest-only uninstall preserves added documents and rejects links before copying or deleting',()=>{
  const deletions=script.split(/\r?\n/).filter(line=>/^\s*Delete\s+/.test(line));
  assert.ok(deletions.some(line=>line.includes('$INSTDIR\\M1racle Note.exe')));
  assert.ok(deletions.some(line=>line.includes('$INSTDIR\\resources\\app.asar')));
  assert.ok(deletions.every(line=>!/[?*]/.test(line)));
  assert.doesNotMatch(script,/^\s*RMDir\s+\/r\b/im);
  assert.doesNotMatch(script,/^\s*(?:Delete|RMDir)\s+"\$(?:APPDATA|LOCALAPPDATA|DOCUMENTS|PROFILE|WINDIR)/im);
  assert.ok(script.includes('GetFileAttributesW(w "$INSTDIR\\resources")'));
  assert.ok(script.includes('IntOp $0 $0 & 0x400'));
  assert.ok(script.indexOf('install_plain_')<script.indexOf('File "'+plan.payloadDir));
  assert.ok(script.indexOf('uninstall_plain_')<script.indexOf('Delete "$SMPROGRAMS'));
});
test('file association preserves defaults, repairs legacy identity and leaves newer registrations on uninstall',()=>{
  assert.doesNotMatch(script,/UserChoice|FileExts/);
  assert.doesNotMatch(script,/^\s*WriteReg\w+\s+\w+\s+"Software\\Classes\\Applications\\/im);
  assert.doesNotMatch(script,/^\s*DeleteRegKey\s+\w+\s+"Software\\Classes\\\.(?:md|markdown)/im);
  assert.ok(script.includes('StrCmp $0 \'$\\\"$INSTDIR\\M1racle Note.exe$\\\" $\\\"%1$\\\"\' 0 keep_associations'));
  assert.ok(script.includes('DeleteRegValue SHCTX "Software\\Classes\\.md\\OpenWithProgids" "M1racleNote.Markdown"'));
  assert.ok(script.includes('RegCreateKeyExW(i $RegistryRoot'));
  assert.ok(script.includes('i 0x0102'));
  assert.ok(script.includes('RegSetValueExW(p r1'));
  assert.ok(script.includes('StrCmp $R6 "" clear_user_openwith'));
  assert.ok(script.indexOf('clear_user_openwith:')<script.indexOf('DeleteRegValue HKCU "Software\\Classes\\.md\\OpenWithProgids"'));
  assert.ok(script.includes('SHChangeNotify'));
});
test('payload traversal records exact files without recursive wildcard installation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'note-installer-fixture-'));
  try {
    await mkdir(join(dir,'resources'));
    await writeFile(join(dir,'M1racle Note.exe'),'synthetic');
    await writeFile(join(dir,'resources','app.asar'),'synthetic');
    assert.deepEqual(listPayload(dir),fixture);
    for(const unsafe of ['..\\note.md','C:\\note.md','\\outside','bad$name','bad"name']){
      assert.throws(()=>renderNsis(plan,{files:['M1racle Note.exe',unsafe],dirs:[]}));
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('safety validation rejects default elevation, user-data wipes and shared registry deletion',()=>{
  assert.equal(assertInstallerInvariants(script,plan),true);
  for(const extra of ['\nRMDir /r "$INSTDIR"','\nDelete "$DOCUMENTS\\note.md"','\nDelete "$INSTDIR\\*"','\nDeleteRegKey SHCTX "Software\\Classes\\.md"','\nDeleteRegKey SHCTX "Software\\RegisteredApplications"','\nWriteRegStr HKCU "Software\\Classes\\Applications\\M1racle Note.exe" "" "bad"']){
    assert.throws(()=>assertInstallerInvariants(script+extra,plan),extra);
  }
  assert.throws(()=>assertInstallerInvariants(script.replace('RequestExecutionLevel user','RequestExecutionLevel highest'),plan));
});

test('product version string matches the three-part application version', () => {
  assert.match(script, /VIProductVersion "0\.1\.18\.0"/);
  assert.match(script, /VIAddVersionKey "ProductVersion" "0\.1\.18"/);
  assert.equal(script.includes('!uninstfinalize'), false);
  assert.equal(script.includes('!finalize'), false);
});
test('export uninstaller uses one Windows backslash and fails closed on unsafe paths', () => {
  const root = 'C:\\Users\\ExampleUser\\Desktop\\M1racle Note';
  const abs = resolveExportUninstaller(root, 'desktop/releases/signing/Uninstall.exe');
  assert.equal(abs, root + '\\desktop\\releases\\signing\\Uninstall.exe');
  const directive = uninstallerExportDirective(abs);
  assert.equal(directive, '!uninstfinalize \'copy /Y /B "%1" "' + abs + '"\' = 0');
  assert.equal(directive.includes('\\\\'), false);
  const exported = renderNsis(plan, fixture, {exportUninstaller: abs});
  assert.equal(assertInstallerInvariants(exported, plan), true);
  assert.ok(exported.includes(directive));
  assert.ok(exported.includes('WriteUninstaller "$INSTDIR\\Uninstall.exe"'));
  assert.ok(exported.includes('VIAddVersionKey "ProductVersion" "0.1.18"'));
  for (const bad of ['desktop\\releases\\signing\\Uninstall.exe', 'C:\\bad$name\\Uninstall.exe', 'C:\\bad&name\\Uninstall.exe', 'C:\\bad"name\\Uninstall.exe']) {
    assert.throws(() => uninstallerExportDirective(bad), bad);
  }
});
