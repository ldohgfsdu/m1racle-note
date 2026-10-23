import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const PRODUCT_NAME = 'M1racle Note';
export const EXECUTABLE_NAME = 'M1racle Note.exe';
export const PROGID = 'M1racleNote.Markdown';
export const APP_GUID = '{A1C4E7B2-5D30-4F88-9C21-6B0E4F2A8D17}';
export const INSTALL_DIR_NSIS = '$LOCALAPPDATA\\Programs\\M1racle Note';
export const COMPILER_RELATIVE = 'tools/windows-installer/nsis-3.11/makensis.exe';
export const COMPILER_URL = 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip';
export const PROTECTED_NSIS_PATHS = [
  '$APPDATA\\M1racle Note',
  '$DOCUMENTS',
  '$PROFILE',
  '$APPDATA',
  '$LOCALAPPDATA',
];

const here = dirname(fileURLToPath(import.meta.url));

export function readVersionText(source) {
  const match = String(source).match(/export const version\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
  if (!match) throw new Error('版本文本里没有 export const version=\'x.y.z\'');
  return match[1];
}

export function associationEntries() {
  return [
    {root: 'HKCU', key: 'Software\\Classes\\M1racleNote.Markdown', name: '', type: 'REG_SZ', data: 'M1racle Note Markdown', remove: 'key'},
    {root: 'HKCU', key: 'Software\\Classes\\M1racleNote.Markdown', name: 'FriendlyAppName', type: 'REG_SZ', data: 'M1racle Note', remove: 'none'},
    {root: 'HKCU', key: 'Software\\Classes\\M1racleNote.Markdown\\Application', name: 'ApplicationName', type: 'REG_SZ', data: 'M1racle Note', remove: 'none'},
    {root: 'HKCU', key: 'Software\\Classes\\M1racleNote.Markdown\\Application', name: 'ApplicationIcon', type: 'REG_SZ', data: '"{exe}",0', remove: 'none'},
    {root: 'HKCU', key: 'Software\\Classes\\M1racleNote.Markdown\\DefaultIcon', name: '', type: 'REG_SZ', data: '"{exe}",0', remove: 'none'},
    {root: 'HKCU', key: 'Software\\Classes\\M1racleNote.Markdown\\shell\\open\\command', name: '', type: 'REG_SZ', data: '"{exe}" "%1"', remove: 'none'},
    {root: 'HKCU', key: 'Software\\M1racleNote\\Capabilities', name: 'ApplicationName', type: 'REG_SZ', data: 'M1racle Note', remove: 'key', removeKey: 'Software\\M1racleNote'},
    {root: 'HKCU', key: 'Software\\M1racleNote\\Capabilities', name: 'ApplicationDescription', type: 'REG_SZ', data: 'Markdown 阅读与源码编辑', remove: 'none'},
    {root: 'HKCU', key: 'Software\\M1racleNote\\Capabilities', name: 'ApplicationIcon', type: 'REG_SZ', data: '"{exe}",0', remove: 'none'},
    {root: 'HKCU', key: 'Software\\RegisteredApplications', name: 'M1racle Note', type: 'REG_SZ', data: 'Software\\M1racleNote\\Capabilities', remove: 'value'},
    {root: 'HKCU', key: 'Software\\M1racleNote\\Capabilities\\FileAssociations', name: '.md', type: 'REG_SZ', data: 'M1racleNote.Markdown', remove: 'none'},
    {root: 'HKCU', key: 'Software\\M1racleNote\\Capabilities\\FileAssociations', name: '.markdown', type: 'REG_SZ', data: 'M1racleNote.Markdown', remove: 'none'},
    {root: 'HKCU', key: 'Software\\Classes\\.md\\OpenWithProgids', name: 'M1racleNote.Markdown', type: 'REG_NONE', data: '', remove: 'value'},
    {root: 'HKCU', key: 'Software\\Classes\\.markdown\\OpenWithProgids', name: 'M1racleNote.Markdown', type: 'REG_NONE', data: '', remove: 'value'},
  ];
}

export function installerPlan({version, repoRoot = resolve(here, '..', '..'), packageDir} = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('版本必须是 x.y.z');
  const root = resolve(repoRoot);
  const payloadDir = packageDir
    ? resolve(packageDir)
    : join(root, 'desktop', 'releases', 'windows', version, 'M1racle Note-win32-x64');
  return {
    version,
    productName: PRODUCT_NAME,
    executable: EXECUTABLE_NAME,
    progId: PROGID,
    appGuid: APP_GUID,
    requestExecutionLevel: 'user',
    elevation: 'only-after-all-users-selection',
    modes: ['CurrentUser','AllUsers'],
    directorySelection: true,
    stableInstallDir: '%LOCALAPPDATA%\\Programs\\M1racle Note',
    nsisInstallDir: INSTALL_DIR_NSIS,
    payloadDir,
    scriptPath: join(root, 'desktop', 'installer', 'm1racle-note.nsi'),
    outFile: join(root, 'desktop', 'releases', 'windows-installer', version, `M1racle-Note-Setup-${version}.exe`),
    shortcuts: [
      {id: 'start-menu', nsis: '$SMPROGRAMS\\M1racle Note.lnk'},
      {id: 'desktop', nsis: '$DESKTOP\\M1racle Note.lnk'},
    ],
    protected: [
      {id: 'settings', nsis: '$APPDATA\\M1racle Note', reason: 'Electron userData：设置、会话、最近记录、侧栏元数据和草稿'},
      {id: 'documents', nsis: '$DOCUMENTS', reason: '用户 Markdown 可能在文档目录'},
      {id: 'markdown', nsis: null, reason: '安装和卸载都不复制、移动或删除安装目录以外的 Markdown'},
    ],
    uninstall: 'manifest-only',
    compilerRelative: COMPILER_RELATIVE,
    compilerUrl: COMPILER_URL,
  };
}

function assertRelative(rel) {
  if (!rel || rel.includes('..') || rel.startsWith('\\') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || /["$`]/.test(rel)) {
    throw new Error(`清单路径不能写入安装器: ${rel}`);
  }
}

export function listPayload(root) {
  const files = [];
  const dirs = [];
  const visit = (abs, rel) => {
    const entries = readdirSync(abs, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      const childRel = rel ? `${rel}\\${entry.name}` : entry.name;
      assertRelative(childRel);
      const childAbs = join(abs, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`拒绝符号链接: ${childRel}`);
      if (entry.isDirectory()) {
        dirs.push(childRel);
        visit(childAbs, childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      } else {
        throw new Error(`拒绝非常规文件: ${childRel}`);
      }
    }
  };
  visit(root, '');
  return {files, dirs};
}

function assertPlain(value, label) {
  if (/["$`]/.test(value)) throw new Error(`${label} 含有 NSIS 特殊字符`);
}

function nsisData(data) {
  const text = data.replaceAll('{exe}', `$INSTDIR\\${EXECUTABLE_NAME}`).replaceAll('"', '$\\"');
  return `"${text}"`;
}

function renderFiles(payloadDir, files) {
  assertPlain(payloadDir, '安装源目录');
  const lines = [];
  let current = null;
  for (const rel of files) {
    assertRelative(rel);
    const folder = rel.includes('\\') ? rel.slice(0, rel.lastIndexOf('\\')) : '';
    if (folder !== current) {
      lines.push(`  SetOutPath ${folder ? `"$INSTDIR\\${folder}"` : '"$INSTDIR"'}`);
      current = folder;
    }
    lines.push(`  File "${payloadDir}\\${rel}"`);
  }
  return lines.join('\n');
}

function renderDeletes(files, dirs) {
  const lines = [];
  for (const rel of [...files].reverse()) {
    assertRelative(rel);
    lines.push(`  Delete "$INSTDIR\\${rel}"`);
  }
  lines.push('  Delete "$INSTDIR\\Uninstall.exe"');
  const ordered = [...dirs].sort((a, b) => b.split('\\').length - a.split('\\').length || b.localeCompare(a, 'en'));
  for (const rel of ordered) {
    assertRelative(rel);
    lines.push(`  RMDir "$INSTDIR\\${rel}"`);
  }
  lines.push('  RMDir "$INSTDIR"');
  return lines.join('\n');
}

function renderReparseChecks(files,dirs,prefix) {
  const targets=['$INSTDIR',...dirs.map(rel=>`$INSTDIR\\${rel}`),...files.map(rel=>`$INSTDIR\\${rel}`)];
  return targets.map((target,index)=>[
    `  System::Call 'kernel32::GetFileAttributesW(w "${target}") i.r0'`,
    `  IntCmp $0 -1 ${prefix}_${index}`,
    '  IntOp $0 $0 & 0x400',
    `  IntCmp $0 0 ${prefix}_${index}`,
    '  MessageBox MB_ICONSTOP "操作已停止：程序目录含有链接或重解析点。请保留现有文件并使用普通目录。"',
    '  Abort',
    `${prefix}_${index}:`,
  ].join('\n')).join('\n');
}

function renderAssociations() {
  const install = [];
  const removeKeys = new Set();
  const removeValues = [];
  associationEntries().forEach((entry, index) => {
    if (entry.root !== 'HKCU') throw new Error('文件关联只写入 HKCU');
    if (entry.type === 'REG_NONE') {
      const label = `assoc_ok_${index}`;
      install.push(`  System::Call 'advapi32::RegCreateKeyExW(i 0x80000001, w "${entry.key}", i 0, p 0, i 0, i 0x0102, p 0, *p.r1, p 0) i.r0'`);
      install.push(`  StrCmp $0 "0" ${label}_opened`);
      install.push('  MessageBox MB_ICONSTOP "无法打开 Markdown 关联登记位置。"');
      install.push('  Abort');
      install.push(`${label}_opened:`);
      install.push(`  System::Call 'advapi32::RegSetValueExW(p r1, w "${entry.name}", i 0, i 0, p 0, i 0) i.r0'`);
      install.push("  System::Call 'advapi32::RegCloseKey(p r1)'");
      install.push(`  StrCmp $0 "0" ${label}`);
      install.push('  MessageBox MB_ICONSTOP "无法登记 Markdown 关联。"');
      install.push('  Abort');
      install.push(`${label}:`);
    } else if (entry.type === 'REG_SZ') {
      install.push(`  WriteRegStr HKCU "${entry.key}" "${entry.name}" ${nsisData(entry.data)}`);
    } else {
      throw new Error(`不支持的注册表类型: ${entry.type}`);
    }
    if (entry.remove === 'key') removeKeys.add(entry.removeKey || entry.key);
    if (entry.remove === 'value') removeValues.push(entry);
  });
  const uninstall = [
    ...[...removeKeys].map(key => `  DeleteRegKey HKCU "${key}"`),
    ...removeValues.map(entry => `  DeleteRegValue HKCU "${entry.key}" "${entry.name}"`),
  ];
  return {install: install.join('\n'), uninstall: uninstall.join('\n')};
}



export function uninstallerExportDirective(absPath) {
  if (typeof absPath !== 'string' || !/^[A-Za-z]:\\[^"'`$&|!%<>\r\n]*\.exe$/i.test(absPath) || absPath.includes('..\\')) {
    throw new Error('导出的卸载程序路径无效');
  }
  return '!uninstfinalize \'copy /Y /B "%1" "' + absPath + '"\' = 0';
}

export function resolveExportUninstaller(repoRoot, input) {
  if (typeof input !== 'string' || input.trim() === '' || input.startsWith('-')) {
    throw new Error('--export-uninstaller 需要一个 .exe 路径');
  }
  const absolute = resolve(repoRoot, input);
  uninstallerExportDirective(absolute);
  return absolute;
}

export function renderNsis(plan, manifest = {files: [], dirs: []}, signing = {}) {
  if(!/^\d+\.\d+\.\d+$/.test(plan.version))throw new Error('Invalid version');
  assertPlain(plan.outFile,'安装器输出');assertPlain(plan.payloadDir,'安装源目录');
  const files=[...(manifest.files||[])],dirs=[...(manifest.dirs||[])];
  for(const rel of [...files,...dirs])assertRelative(rel);
  const associations=renderAssociations();
  const substitutions={
    VERSION:plan.version,OUTFILE:plan.outFile,APP_GUID,
    ICON:resolve(here,'../assets/icon.ico'),
    FILES:files.length?renderFiles(plan.payloadDir,files):'  ; fixture payload',
    REPARSE_INSTALL:renderReparseChecks([...files,'m1racle-install.ini','Uninstall.exe'],dirs,'install_plain'),
    REPARSE_UNINSTALL:renderReparseChecks([...files,'m1racle-install.ini','Uninstall.exe'],dirs,'uninstall_plain'),
    INSTALL_ASSOCIATIONS:associations.install.replaceAll('HKCU','SHCTX').replaceAll('i 0x80000001','i $RegistryRoot'),
    DELETE_ASSOCIATIONS:associations.uninstall.replaceAll('HKCU','SHCTX'),
    DELETE_PAYLOAD:files.map((rel,index)=>[
      `  IfFileExists "$INSTDIR\\${rel}" 0 payload_removed_${index}`,
      '  ClearErrors',
      `  Delete "$INSTDIR\\${rel}"`,
      '  IfErrors uninstall_failed',
      `payload_removed_${index}:`,
    ].join('\n')).join('\n'),
    DELETE_FILES:renderDeletes(['m1racle-install.ini'],dirs),
    SIGNING_DIRECTIVES:signing.exportUninstaller ? uninstallerExportDirective(signing.exportUninstaller) : '',
  };
  return readFileSync(resolve(here,'../installer/setup-template.nsi'),'utf8')
    .replace(/@@([A-Z_]+)@@/g,(_,name)=>{
      if(!(name in substitutions))throw new Error('Unknown installer placeholder '+name);
      return substitutions[name];
    });
}

export function assertInstallerInvariants(script,plan) {
  const required=['RequestExecutionLevel user','MUI_PAGE_WELCOME','Page custom ModePage ModeLeave','MUI_PAGE_DIRECTORY','MUI_PAGE_INSTFILES','MUI_PAGE_FINISH',
    'ExecShell "runas" "$EXEPATH" "/ALLUSERS"','MUI_FINISHPAGE_RUN_TEXT','MUI_FINISHPAGE_SHOWREADME_TEXT',
    'M1racleNote.Markdown','GetFileAttributesW','m1racle-install.ini','keep_associations:','VIAddVersionKey "ProductVersion"','VIProductVersion'];
  for(const item of required)if(!script.includes(item))throw new Error('Missing installer safety/UI contract: '+item);
  if(/RequestExecutionLevel\s+(admin|highest)|UserChoice|FileExts/i.test(script))throw new Error('Unexpected default elevation or default-app mutation');
  for(const line of script.split(/\r?\n/)) {
    if(/^\s*RMDir\s+\/r\b|^\s*File\s+\/r\b/i.test(line))throw new Error('Recursive install/delete forbidden');
    if(/^\s*(?:Delete|RMDir)\s+/i.test(line)) {
      if(!/^\s*(?:Delete|RMDir)\s+"\$INSTDIR(?:\\[^"*?]+)?"\s*$/.test(line)
        && !/^\s*Delete\s+"\$(?:DESKTOP|SMPROGRAMS)\\M1racle Note\.lnk"\s*$/.test(line))throw new Error('Deletion outside manifest: '+line);
    }
    if(/^\s*DeleteRegKey\s+(?:SHCTX|HKCU|HKLM)\s+"Software\\Classes\\\./i.test(line))throw new Error('Cannot delete extension keys');
    if(/^\s*DeleteRegKey\s+(?:SHCTX|HKCU|HKLM)\s+"Software\\RegisteredApplications"/i.test(line))throw new Error('Cannot delete other registered applications');
    if(/^\s*WriteReg\w+\s+\w+\s+"Software\\Classes\\Applications\\/i.test(line))throw new Error('Duplicate application identity');
  }
  if(plan&&!script.includes('Name "M1racle Note '+plan.version+'"'))throw new Error('Version mismatch');
  return true;
}

function runningAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)).toLowerCase() === realpathSync(entry).toLowerCase();
  } catch {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const exportInput = value('--export-uninstaller');
  if (args.includes('--export-uninstaller') && !exportInput) throw new Error('--export-uninstaller 需要一个 .exe 路径');
  const exportUninstaller = exportInput ? resolveExportUninstaller(resolve(here, '..', '..'), exportInput) : undefined;
  let version = value('--version') || process.env.M1RACLE_NOTE_VERSION;
  if (!version) {
    const source = readFileSync(join(here, 'windows-package.mjs'), 'utf8');
    version = readVersionText(source);
  }
  const plan = installerPlan({version, packageDir: value('--package')});
  let payloadPresent = false;
  let manifest = {files: [], dirs: []};
  try {
    statSync(plan.payloadDir);
    payloadPresent = true;
    manifest = listPayload(plan.payloadDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const ready = payloadPresent && manifest.files.includes(EXECUTABLE_NAME) && manifest.files.includes('resources\\app.asar');
  if (args.includes('--check')) {
    const sample = renderNsis(plan, ready?manifest:{files: [EXECUTABLE_NAME], dirs: []});
    assertInstallerInvariants(sample, plan);
    console.log('STATUS: INVARIANTS_OK');
    console.log(`VERSION: ${version}`);
    console.log('COMPILE: NOT_RUN');
    console.log('INSTALL: NOT_RUN');
    return;
  }
  if (!ready) {
    console.log('STATUS: PAYLOAD_ABSENT');
    console.log(`VERSION: ${version}`);
    console.log(`PAYLOAD: ${plan.payloadDir}`);
    console.log('COMPILE: NOT_RUN');
    console.log('INSTALL: NOT_RUN');
    process.exitCode = 2;
    return;
  }
  const script = renderNsis(plan, manifest, exportUninstaller ? {exportUninstaller} : {});
  assertInstallerInvariants(script, plan);
  await mkdir(dirname(plan.scriptPath), {recursive: true});
  await writeFile(plan.scriptPath, Buffer.from(`\uFEFF${script}`, 'utf16le'));
  const compiler = process.env.NOTE_NSIS_PATH || join(resolve(here, '..', '..'), COMPILER_RELATIVE);
  console.log('STATUS: SCRIPT_READY');
  console.log(`VERSION: ${version}`);
  console.log(`SCRIPT: ${plan.scriptPath}`);
  console.log(`PAYLOAD: ${plan.payloadDir}`);
  console.log(`FILES: ${manifest.files.length}`);
  console.log(`DIRS: ${manifest.dirs.length}`);
  console.log('UNINSTALL: manifest-only');
  console.log('COMPILE: NOT_RUN');
  console.log('INSTALL: NOT_RUN');
  console.log(`COMPILER: ${compiler}`);
  console.log(`COMPILE_COMMAND: "${compiler}" "${plan.scriptPath}"`);
  if (exportUninstaller) {
    const payloadRoot = plan.payloadDir.replace(/[\\/]+$/, '').toLowerCase();
    if (exportUninstaller.toLowerCase().startsWith(payloadRoot + '\\')) throw new Error('不能把卸载程序导出到安装源目录内');
    try {
      if (lstatSync(exportUninstaller).isSymbolicLink()) throw new Error('拒绝把卸载程序导出到链接');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    console.log('EXPORT_UNINSTALLER: ' + exportUninstaller);
  }
  if(args.includes('--script-only'))return;
  if (exportUninstaller) await mkdir(dirname(exportUninstaller), {recursive: true});
  await mkdir(dirname(plan.outFile),{recursive:true});
  const compilerTemp=await mkdtemp(resolve(here,'../releases/nsis-temp-'));
  try {
    const result=spawnSync(compiler,[plan.scriptPath],{windowsHide:true,stdio:'inherit',env:{...process.env,TEMP:compilerTemp,TMP:compilerTemp}});
    if(result.error)throw result.error;
    if(result.status!==0)throw new Error(`NSIS compile failed: ${result.status}`);
    if(statSync(plan.outFile).size<1024)throw new Error('Installer output is missing or incomplete');
    let signingStatus = 'SIGNING: NOT_CONFIGURED';
    let exportReport = '';
    if (exportUninstaller) {
      const exported = await readFile(exportUninstaller);
      if (exported.length < 1024 || exported[0] !== 0x4d || exported[1] !== 0x5a) throw new Error('导出的卸载程序不是有效的可执行文件');
      const sha256 = createHash('sha256').update(exported).digest('hex');
      signingStatus = 'SIGNING: UNINSTALLER_EXPORTED';
      exportReport = '\nUNINSTALLER: ' + exportUninstaller + '\nUNINSTALLER_SHA256: ' + sha256 + '\nEMBEDDING: NOT_PROVEN\nINSTALLER_SIGN: NOT_CONFIGURED';
    }
    console.log('COMPILE: PASS\nSETUP: ' + plan.outFile + '\nINSTALL: NOT_RUN\n' + signingStatus + exportReport);
  } finally {await rm(compilerTemp,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}

if (runningAsCli()) await main();
