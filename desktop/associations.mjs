import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {win32} from 'node:path';
import {readFile} from 'node:fs/promises';
const run=promisify(execFile);
export const defaultAppsURL='ms-settings:defaultapps?registeredAppUser=M1racle%20Note';
export function settingsURL(build,revision=0,registeredAUMID='',machine=false) {
  const targeted=registeredAUMID?`ms-settings:defaultapps?registeredAUMID=${encodeURIComponent(registeredAUMID)}`:machine?'ms-settings:defaultapps?registeredAppMachine=M1racle%20Note':defaultAppsURL;
  return build>=22631 || build===22621 && revision>=1555 || build===22000 && revision>=1817 ? targeted : 'ms-settings:defaultapps';
}
export async function openDefaultSettings(openExternal,registeredAUMID='') {
  let url='ms-settings:defaultapps';
  try {
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$v=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; @{build=[int]$v.CurrentBuildNumber;revision=[int]$v.UBR}|ConvertTo-Json -Compress"],{windowsHide:true,timeout:10000});
    const version=JSON.parse(stdout);url=settingsURL(version.build,version.revision,registeredAUMID,!registeredAUMID && await machineRegistrationMatches(process.execPath));
  } catch { /* Generic settings works when version probing is unavailable. */ }
  try {await openExternal(url);}catch(error){if(url==='ms-settings:defaultapps')throw error;url='ms-settings:defaultapps';await openExternal(url);}
  return {targeted:url!=='ms-settings:defaultapps'};
}
export async function queryMarkdownDefaults(executable) {
  const script=`
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class NoteAssociationQuery {
 [DllImport("shlwapi.dll", CharSet=CharSet.Unicode)]
 static extern int AssocQueryString(uint flags, uint kind, string extension, string verb, StringBuilder output, ref uint size);
 public static string Executable(string extension) {
   uint size=32768; var value=new StringBuilder((int)size);
   return AssocQueryString(0,2,extension,"open",value,ref size)==0 ? value.ToString() : "";
 }
}
'@
@{md=[NoteAssociationQuery]::Executable('.md');markdown=[NoteAssociationQuery]::Executable('.markdown')} | ConvertTo-Json -Compress
`;
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000});
  const result=JSON.parse(stdout),expected=win32.normalize(executable).toLowerCase();
  return {md:!!result.md && win32.normalize(result.md).toLowerCase()===expected,markdown:!!result.markdown && win32.normalize(result.markdown).toLowerCase()===expected};
}
const markdownProgId = "M1racleNote.Markdown";
const legacyApplicationKey = "HKCU\\Software\\Classes\\Applications\\M1racle Note.exe";
const legacyCommandKey = legacyApplicationKey + "\\shell\\open\\command";
const capabilitiesKey = "HKCU\\Software\\M1racleNote\\Capabilities";
function quoteArg(value) {
  let quoted = "\"";
  let slashes = 0;
  for (const char of String(value)) {
    if (char === "\\") { slashes += 1; continue; }
    if (char === "\"") { quoted += "\\".repeat(slashes * 2 + 1) + "\""; slashes = 0; continue; }
    if (slashes) { quoted += "\\".repeat(slashes); slashes = 0; }
    quoted += char;
  }
  return quoted + "\\".repeat(slashes * 2) + "\"";
}
function windowsArgv(command) {
  const args = [];
  let index = 0;
  while (index < command.length) {
    while (index < command.length && (command[index] === " " || command[index] === "\t")) index += 1;
    if (index >= command.length) break;
    let value = "";
    let quoted = false;
    while (index < command.length) {
      const current = command[index];
      if (!quoted && (current === " " || current === "\t")) break;
      if (current === "\\") {
        let slashes = 0;
        while (index < command.length && command[index] === "\\") { slashes += 1; index += 1; }
        if (command[index] === "\"") {
          value += "\\".repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) { value += "\""; index += 1; }
          else if (quoted && command[index + 1] === "\"") { value += "\""; index += 2; }
          else { quoted = !quoted; index += 1; }
        } else value += "\\".repeat(slashes);
        continue;
      }
      if (current === "\"") {
        if (quoted && command[index + 1] === "\"") { value += "\""; index += 2; }
        else { quoted = !quoted; index += 1; }
        continue;
      }
      value += current;
      index += 1;
    }
    args.push(value);
  }
  return args;
}
function iconData(target) { return quoteArg(target) + ",0"; }
function legacyBelongsToNote(record) {
  if (!record || record.exists === false || record.type !== 'REG_SZ' || typeof record.data !== "string") return false;
  let argv;
  try { argv = windowsArgv(record.data); } catch { return false; }
  return argv.length === 2 && argv[1] === '%1' && win32.basename(argv[0]).toLowerCase() === "m1racle note.exe";
}
export async function markdownRegistrationPlan(executable, options = {}) {
  const icon = iconData(options.iconPath || executable);
  const progKey = "HKCU\\Software\\Classes\\" + markdownProgId;
  const operations = [
    {kind: "set", role: "identity", key: progKey, name: "", type: "REG_SZ", data: "M1racle Note Markdown"},
    {kind: "set", role: "friendly-name", key: progKey, name: "FriendlyAppName", type: "REG_SZ", data: "M1racle Note"},
    {kind: "set", role: "icon", key: progKey + "\\DefaultIcon", name: "", type: "REG_SZ", data: icon},
    {kind: "set", role: "open-command", key: progKey + "\\shell\\open\\command", name: "", type: "REG_SZ", data: quoteArg(executable) + " " + quoteArg("%1"), argv: [executable, "%1"]},
    {kind: "set", role: "application", key: progKey + "\\Application", name: "ApplicationName", type: "REG_SZ", data: "M1racle Note"},
    {kind: "set", role: "application", key: progKey + "\\Application", name: "ApplicationIcon", type: "REG_SZ", data: icon},
    {kind: "set", role: "application-name", key: capabilitiesKey, name: "ApplicationName", type: "REG_SZ", data: "M1racle Note"},
    {kind: "set", role: "application-description", key: capabilitiesKey, name: "ApplicationDescription", type: "REG_SZ", data: "Markdown 阅读与源码编辑"},
    {kind: "set", role: "icon", key: capabilitiesKey, name: "ApplicationIcon", type: "REG_SZ", data: icon},
    {kind: "set", role: "registered-application", key: "HKCU\\Software\\RegisteredApplications", name: "M1racle Note", type: "REG_SZ", data: "Software\\M1racleNote\\Capabilities"},
  ];
  for (const extension of [".md", ".markdown"]) {
    operations.push({kind: "set", role: "open-with", key: "HKCU\\Software\\Classes\\" + extension + "\\OpenWithProgids", name: markdownProgId, type: "REG_NONE", data: ""});
    operations.push({kind: "set", role: "file-association", key: capabilitiesKey + "\\FileAssociations", name: extension, type: "REG_SZ", data: markdownProgId});
  }
  if (typeof options.read === "function") {
    const found = await options.read({key: legacyCommandKey, name: ""});
    if (legacyBelongsToNote(found)) operations.push({kind: "delete-key", role: "migrate-legacy-application", key: legacyApplicationKey});
  }
  operations.push({kind: "notify", role: "shell"});
  return {progId: markdownProgId, operations};
}
async function defaultRead(query, runCommand = run) {
  const args = ["query", query.key];
  if (query.name) args.push("/v", query.name); else args.push("/ve");
  try {
    const {stdout} = await runCommand("reg.exe", args, {windowsHide: true});
    const match = /^\s*(.*?)\s{2,}(REG_\w+)(?:\s{2,}(.*))?$/m.exec(stdout);
    if (!match) return null;
    return {exists: true, type: match[2], data: match[3] ?? ""};
  } catch(error) { if(error.code===1)return null; throw error; }
}
function shellNotify(runCommand) {
  const script = [
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class NoteAssociationRefresh {",
    "  [DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(uint eventId, uint flags, System.IntPtr item1, System.IntPtr item2);",
    "  public static void Associations(){ SHChangeNotify(0x08000000, 0x1000, System.IntPtr.Zero, System.IntPtr.Zero); }",
    "}",
    "'@",
    "[NoteAssociationRefresh]::Associations()",
  ].join("\n");
  return runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {windowsHide: true, timeout: 15000});
}
export async function machineRegistrationMatches(executable,{readMarker=readFile,readRegistry=defaultRead}={}) {
  let bytes;
  try {bytes=await readMarker(win32.join(win32.dirname(executable),'m1racle-install.ini'));}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
  const text=Buffer.isBuffer(bytes)?bytes.toString(bytes[0]===0xff&&bytes[1]===0xfe?'utf16le':'utf8'):String(bytes);
  if(!/^Mode=AllUsers\s*$/mi.test(text) || !/^AppId=\{A1C4E7B2-5D30-4F88-9C21-6B0E4F2A8D17\}\s*$/mi.test(text))return false;
  const record=await readRegistry({key:'HKLM\\Software\\Classes\\M1racleNote.Markdown\\shell\\open\\command',name:''});
  return record?.type==='REG_SZ' && record.data.toLowerCase()===(quoteArg(executable)+' "%1"').toLowerCase();
}
export async function machineUserCleanupPlan(read) {
  const operations=[];
  const userKey='HKCU\\Software\\Classes\\M1racleNote.Markdown';
  const userCommand=await read({key:userKey+'\\shell\\open\\command',name:''});
  const ownsUserCommand=legacyBelongsToNote(userCommand);
  if(ownsUserCommand) {
    operations.push({kind:'delete-key',key:userKey});
    if((await read({key:capabilitiesKey,name:'ApplicationName'}))?.data==='M1racle Note')operations.push({kind:'delete-key',key:capabilitiesKey});
    const registered=await read({key:'HKCU\\Software\\RegisteredApplications',name:'M1racle Note'});
    if(registered?.data==='Software\\M1racleNote\\Capabilities')operations.push({kind:'delete-value',key:'HKCU\\Software\\RegisteredApplications',name:'M1racle Note'});
  }
  if(ownsUserCommand || !userCommand)for(const extension of ['.md','.markdown']) {
    const key='HKCU\\Software\\Classes\\'+extension+'\\OpenWithProgids';
    if(await read({key,name:markdownProgId}))operations.push({kind:'delete-value',key,name:markdownProgId});
  }
  if(legacyBelongsToNote(await read({key:legacyCommandKey,name:''})))operations.push({kind:'delete-key',key:legacyApplicationKey});
  if(operations.length)operations.push({kind:'notify',role:'shell'});
  return {progId:markdownProgId,operations};
}
export async function registerMarkdown(executable, dependencies = {}) {
  if (process.platform !== "win32" && !dependencies.run) throw new Error("仅支持 Windows 文件关联");
  const runCommand = dependencies.run ?? run;
  // A machine installation already owns the shared identity. Do not recreate
  // per-user registrations which would survive its uninstaller or shadow it.
  const machine=dependencies.machineRegistrationMatches
    ?await dependencies.machineRegistrationMatches(executable)
    :!dependencies.run && await machineRegistrationMatches(executable);
  const plan = dependencies.plan ?? markdownRegistrationPlan;
  const read=dependencies.read ?? (query=>defaultRead(query,runCommand));
  const planned = machine?await machineUserCleanupPlan(read):await plan(executable, {iconPath: dependencies.iconPath, read});
  if (!planned || !Array.isArray(planned.operations)) throw new Error("文件关联计划无效");
  for (const operation of planned.operations) {
    if (operation.kind === "set") {
      const args = operation.name
        ? ["add", operation.key, "/v", operation.name, "/t", operation.type, "/d", operation.data, "/f"]
        : ["add", operation.key, "/ve", "/t", operation.type, "/d", operation.data, "/f"];
      await runCommand("reg.exe", args, {windowsHide: true});
    } else if (operation.kind === "delete-key") {
      await runCommand("reg.exe", ["delete", operation.key, "/f"], {windowsHide: true});
    } else if(operation.kind==='delete-value') {
      await runCommand('reg.exe',['delete',operation.key,'/v',operation.name,'/f'],{windowsHide:true});
    } else if (operation.kind === "notify") {
      await shellNotify(runCommand);
    } else throw new Error("无法执行文件关联操作 " + operation.kind);
  }
  return planned;
}
