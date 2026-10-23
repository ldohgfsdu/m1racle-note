import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import assert from 'node:assert/strict';

const powershell=script=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{windowsHide:true,stdio:['ignore','pipe','pipe']}).toString().trim();
export const hostClipboardSequence=()=>Number(powershell(String.raw`Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class NoteClipboardSequence { [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber(); }'; [NoteClipboardSequence]::GetClipboardSequenceNumber()`));

// Host callbacks live in AOSP's Qt ToolWindow. Only our verified headless
// emulator may receive clipboard fixtures; never read or replace host contents.
export function guestClipboardGuard(device,emulatorPid) {
 assert.equal(process.platform,'win32','This host-isolation check is specific to Windows.');assert.match(device.serial,/^emulator-\d+$/);assert.match(emulatorPid || '',/^\d+$/);
 const info=JSON.parse(powershell(`$noteParent=Get-CimInstance Win32_Process -Filter 'ProcessId=${emulatorPid}'; $noteChildren=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${emulatorPid}' | Where-Object {$_.Name -match '^qemu-system-.*-headless[.]exe$'}); if($noteChildren.Count -ne 1){throw 'Expected one headless QEMU child'}; $noteQt=@((Get-Process -Id $noteChildren[0].ProcessId).Modules | Where-Object {$_.ModuleName -match '^Qt[56].*[.]dll$'}); @{parentName=$noteParent.Name;executable=$noteParent.ExecutablePath;commandLine=$noteParent.CommandLine;childName=$noteChildren[0].Name;childPid=$noteChildren[0].ProcessId;qtModules=$noteQt.Count} | ConvertTo-Json -Compress`));
 assert.equal(info.parentName,'emulator.exe');assert.equal(info.executable.toLowerCase(),resolve(dirname(device.executable),'../emulator/emulator.exe').toLowerCase());
 assert.match(info.commandLine,new RegExp('(?:^|\\s)-port\\s+'+device.serial.slice(9)+'(?:\\s|$)'));
 for(const option of ['no-window','read-only','no-snapshot'])assert.match(info.commandLine,new RegExp('(?:^|\\s)-'+option+'(?:\\s|$)'));
 assert.equal(info.qtModules,0);
 const evidence={...info,source:'https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android/android-ui/modules/aemu-ui-qt/src/android/skin/qt/tool-window.cpp',before:hostClipboardSequence()};assert.ok(Number.isInteger(evidence.before));
 const assertUnchanged=()=>assert.equal(hostClipboardSequence(),evidence.before,'Host clipboard changed during the guest-only test; do not accept this run.');
 return {evidence,assertUnchanged,finish(){evidence.after=hostClipboardSequence();assert.equal(evidence.after,evidence.before);}};
}
